/**
 * BaseWidget — abstract base class every widget extends.
 *
 * Provides:
 *  - Glassmorphism panel actor (St.BoxLayout)
 *  - Blur effect (graceful fallback for GNOME < 43)
 *  - Dynamic styling from state (opacity, corner radius)
 *  - Hover feedback
 *  - Right-click context menu (Remove, Settings shortcut)
 *  - Edit-mode drag handle strip
 *  - Loading / error state helpers
 *  - Timer management (startTimer / stopTimer)
 *  - Clean destroy()
 */

import St      from 'gi://St';
import Clutter from 'gi://Clutter';
import GLib    from 'gi://GLib';
import * as Main         from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu    from 'resource:///org/gnome/shell/ui/popupMenu.js';
import { Logger }        from '../utils/logger.js';

export class BaseWidget {
    /**
     * @param {object} opts
     * @param {string} opts.id
     * @param {object} opts.state        StateManager
     * @param {object} opts.registry     WidgetRegistry
     * @param {object} [opts.data]       DataManager (optional)
     */
    constructor({ id, state, registry, data }) {
        this.id        = id;
        this._state    = state;
        this._registry = registry;
        this._data     = data ?? null;
        this._log      = new Logger(`Widget:${id}`);
        this._timers   = new Set();
        this._unsubs   = [];

        // ── Outer glass panel ──────────────────────────────────────
        this.actor = new St.BoxLayout({
            name:        `tahoe-${id}`,
            style_class: 'tahoe-widget',
            vertical:    true,
            reactive:    true,
        });

        // Apply dynamic inline styles (opacity, radius)
        this._applyPanelStyle();

        // Blur effect
        this._applyBlur();

        // ── Drag handle (shown in edit mode) ──────────────────────
        this._dragHandle = new St.Widget({
            style_class: 'tahoe-drag-handle',
            x_expand:    true,
            height:      4,
        });
        this.actor.add_child(this._dragHandle);

        // ── Content container ────────────────────────────────────
        this._content = new St.BoxLayout({
            vertical: true,
            x_expand: true,
            y_expand: true,
            style:    'spacing: 6px;',
        });
        this.actor.add_child(this._content);

        // ── Hover signals ────────────────────────────────────────
        this.actor.connect('enter-event', () => {
            this.actor.add_style_class_name('tahoe-widget-hover');
        });
        this.actor.connect('leave-event', () => {
            this.actor.remove_style_class_name('tahoe-widget-hover');
        });

        // ── Right-click context menu ─────────────────────────────
        this._buildContextMenu();

        // ── Re-style when visual settings change ─────────────────
        this._unsubs.push(
            state.subscribe('settings:panel-opacity',  () => this._applyPanelStyle()),
            state.subscribe('settings:corner-radius',  () => this._applyPanelStyle()),
            state.subscribe('settings:blur-radius',    () => this._applyBlur()),
        );

        // ── Subclass builds its UI ────────────────────────────────
        this.build();
    }

    /* ══ Subclass API ═════════════════════════════════════════════════ */

    /** Add children to this._content */
    build() {}

    /** Called by LayoutManager when edit mode changes */
    onEditMode(enabled) {
        this._dragHandle.style = enabled
            ? 'background: rgba(255,255,255,0.35); border-radius:3px; height:4px; margin-bottom:6px;'
            : 'height:0; margin:0;';
    }

    /* ══ Timer helpers ════════════════════════════════════════════════ */

    /** Start a recurring timer. Returns the timer id. */
    startTimer(intervalMs, fn, immediate = true) {
        if (immediate) {
            try { fn(); } catch (e) { this._log.error('Timer fn error', e.message); }
        }
        const id = GLib.timeout_add(
            GLib.PRIORITY_DEFAULT, intervalMs,
            () => {
                try { fn(); } catch (e) { this._log.error('Timer fn error', e.message); }
                return GLib.SOURCE_CONTINUE;
            }
        );
        this._timers.add(id);
        return id;
    }

    stopTimer(id) {
        if (this._timers.has(id)) {
            GLib.source_remove(id);
            this._timers.delete(id);
        }
    }

    /* ══ UI helpers ═══════════════════════════════════════════════════ */

    /** Create a styled label and add it to _content */
    addLabel(text, styleClass = 'tahoe-label') {
        const lbl = new St.Label({ text, style_class: styleClass });
        this._content.add_child(lbl);
        return lbl;
    }

    /** Replace _content with a loading spinner label */
    showLoading(message = 'Loading…') {
        this._content.remove_all_children();
        this._content.add_child(new St.Label({
            text:        message,
            style_class: 'tahoe-label-small tahoe-muted',
            x_align:     Clutter.ActorAlign.CENTER,
        }));
    }

    /** Replace _content with an error message */
    showError(message = 'Error') {
        this._content.remove_all_children();
        const box = new St.BoxLayout({ vertical: true, style: 'spacing:4px;' });
        box.add_child(new St.Label({ text: '⚠️', style_class: 'tahoe-label-medium',
            x_align: Clutter.ActorAlign.CENTER }));
        box.add_child(new St.Label({ text: message, style_class: 'tahoe-label-small tahoe-muted',
            x_align: Clutter.ActorAlign.CENTER }));
        this._content.add_child(box);
    }

    /* ══ Context menu ═════════════════════════════════════════════════ */

    _buildContextMenu() {
        this._menu = new PopupMenu.PopupMenu(this.actor, 0.0, St.Side.TOP);
        Main.uiGroup.add_child(this._menu.actor);
        this._menu.actor.hide();

        // Remove widget
        const removeItem = new PopupMenu.PopupMenuItem('Remove Widget');
        removeItem.connect('activate', () => {
            this._menu.close();
            this._registry.destroyWidget(this.id);
        });
        this._menu.addMenuItem(removeItem);

        this._menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        // Open settings
        const settingsItem = new PopupMenu.PopupMenuItem('Widget Settings…');
        settingsItem.connect('activate', () => {
            this._menu.close();
            try {
                const { extensionManager } = Main;
                const ext = extensionManager?.lookup('tahoe-widgets@gnome');
                ext?.openPreferences?.();
            } catch {}
        });
        this._menu.addMenuItem(settingsItem);

        // Right-click to open menu
        this.actor.connect('button-press-event', (_a, ev) => {
            if (ev.get_button() !== 3) return Clutter.EVENT_PROPAGATE;
            this._menu.toggle();
            return Clutter.EVENT_STOP;
        });
    }

    /* ══ Visual styling ═══════════════════════════════════════════════ */

    _applyPanelStyle() {
        const opacity = this._state.panelOpacity;
        const radius  = this._state.cornerRadius;
        // Inline style supplements the CSS class
        this.actor.style =
            `background-color: rgba(255,255,255,${opacity});` +
            `border-radius: ${radius}px;`;
    }

    _applyBlur() {
        // Remove old effect if present
        try { this.actor.remove_effect_by_name('blur'); } catch {}
        const sigma = this._state.blurRadius;
        if (sigma <= 0) return;
        try {
            const blur = new Clutter.BlurEffect({ sigma: sigma / 3 });
            this.actor.add_effect_with_name('blur', blur);
        } catch {
            // GNOME version does not support BlurEffect — skip
        }
    }

    /* ══ Lifecycle ════════════════════════════════════════════════════ */

    destroy() {
        // Stop all timers
        this._timers.forEach(id => GLib.source_remove(id));
        this._timers.clear();
        // Unsubscribe from state
        this._unsubs.forEach(fn => fn());
        this._unsubs = [];
        // Destroy context menu
        try { this._menu?.destroy(); } catch {}
        // Destroy actor
        try { this.actor.destroy(); } catch {}
    }
}
