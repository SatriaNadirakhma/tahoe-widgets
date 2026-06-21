/**
 * BaseWidget v3.1
 *
 * Changes:
 *  - Removed hover enter/leave event handlers (hover CSS removed — no-op)
 *  - Added WIDGET_SMALL / WIDGET_MEDIUM size constants (macOS-style grid)
 */

import St      from 'gi://St';
import Clutter from 'gi://Clutter';
import GLib    from 'gi://GLib';
import Gio     from 'gi://Gio';
import * as Main      from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import { Logger }     from '../utils/logger.js';
import { getLucideIcon } from '../utils/lucideHelper.js';

// macOS-style widget grid sizes
// Small  = 2×2 grid units ≈ 155×155 px
// Medium = 2×4 grid units ≈ 329×155 px
export const WIDGET_SMALL  = { width: 155, height: 155 };
export const WIDGET_MEDIUM = { width: 329, height: 155 };

// Calendar-specific sizes
// Small  — matches Clock widget (1×1 = 155×155)
// Medium — wide horizontal layout with room for mini calendar (329×220)
export const CALENDAR_SMALL  = { width: 155, height: 155 };
export const CALENDAR_MEDIUM = { width: 329, height: 220 };

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
            height:      0,
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

        // ── Context menu ───────────────────────────────────────────
        this._buildContextMenu();

        // ── Re-style on settings change ────────────────────────────
        this._unsubs.push(
            state.subscribe('settings:panel-opacity',  () => this._applyPanelStyle()),
            state.subscribe('settings:corner-radius',  () => this._applyPanelStyle()),
            state.subscribe('settings:blur-radius',    () => this._applyBlur()),
            state.subscribe('settings:background-mode',() => { this._applyPanelStyle(); this._applyBlur(); }),
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
        const errIcon = getLucideIcon('triangle-alert', 22);
        errIcon.style = 'color: rgba(255,255,255,0.88);';
        box.add_child(errIcon);
        box.add_child(new St.Label({
            text: message, style_class: 'tahoe-label-small tahoe-muted',
            x_align: Clutter.ActorAlign.CENTER,
        }));
        this._content.add_child(box);
    }

    /* ══ Context menu ═════════════════════════════════════════════════ */

    _buildContextMenu() {
        try {
            this._menu = new PopupMenu.PopupMenu(this.actor, 0.5, St.Side.BOTTOM);
            Main.uiGroup.add_child(this._menu.actor);
            this._menu.actor.hide();

            const removeItem = new PopupMenu.PopupMenuItem('Remove Widget');
            removeItem.connect('activate', () => {
                this._menu.close();
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
        } catch (e) {
            this._log.warn('Context menu unavailable:', e.message);
            this._menu = null;
        }
    }

    /* ══ Visual styling ═══════════════════════════════════════════════ */

    _applyPanelStyle() {
        let mode = this._state.backgroundMode ?? 'transparent';
        const radius = this._state.cornerRadius ?? 20;

        if (mode === 'auto') {
            mode = this._resolveSystemColorScheme();
        }

        this.actor.remove_style_class_name('tahoe-bg-light');
        this.actor.remove_style_class_name('tahoe-bg-dark');

        if (mode === 'light') {
            this.actor.add_style_class_name('tahoe-bg-light');
            this.actor.style = `border-radius: ${radius}px;`;
        } else if (mode === 'dark') {
            this.actor.add_style_class_name('tahoe-bg-dark');
            this.actor.style = `border-radius: ${radius}px;`;
        } else {
            const opacity = this._state.panelOpacity ?? 0.10;
            this.actor.style =
                `background-color: rgba(255,255,255,${opacity});` +
                `border-radius: ${radius}px;`;
        }
    }

    _resolveSystemColorScheme() {
        if (!this._systemSettings) {
            try {
                this._systemSettings = new Gio.Settings({
                    schema_id: 'org.gnome.desktop.interface',
                });
                this._systemSettingsId = this._systemSettings.connect(
                    'changed::color-scheme', () => {
                        if (this._state.backgroundMode === 'auto')
                            this._applyPanelStyle();
                    }
                );
            } catch {
                this._systemSettings = null;
                this._systemSettingsId = null;
            }
        }
        if (!this._systemSettings) return 'light';
        try {
            const scheme = this._systemSettings.get_string('color-scheme');
            return scheme === 'prefer-dark' ? 'dark' : 'light';
        } catch {
            return 'light';
        }
    }

    _applyBlur() {
        this.actor.remove_effect_by_name('blur');
        let mode = this._state.backgroundMode ?? 'transparent';
        if (mode === 'auto') {
            mode = this._resolveSystemColorScheme();
        }
        if (mode !== 'transparent') return;
        const sigma = this._state.blurRadius ?? 20;
        if (sigma <= 0) return;
        try {
            const blur = new Clutter.BlurEffect({ sigma: Math.min(sigma / 3, 4) });
            this.actor.add_effect_with_name('blur', blur);
        } catch {}
        this.actor._tahoeReapplyBlur = () => this._applyBlur();
    }

    /* ══ Lifecycle ════════════════════════════════════════════════════ */

    destroy() {
        this._timers.forEach(id => GLib.source_remove(id));
        this._timers.clear();
        this._unsubs.forEach(fn => { try { fn(); } catch {} });
        this._unsubs = [];
        if (this._systemSettingsId && this._systemSettings) {
            try { this._systemSettings.disconnect(this._systemSettingsId); } catch {}
            this._systemSettingsId = null;
            this._systemSettings = null;
        }
        try {
            if (this._menu) {
                Main.uiGroup.remove_child(this._menu.actor);
                this._menu.destroy();
            }
        } catch {}
        try { this.actor.destroy(); } catch {}
    }
}