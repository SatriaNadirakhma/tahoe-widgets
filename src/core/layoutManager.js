/**
 * LayoutManager v3.0
 *
 * Fixes:
 *  - global.screen_width/height deprecated in GNOME 48+ → use primaryMonitor
 *  - Canvas added to correct layer (above wallpaper, below windows)
 *  - Auto-place uses real monitor geometry
 */

import St      from 'gi://St';
import Clutter from 'gi://Clutter';
import GLib    from 'gi://GLib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { Logger } from '../utils/logger.js';

export class LayoutManager {
    constructor(state) {
        this._state   = state;
        this._log     = new Logger('Layout');
        this._widgets = new Map();
        this._drag    = null;

        this._buildCanvas();
        this._monitorsChangedId = Main.layoutManager.connect(
            'monitors-changed', () => this._onMonitorsChanged()
        );
    }

    /* ══ Canvas ═══════════════════════════════════════════════════════ */

    _buildCanvas() {
        const m = Main.layoutManager.primaryMonitor;

        this.canvas = new St.Widget({
            name:              'tahoe-canvas',
            layout_manager:    new Clutter.FixedLayout(),
            reactive:          false,
            x:                 m.x,
            y:                 m.y,
            width:             m.width,
            height:            m.height,
            clip_to_allocation: false,   // allow children to paint outside bounds
        });

        // ── Correct layer: above wallpaper, below application windows ──
        // _backgroundGroup sits below window_group; add canvas there so
        // widgets appear on the desktop but behind open windows.
        try {
            Main.layoutManager._backgroundGroup.add_child(this.canvas);
        } catch (e) {
            // Fallback for unusual configurations
            this._log.warn('_backgroundGroup unavailable, using uiGroup fallback', e.message);
            Main.uiGroup.insert_child_at_index(this.canvas, 0);
        }

        this._log.info(`Canvas built: ${m.width}×${m.height} at (${m.x},${m.y})`);
    }

    /* ══ Widget management ════════════════════════════════════════════ */

    addWidget(widget) {
        const { id } = widget;
        if (this._widgets.has(id)) return;

        const actor = widget.actor;
        this.canvas.add_child(actor);
        this._widgets.set(id, { widget, actor });

        // Restore saved position or auto-place
        const saved = this._state.getWidgetState(id);
        if (saved?.x != null && saved?.y != null) {
            actor.set_position(saved.x, saved.y);
            this._log.debug(`Restored position ${id}: ${saved.x},${saved.y}`);
        } else {
            this._autoPlace(id, actor);
        }

        this._connectDrag(id, actor);
        this._log.info(`Widget added to canvas: ${id}`);
    }

    removeWidget(id) {
        const entry = this._widgets.get(id);
        if (!entry) return;
        try {
            // Cancel any pending auto-place before removing
            if (entry.actor._tahoeAutoPlace) {
                GLib.source_remove(entry.actor._tahoeAutoPlace);
                entry.actor._tahoeAutoPlace = 0;
            }
            // Disconnect stage listeners if this widget is mid-drag
            entry.actor._tahoeStageDrag?.();
            entry.actor.remove_all_transitions();
            this.canvas.remove_child(entry.actor);
        } catch (e) {
            this._log.warn(`removeWidget error for ${id}:`, e.message);
        }
        this._widgets.delete(id);
        this._log.info(`Widget removed from canvas: ${id}`);
    }

    show() { this.canvas.show(); }
    hide() { this.canvas.hide(); }

    /* ══ Edit mode ════════════════════════════════════════════════════ */

    setEditMode(enabled) {
        this._widgets.forEach(({ widget, actor }, id) => {
            if (enabled)
                actor.add_style_class_name('tahoe-edit-mode');
            else
                actor.remove_style_class_name('tahoe-edit-mode');
            widget.onEditMode?.(enabled);
        });
    }

    /* ══ Drag & drop ══════════════════════════════════════════════════ */

    _connectDrag(id, actor) {
        actor.reactive = true;

        let originX, originY, originActorX, originActorY;
        let dragging = false;

        // Per-drag cache — populated once on press, not re-read every pixel
        let _snap = false, _grid = 1, _safe = null;

        // ROOT CAUSE FIX:
        //
        // The previous implementation used:
        //   captured-event → stop BUTTON_PRESS → start drag
        //   stage.connect('motion-event')  → move widget
        //   stage.connect('button-release-event') → end drag
        //
        // Problem: when captured-event returns EVENT_STOP on the button press,
        // Clutter never delivers the press to any actor, so no implicit pointer
        // grab is established.  In GNOME 45+ without that grab, the stage-level
        // 'motion-event' and 'button-release-event' signals are NOT reliably
        // delivered while the pointer moves — causing the widget to appear frozen.
        //
        // Fix: Handle ALL three event types (BUTTON_PRESS, MOTION,
        // BUTTON_RELEASE) inside the single 'captured-event' handler.
        // captured-event fires for every event unconditionally (it is the
        // capture phase of the Clutter event pipeline), so no grab is needed.

        const capturedId = global.stage.connect('captured-event', (_st, ev) => {
            const evType = ev.type();

            /* ── BUTTON PRESS: start drag if pointer is over our actor ── */
            if (evType === Clutter.EventType.BUTTON_PRESS) {
                if (ev.get_button() !== 1) return Clutter.EVENT_PROPAGATE;

                const [ex, ey] = ev.get_coords();
                const clicked  = global.stage.get_actor_at_pos(Clutter.PickMode.ALL, ex, ey);
                if (!clicked || !actor.contains(clicked)) return Clutter.EVENT_PROPAGATE;

                // Cancel any pending auto-place so it doesn't jump the widget
                // mid-drag (auto-place runs asynchronously via GLib.idle_add).
                if (actor._tahoeAutoPlace) {
                    GLib.source_remove(actor._tahoeAutoPlace);
                    actor._tahoeAutoPlace = 0;
                }

                [originX, originY]           = ev.get_coords();
                [originActorX, originActorY] = [actor.x, actor.y];
                dragging = true;
                this._drag = { id };

                // Cache GSettings reads + safe-area calc once per drag session
                _snap = this._state.snapToGrid;
                _grid = _snap ? this._state.gridSize : 1;
                _safe = this._safeArea();

                // raise_top() removed in GNOME 45+ — use parent container API
                actor.get_parent()?.set_child_above_sibling(actor, null);

                // Kill all running transitions BEFORE adding the class so the
                // CSS state change is instant — no fade/scale delay on drag start.
                actor.remove_all_transitions();
                actor.add_style_class_name('tahoe-dragging');

                // Remove blur effect during drag to prevent lag
                const _blurEffect = actor.get_effect('blur');
                if (_blurEffect) actor.remove_effect(_blurEffect);

                return Clutter.EVENT_STOP;
            }

            /* ── MOTION: move widget while dragging ──────────────────── */
            if (evType === Clutter.EventType.MOTION) {
                if (!dragging) return Clutter.EVENT_PROPAGATE;

                const [ex, ey] = ev.get_coords();
                let nx = originActorX + (ex - originX);
                let ny = originActorY + (ey - originY);

                if (_snap) {
                    nx = Math.round(nx / _grid) * _grid;
                    ny = Math.round(ny / _grid) * _grid;
                }

                nx = Math.max(_safe.x, Math.min(nx, _safe.x + _safe.w - actor.width));
                ny = Math.max(_safe.y, Math.min(ny, _safe.y + _safe.h - actor.height));

                actor.set_position(nx, ny);
                return Clutter.EVENT_STOP;
            }

            /* ── BUTTON RELEASE: end drag, persist position ──────────── */
            if (evType === Clutter.EventType.BUTTON_RELEASE) {
                if (!dragging || ev.get_button() !== 1) return Clutter.EVENT_PROPAGATE;

                dragging       = false;
                this._drag     = null;

                // Kill transitions so class removal is instant — no ghost fade
                // when quickly grabbing the next widget.
                actor.remove_all_transitions();
                actor.remove_style_class_name('tahoe-dragging');

                // Re-apply blur effect after drag ends
                if (actor._tahoeReapplyBlur) {
                    try { actor._tahoeReapplyBlur(); } catch {}
                    actor._tahoeReapplyBlur = null;
                }

                this._state.setWidgetState(id, { x: actor.x, y: actor.y });
                return Clutter.EVENT_STOP;
            }

            return Clutter.EVENT_PROPAGATE;
        });

        // Expose cleanup so removeWidget can disconnect the stage listener
        // if a drag is in progress when the widget is destroyed externally.
        actor._tahoeSignals   = [capturedId];
        actor._tahoeStageDrag = () => {
            if (capturedId) global.stage.disconnect(capturedId);
            dragging = false;
        };
    }

    /* ══ Auto-placement ═══════════════════════════════════════════════ */

    _autoPlace(id, actor) {
        const spacing = this._state.widgetSpacing ?? 16;
        const margin  = 24;

        // Find lowest occupied y among existing widgets
        let usedBottom = this._safeArea().y + margin;
        this._widgets.forEach(({ actor: a }, wid) => {
            if (wid === id) return;
            const bottom = a.y + (a.height || 120) + spacing;
            if (bottom > usedBottom) usedBottom = bottom;
        });

        // Set an initial approximate position immediately so the actor
        // has valid coordinates if the user starts dragging before the
        // idle callback fires (which waits for size allocation).
        const safe = this._safeArea();
        actor.set_position(safe.x + margin, usedBottom);

        // Wait one frame for natural size allocation, then place precisely.
        actor._tahoeAutoPlace = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            // If the user already started dragging this widget, skip the
            // auto-place so it doesn't jump the widget mid-drag.
            if (this._drag?.id === id) {
                actor._tahoeAutoPlace = 0;
                return GLib.SOURCE_REMOVE;
            }

            const safe = this._safeArea();
            const w    = actor.get_preferred_width(-1)[1]  || actor.width  || 240;
            const h    = actor.get_preferred_height(-1)[1] || actor.height || 120;
            const x    = safe.x + margin;
            let   y    = usedBottom;

            // Wrap to top if overflows
            if (y + h > safe.y + safe.h)
                y = safe.y + margin;

            actor.set_position(x, y);
            this._state.setWidgetState(id, { x, y });
            this._log.debug(`Auto-placed ${id}: x=${x} y=${y} w=${w} h=${h}`);
            actor._tahoeAutoPlace = 0;
            return GLib.SOURCE_REMOVE;
        });
    }

    /* ══ Safe area ════════════════════════════════════════════════════ */

    _safeArea() {
        const m   = Main.layoutManager.primaryMonitor;
        const top = this._state.topBarMargin ?? 40;
        const bot = this._state.dockMargin   ?? 72;
        return {
            x: m.x,
            y: m.y + top,
            w: m.width,
            h: m.height - top - bot,
        };
    }

    /* ══ Monitor change ═══════════════════════════════════════════════ */

    _onMonitorsChanged() {
        const m = Main.layoutManager.primaryMonitor;
        this.canvas.set_size(m.width, m.height);
        this.canvas.set_position(m.x, m.y);

        this._widgets.forEach(({ actor }, id) => {
            const safe = this._safeArea();
            const nx   = Math.max(safe.x, Math.min(actor.x, safe.x + safe.w - actor.width));
            const ny   = Math.max(safe.y, Math.min(actor.y, safe.y + safe.h - actor.height));
            actor.set_position(nx, ny);
            this._state.setWidgetState(id, { x: nx, y: ny });
        });
    }

    /* ══ Lifecycle ════════════════════════════════════════════════════ */

    destroy() {
        if (this._monitorsChangedId) {
            Main.layoutManager.disconnect(this._monitorsChangedId);
            this._monitorsChangedId = null;
        }
        this._widgets.clear();
        try { this.canvas.destroy(); } catch {}
    }
}