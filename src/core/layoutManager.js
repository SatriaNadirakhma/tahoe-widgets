/**
 * LayoutManager — owns the desktop layer actor and handles:
 *  - Full-screen transparent canvas layered above the wallpaper
 *  - Widget placement with screen-boundary clamping
 *  - Drag-and-drop with visual feedback
 *  - Grid snapping
 *  - Collision avoidance with top-bar and dock
 *  - Z-order management
 *  - Edit mode (shows drag handles, remove buttons)
 *  - Auto-placement for newly added widgets (cascade from top-right)
 */

import St      from 'gi://St';
import Clutter from 'gi://Clutter';
import GLib    from 'gi://GLib';
import Meta    from 'gi://Meta';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { Logger } from '../utils/logger.js';

export class LayoutManager {
    constructor(state) {
        this._state    = state;
        this._log      = new Logger('Layout');
        this._widgets  = new Map();   // id → { widget, actor }
        this._editMode = false;
        this._drag     = null;        // active drag context

        this._buildCanvas();
        this._connectMonitorSignal();
    }

    /* ══ Canvas ═══════════════════════════════════════════════════════ */

    _buildCanvas() {
        this.canvas = new St.Widget({
            name:           'tahoe-canvas',
            layout_manager: new Clutter.FixedLayout(),
            reactive:       false,
            x: 0, y: 0,
            width:  global.screen_width,
            height: global.screen_height,
        });
        // Insert just above background, below UI chrome
        Main.layoutManager._backgroundGroup.add_child(this.canvas);
    }

    _connectMonitorSignal() {
        this._monitorsChangedId = Main.layoutManager.connect(
            'monitors-changed', () => this._onMonitorsChanged()
        );
    }

    /* ══ Widget management ════════════════════════════════════════════ */

    addWidget(widget) {
        const { id } = widget;
        if (this._widgets.has(id)) return;

        const actor = widget.actor;
        this.canvas.add_child(actor);
        this._widgets.set(id, { widget, actor });

        // Restore position or auto-place
        const saved = this._state.getWidgetState(id);
        if (saved?.x != null && saved?.y != null) {
            actor.set_position(saved.x, saved.y);
        } else {
            this._autoPlace(id, actor);
        }

        this._connectDrag(id, actor);
        this._applyEditMode(id, actor);
        this._log.debug(`Added to canvas: ${id}`);
    }

    removeWidget(id) {
        const entry = this._widgets.get(id);
        if (!entry) return;
        entry.actor.remove_all_transitions();
        this.canvas.remove_child(entry.actor);
        this._widgets.delete(id);
    }

    show() { this.canvas.show(); }
    hide() { this.canvas.hide(); }

    /* ══ Edit mode ════════════════════════════════════════════════════ */

    setEditMode(enabled) {
        this._editMode = enabled;
        this._widgets.forEach(({ widget, actor }, id) => {
            this._applyEditMode(id, actor);
            widget.onEditMode?.(enabled);
        });
    }

    get editMode() { return this._editMode; }

    _applyEditMode(id, actor) {
        if (this._editMode)
            actor.add_style_class_name('tahoe-edit-mode');
        else
            actor.remove_style_class_name('tahoe-edit-mode');
    }

    /* ══ Drag & drop ══════════════════════════════════════════════════ */

    _connectDrag(id, actor) {
        actor.reactive = true;

        let originX, originY, originActorX, originActorY, dragging = false;

        const press = actor.connect('button-press-event', (_a, ev) => {
            if (ev.get_button() !== 1) return Clutter.EVENT_PROPAGATE;
            [originX, originY]         = ev.get_coords();
            [originActorX, originActorY] = [actor.x, actor.y];
            dragging = true;
            this._drag = { id, actor, originX, originY, originActorX, originActorY };
            actor.raise_top();
            return Clutter.EVENT_STOP;
        });

        const motion = actor.connect('motion-event', (_a, ev) => {
            if (!dragging || this._drag?.id !== id) return Clutter.EVENT_PROPAGATE;

            const [ex, ey] = ev.get_coords();
            let nx = originActorX + (ex - originX);
            let ny = originActorY + (ey - originY);

            // Grid snap
            if (this._state.snapToGrid) {
                const g = this._state.gridSize;
                nx = Math.round(nx / g) * g;
                ny = Math.round(ny / g) * g;
            }

            // Clamp to safe area
            const safe  = this._safeArea();
            nx = Math.max(safe.x, Math.min(nx, safe.x + safe.w - actor.width));
            ny = Math.max(safe.y, Math.min(ny, safe.y + safe.h - actor.height));

            actor.set_position(nx, ny);
            actor.add_style_class_name('tahoe-dragging');
            return Clutter.EVENT_STOP;
        });

        const release = actor.connect('button-release-event', (_a, _ev) => {
            if (!dragging || this._drag?.id !== id) return Clutter.EVENT_PROPAGATE;
            dragging = false;
            this._drag = null;
            actor.remove_style_class_name('tahoe-dragging');

            // Persist position
            this._state.setWidgetState(id, { x: actor.x, y: actor.y });
            this._log.debug(`Saved position for ${id}: ${actor.x},${actor.y}`);
            return Clutter.EVENT_STOP;
        });

        // Store so we can disconnect on removal
        actor._tahoeSignals = [press, motion, release];
    }

    /* ══ Auto-placement ═══════════════════════════════════════════════ */

    /**
     * Cascades new widgets from top-right, stepping down by spacing.
     */
    _autoPlace(id, actor) {
        const safe    = this._safeArea();
        const spacing = this._state.widgetSpacing;
        const margin  = 24;

        // Find the lowest y occupied by existing widgets on the right side
        let usedBottom = safe.y + margin;
        this._widgets.forEach(({ actor: a }, wid) => {
            if (wid === id) return;
            const bottom = a.y + a.height + spacing;
            if (bottom > usedBottom) usedBottom = bottom;
        });

        // Wait one frame for actor to get its natural size, then position
        GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            const w = actor.width  || 240;
            const h = actor.height || 120;
            const x = safe.x + safe.w - w - margin;
            let   y = usedBottom;

            // If it overflows safe area bottom, wrap to top
            if (y + h > safe.y + safe.h)
                y = safe.y + margin;

            actor.set_position(x, y);
            this._state.setWidgetState(id, { x, y });
            return GLib.SOURCE_REMOVE;
        });
    }

    /* ══ Safe area ════════════════════════════════════════════════════ */

    /**
     * Returns the region where widgets can safely be placed.
     * Accounts for primary monitor + top bar + dock margins.
     */
    _safeArea() {
        const m   = Main.layoutManager.primaryMonitor;
        const top = this._state.topBarMargin;
        const bot = this._state.dockMargin;
        return {
            x: m.x,
            y: m.y + top,
            w: m.width,
            h: m.height - top - bot,
        };
    }

    /* ══ Monitor change ═══════════════════════════════════════════════ */

    _onMonitorsChanged() {
        this.canvas.set_size(global.screen_width, global.screen_height);
        // Re-clamp all widget positions to new monitor bounds
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
        this.canvas.destroy();
    }
}
