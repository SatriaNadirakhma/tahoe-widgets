/**
 * WidgetContainer — the invisible full-screen layer that hosts all
 * widgets. Manages drag-and-drop, grid snapping, and reflow on
 * monitor changes.
 */

import St      from 'gi://St';
import Clutter from 'gi://Clutter';
import GLib    from 'gi://GLib';
import Meta    from 'gi://Meta';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const SNAP_THRESHOLD = 10; // px — how close before snap activates

export class WidgetContainer {
    constructor({ state, extension }) {
        this._state     = state;
        this._extension = extension;
        this._widgets   = [];
        this._editMode  = false;
        this._drag      = null; // active drag state

        this.actor = new St.Widget({
            name:            'tahoe-widget-container',
            layout_manager:  new Clutter.FixedLayout(),
            reactive:        false,
            x:               0,
            y:               0,
            width:           global.screen_width,
            height:          global.screen_height,
        });
    }

    addWidget(widget) {
        this._widgets.push(widget);
        this.actor.add_child(widget.actor);

        // Restore or assign default position
        const saved = this._state.getWidgetPosition(widget.id);
        if (saved) {
            widget.actor.set_position(saved.x, saved.y);
        } else {
            this._autoPosition(widget);
        }

        this._connectDrag(widget);
    }

    show() { this.actor.show(); }
    hide() { this.actor.hide(); }
    reset() { /* called after monitor change — reflow */ this._widgets.forEach(w => this._autoPosition(w)); }

    destroy() {
        this._widgets = [];
        this.actor.destroy();
    }

    /* ── Auto-position new widgets in a column on right side ─────── */
    _autoPosition(widget) {
        const monitor = Main.layoutManager.primaryMonitor;
        const margin  = 32;
        const spacing = this._state.getSettings().widgetSpacing;

        let usedHeight = margin;
        this._widgets
            .filter(w => w !== widget)
            .forEach(w => {
                usedHeight += w.actor.height + spacing;
            });

        const x = monitor.x + monitor.width  - widget.actor.width  - margin;
        const y = monitor.y + usedHeight;
        widget.actor.set_position(x, y);
        this._state.setWidgetPosition(widget.id, x, y);
    }

    /* ── Drag & drop ─────────────────────────────────────────────── */
    _connectDrag(widget) {
        const actor = widget.actor;
        actor.reactive = true;

        let startX, startY, startActorX, startActorY;

        const pressId = actor.connect('button-press-event', (a, event) => {
            if (event.get_button() !== 1) return Clutter.EVENT_PROPAGATE;

            const [evX, evY] = event.get_coords();
            startX      = evX;
            startY      = evY;
            startActorX = actor.x;
            startActorY = actor.y;

            actor.add_style_class_name('dragging');
            actor.raise_top();

            this._drag = { widget, startX, startY, startActorX, startActorY };
            return Clutter.EVENT_STOP;
        });

        const motionId = actor.connect('motion-event', (a, event) => {
            if (!this._drag || this._drag.widget !== widget)
                return Clutter.EVENT_PROPAGATE;

            const [evX, evY] = event.get_coords();
            let nx = startActorX + (evX - startX);
            let ny = startActorY + (evY - startY);

            // Grid snapping
            const { snapToGrid, snapGridSize } = this._state.getSettings();
            if (snapToGrid) {
                nx = Math.round(nx / snapGridSize) * snapGridSize;
                ny = Math.round(ny / snapGridSize) * snapGridSize;
            }

            // Clamp to monitor bounds
            const monitor = Main.layoutManager.primaryMonitor;
            nx = Math.max(monitor.x, Math.min(nx, monitor.x + monitor.width  - actor.width));
            ny = Math.max(monitor.y, Math.min(ny, monitor.y + monitor.height - actor.height));

            actor.set_position(nx, ny);
            return Clutter.EVENT_STOP;
        });

        const releaseId = actor.connect('button-release-event', (a, event) => {
            if (!this._drag || this._drag.widget !== widget)
                return Clutter.EVENT_PROPAGATE;

            actor.remove_style_class_name('dragging');
            this._state.setWidgetPosition(widget.id, actor.x, actor.y);
            this._state.save();
            this._drag = null;
            return Clutter.EVENT_STOP;
        });

        // Store signal IDs for cleanup
        widget._dragSignals = [pressId, motionId, releaseId];
        widget._dragActor   = actor;
    }
}
