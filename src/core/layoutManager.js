/**
 * LayoutManager v2.1 — FIXED
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

        let originX, originY, originActorX, originActorY, dragging = false;

        const press = actor.connect('button-press-event', (_a, ev) => {
            if (ev.get_button() !== 1) return Clutter.EVENT_PROPAGATE;
            [originX, originY]           = ev.get_coords();
            [originActorX, originActorY] = [actor.x, actor.y];
            dragging = true;
            this._drag = { id };
            actor.raise_top();
            return Clutter.EVENT_STOP;
        });

        const motion = actor.connect('motion-event', (_a, ev) => {
            if (!dragging || this._drag?.id !== id) return Clutter.EVENT_PROPAGATE;

            const [ex, ey] = ev.get_coords();
            let nx = originActorX + (ex - originX);
            let ny = originActorY + (ey - originY);

            if (this._state.snapToGrid) {
                const g = this._state.gridSize;
                nx = Math.round(nx / g) * g;
                ny = Math.round(ny / g) * g;
            }

            const safe = this._safeArea();
            nx = Math.max(safe.x, Math.min(nx, safe.x + safe.w - actor.width));
            ny = Math.max(safe.y, Math.min(ny, safe.y + safe.h - actor.height));

            actor.set_position(nx, ny);
            actor.add_style_class_name('tahoe-dragging');
            return Clutter.EVENT_STOP;
        });

        const release = actor.connect('button-release-event', () => {
            if (!dragging || this._drag?.id !== id) return Clutter.EVENT_PROPAGATE;
            dragging = false;
            this._drag = null;
            actor.remove_style_class_name('tahoe-dragging');
            this._state.setWidgetState(id, { x: actor.x, y: actor.y });
            return Clutter.EVENT_STOP;
        });

        actor._tahoeSignals = [press, motion, release];
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

        // Wait one frame for natural size allocation
        GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            const safe = this._safeArea();
            const w    = actor.get_preferred_width(-1)[1]  || actor.width  || 240;
            const h    = actor.get_preferred_height(-1)[1] || actor.height || 120;
            const x    = safe.x + safe.w - w - margin;
            let   y    = usedBottom;

            // Wrap to top if overflows
            if (y + h > safe.y + safe.h)
                y = safe.y + margin;

            actor.set_position(x, y);
            this._state.setWidgetState(id, { x, y });
            this._log.debug(`Auto-placed ${id}: x=${x} y=${y} w=${w} h=${h}`);
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
