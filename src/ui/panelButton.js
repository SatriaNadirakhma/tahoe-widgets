/**
 * PanelButton v3.0
 *
 * Fix: Use GObject.registerClass explicitly instead of static block GTypeName.
 *      Required for reliable GObject registration in GNOME 49+.
 */

import St        from 'gi://St';
import GObject   from 'gi://GObject';
import Clutter   from 'gi://Clutter';
import * as Main        from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu   from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu   from 'resource:///org/gnome/shell/ui/popupMenu.js';
import { Logger }       from '../utils/logger.js';
import { getLucideIcon } from '../utils/lucideHelper.js';

export const TahoePanelButton = GObject.registerClass(
class TahoePanelButton extends PanelMenu.Button {

    _init(picker, layout, state) {
        super._init(0.0, 'Tahoe Widgets', false);

        this._picker   = picker;
        this._layout   = layout;
        this._state    = state;
        this._log      = new Logger('Panel');
        this._editMode = false;

        // ── Icon label ────────────────────────────────────────────
        const box = new St.BoxLayout({
            y_align: Clutter.ActorAlign.CENTER,
        });
        const icon = getLucideIcon('waves', 18);
        icon.style = 'margin-right:4px;';
        box.add_child(icon);
        this.add_child(box);

        // ── Left click → toggle picker ────────────────────────────
        this.connect('button-press-event', (_a, ev) => {
            if (ev.get_button() === 1) {
                this.menu.close();
                this._picker.toggle();
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });

        // ── Right-click popup menu ────────────────────────────────
        this._buildMenu();

        // ── Add to top bar ────────────────────────────────────────
        Main.panel.addToStatusArea('tahoe-widgets', this, 1, 'right');
        this._log.info('Panel button ready');
    }

    _buildMenu() {
        // Edit Mode toggle
        this._editItem = new PopupMenu.PopupSwitchMenuItem('Edit Mode', false);
        this._editItem.connect('toggled', (item) => {
            this._editMode = item.state;
            this._layout.setEditMode(this._editMode);
        });
        this.menu.addMenuItem(this._editItem);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        // Add Widget
        const addItem = new PopupMenu.PopupMenuItem('Add Widget…');
        addItem.connect('activate', () => {
            this.menu.close();
            this._picker.show();
        });
        this.menu.addMenuItem(addItem);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        // Settings
        const settingsItem = new PopupMenu.PopupMenuItem('Settings…');
        settingsItem.connect('activate', () => {
            this.menu.close();
            try {
                Main.extensionManager
                    ?.lookup('tahoe-widgets@gnome')
                    ?.openPreferences?.();
            } catch {}
        });
        this.menu.addMenuItem(settingsItem);
    }
});
