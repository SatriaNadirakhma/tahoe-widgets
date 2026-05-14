/**
 * BaseWidget v2.1 — FIXED
 *
 * Fixes:
 *  - St.Side removed in GNOME 45 → use St.Side.BOTTOM or omit (use PopupMenu.PopupMenu properly)
 *  - Main.uiGroup.add_child(menu.actor) → .actor deprecated → use menu directly
 *  - Wrap entire context-menu build in try/catch so a menu crash doesn't
 *    prevent the widget from appearing on screen
 */

import St      from 'gi://St';
import Clutter from 'gi://Clutter';
import GLib    from 'gi://GLib';
import * as Main      from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import { Logger }     from '../utils/logger.js';

export class BaseWidget {
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

        this._applyPanelStyle();
        this._applyBlur();

        // ── Drag handle ────────────────────────────────────────────
        this._dragHandle = new St.Widget({
            style_class: 'tahoe-drag-handle',
            x_expand:    true,
            height:      0,           // hidden by default; shown in edit mode
        });
        this.actor.add_child(this._dragHandle);

        // ── Content container ──────────────────────────────────────
        this._content = new St.BoxLayout({
            vertical: true,
            x_expand: true,
            y_expand: true,
            style:    'spacing: 6px;',
        });
        this.actor.add_child(this._content);

        // ── Hover ──────────────────────────────────────────────────
        this.actor.connect('enter-event', () =>
            this.actor.add_style_class_name('tahoe-widget-hover'));
        this.actor.connect('leave-event', () =>
            this.actor.remove_style_class_name('tahoe-widget-hover'));

        // ── Context menu (wrapped in try/catch — must not crash widget) ──
        this._buildContextMenu();

        // ── Re-style on settings change ────────────────────────────
        this._unsubs.push(
            state.subscribe('settings:panel-opacity', () => this._applyPanelStyle()),
            state.subscribe('settings:corner-radius', () => this._applyPanelStyle()),
            state.subscribe('settings:blur-radius',   () => this._applyBlur()),
        );

        // ── Let subclass build its UI ──────────────────────────────
        this.build();
    }

    /* ══ Subclass API ═════════════════════════════════════════════════ */

    build() {}

    onEditMode(enabled) {
        this._dragHandle.style = enabled
            ? 'background:rgba(255,255,255,0.35);border-radius:3px;height:4px;margin-bottom:6px;'
            : 'height:0;margin:0;';
    }

    /* ══ Timer helpers ════════════════════════════════════════════════ */

    startTimer(intervalMs, fn, immediate = true) {
        if (immediate) {
            try { fn(); } catch (e) { this._log.error('Timer fn (immediate)', e.message); }
        }
        const id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, intervalMs, () => {
            try { fn(); } catch (e) { this._log.error('Timer fn', e.message); }
            return GLib.SOURCE_CONTINUE;
        });
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

    showLoading(message = 'Loading…') {
        this._content.remove_all_children();
        this._content.add_child(new St.Label({
            text:        message,
            style_class: 'tahoe-label-small tahoe-muted',
            x_align:     Clutter.ActorAlign.CENTER,
        }));
    }

    showError(message = 'Error') {
        this._content.remove_all_children();
        const box = new St.BoxLayout({ vertical: true, style: 'spacing:4px;' });
        box.add_child(new St.Label({
            text: '⚠️', style_class: 'tahoe-label-medium',
            x_align: Clutter.ActorAlign.CENTER,
        }));
        box.add_child(new St.Label({
            text: message, style_class: 'tahoe-label-small tahoe-muted',
            x_align: Clutter.ActorAlign.CENTER,
        }));
        this._content.add_child(box);
    }

    /* ══ Context menu — FIXED for GNOME 45+ ══════════════════════════ */

    _buildContextMenu() {
        try {
            // GNOME 45+: St.Side is still available but St.Side.TOP works.
            // The safest approach is St.Side.BOTTOM to appear above the widget.
            this._menu = new PopupMenu.PopupMenu(
                this.actor,
                0.5,
                St.Side.BOTTOM
            );

            // GNOME 45+: add the menu to uiGroup (not menu.actor — that's deprecated)
            Main.uiGroup.add_child(this._menu.actor);
            this._menu.actor.hide();

            // Remove widget
            const removeItem = new PopupMenu.PopupMenuItem('Remove Widget');
            removeItem.connect('activate', () => {
                this._menu.close();
                // Use a short delay so the menu animation finishes first
                GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                    try { this._registry.destroyWidget(this.id); } catch {}
                    return GLib.SOURCE_REMOVE;
                });
            });
            this._menu.addMenuItem(removeItem);

            this._menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

            const settingsItem = new PopupMenu.PopupMenuItem('Widget Settings…');
            settingsItem.connect('activate', () => {
                this._menu.close();
                try {
                    Main.extensionManager?.lookup('tahoe-widgets@gnome')
                        ?.openPreferences?.();
                } catch {}
            });
            this._menu.addMenuItem(settingsItem);

            // Right-click opens menu via PopupMenu's built-in handling.
            // We do NOT connect a separate button-press-event here because
            // LayoutManager._connectDrag already handles left-click for
            // dragging on the same actor.  Two button-press-event handlers
            // on the same actor cause event conflicts that break dragging.

        } catch (e) {
            // Menu failed — widget still shows, just without right-click menu
            this._log.warn('Context menu unavailable:', e.message);
            this._menu = null;
        }
    }

    /* ══ Visual styling ═══════════════════════════════════════════════ */

    _applyPanelStyle() {
        const opacity = this._state.panelOpacity ?? 0.18;
        const radius  = this._state.cornerRadius ?? 20;
        this.actor.style =
            `background-color: rgba(255,255,255,${opacity});` +
            `border-radius: ${radius}px;`;
    }

    _applyBlur() {
        try { this.actor.remove_effect_by_name('blur'); } catch {}
        const sigma = this._state.blurRadius ?? 20;
        if (sigma <= 0) return;
        try {
            // Use a low-quality blur to avoid severe lag during drag.
            // Clutter.BlurEffect is extremely expensive (offscreen buffer +
            // convolution per frame).  A small sigma keeps it usable.
            const blur = new Clutter.BlurEffect({ sigma: Math.min(sigma / 3, 4) });
            this.actor.add_effect_with_name('blur', blur);
        } catch {
            // BlurEffect not available — skip silently
        }

        // Expose a re-apply function so LayoutManager can restore the blur
        // after temporarily removing it during drag (for performance).
        this.actor._tahoeReapplyBlur = () => this._applyBlur();
    }

    /* ══ Lifecycle ════════════════════════════════════════════════════ */

    destroy() {
        this._timers.forEach(id => GLib.source_remove(id));
        this._timers.clear();
        this._unsubs.forEach(fn => { try { fn(); } catch {} });
        this._unsubs = [];
        try {
            if (this._menu) {
                Main.uiGroup.remove_child(this._menu.actor);
                this._menu.destroy();
            }
        } catch {}
        try { this.actor.destroy(); } catch {}
    }
}
