/**
 * BaseWidget — abstract base all widgets extend.
 * Provides the glassmorphism panel, blur effect, lifecycle hooks,
 * and refresh interval management.
 */

import St      from 'gi://St';
import Clutter from 'gi://Clutter';
import GLib    from 'gi://GLib';
import GObject from 'gi://GObject';

export class BaseWidget {
    /**
     * @param {object} opts
     * @param {string} opts.id          - unique widget identifier
     * @param {number} opts.refreshMs   - data refresh interval in ms (0 = no auto refresh)
     * @param {object} opts.extension
     * @param {object} opts.state
     */
    constructor({ id, refreshMs = 0, extension, state }) {
        this.id          = id;
        this._extension  = extension;
        this._state      = state;
        this._refreshMs  = refreshMs;
        this._timeoutId  = null;

        // Outer glass panel
        this.actor = new St.BoxLayout({
            name:        `tahoe-widget-${id}`,
            style_class: 'tahoe-widget',
            vertical:    true,
            reactive:    true,
        });

        // Apply blur effect if available (GNOME ≥ 43)
        this._applyBlur();

        // Build widget content (implemented by subclass)
        this.build();

        // Start refresh cycle
        if (this._refreshMs > 0)
            this._scheduleRefresh();
    }

    /* ── Subclass API ────────────────────────────────────────────── */

    /** Called once — add St.* children to this.actor */
    build() {}

    /** Called on every refresh tick — update displayed data */
    refresh() {}

    /* ── Lifecycle ───────────────────────────────────────────────── */

    destroy() {
        this._clearRefresh();
        this.actor.destroy();
    }

    /* ── Blur / glassmorphism ────────────────────────────────────── */

    _applyBlur() {
        // Clutter.BlurEffect is available in GNOME Shell ≥ 43
        // We fall back gracefully on older versions.
        try {
            const { blurRadius } = this._state.getSettings();
            if (blurRadius > 0) {
                const blur = new Clutter.BlurEffect({ sigma: blurRadius / 4 });
                this.actor.add_effect_with_name('blur', blur);
            }
        } catch {
            // BlurEffect unavailable — widget renders without blur
        }
    }

    updateBlur(radius) {
        const blur = this.actor.get_effect('blur');
        if (blur) blur.sigma = radius / 4;
    }

    /* ── Refresh scheduling ──────────────────────────────────────── */

    _scheduleRefresh() {
        this._clearRefresh();
        this._timeoutId = GLib.timeout_add(
            GLib.PRIORITY_DEFAULT,
            this._refreshMs,
            () => {
                try { this.refresh(); } catch { /* swallow to keep timer alive */ }
                return GLib.SOURCE_CONTINUE;
            }
        );
        // Initial fetch
        try { this.refresh(); } catch { /* ignore first-run errors */ }
    }

    _clearRefresh() {
        if (this._timeoutId) {
            GLib.source_remove(this._timeoutId);
            this._timeoutId = null;
        }
    }

    /* ── Helpers ─────────────────────────────────────────────────── */

    /** Add a St.Label child with a given style class */
    _makeLabel(text, styleClass) {
        const lbl = new St.Label({
            text,
            style_class: styleClass,
            x_align:     Clutter.ActorAlign.START,
        });
        return lbl;
    }

    /** Show an error state in the widget */
    _showError(message = 'Unable to load') {
        this.actor.remove_all_children();
        this.actor.add_child(this._makeLabel('⚠', 'tahoe-label-small'));
        this.actor.add_child(this._makeLabel(message, 'tahoe-label-small'));
    }
}
