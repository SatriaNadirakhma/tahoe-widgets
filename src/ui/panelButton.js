/**
 * PanelButton — GNOME top-bar indicator for Tahoe Widgets.
 *
 * Left-click  → open/close WidgetPicker
 * Right-click → context menu (Edit Mode, Settings, Disable)
 */

import St      from 'gi://St';
import Clutter from 'gi://Clutter';
import * as Main         from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu    from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu    from 'resource:///org/gnome/shell/ui/popupMenu.js';
import { Logger }        from '../utils/logger.js';

export class TahoePanelButton extends PanelMenu.Button {
    static { this.GTypeName = 'TahoePanelButton'; }

    constructor(picker, layout, state) {
        super(0.0, 'Tahoe Widgets', false);
        this._picker  = picker;
        this._layout  = layout;
        this._state   = state;
        this._log     = new Logger('Panel');
        this._editMode = false;

        // ── Icon / label ─────────────────────────────────────────
        const box = new St.BoxLayout({ style: 'spacing:4px;',
            y_align: Clutter.ActorAlign.CENTER });
        box.add_child(new St.Label({ text: '🌊', y_align: Clutter.ActorAlign.CENTER }));
        this.add_child(box);

        // ── Left click → picker ──────────────────────────────────
        this.connect('button-press-event', (_a, ev) => {
            if (ev.get_button() === 1) {
                this._picker.toggle();
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });

        // ── Popup menu (right click auto-handled by PanelMenu) ───
        this._buildMenu();

        // Add to panel
        Main.panel.addToStatusArea('tahoe-widgets', this, 1, 'right');
        this._log.info('Panel button added');
    }

    _buildMenu() {
        // Edit mode toggle
        this._editItem = new PopupMenu.PopupSwitchMenuItem('Edit Mode', false);
        this._editItem.connect('toggled', (item) => {
            this._editMode = item.state;
            this._layout.setEditMode(this._editMode);
        });
        this.menu.addMenuItem(this._editItem);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        // Add Widget (opens picker)
        const addItem = new PopupMenu.PopupMenuItem('Add Widget…');
        addItem.connect('activate', () => {
            this.menu.close();
            this._picker.show();
        });
        this.menu.addMenuItem(addItem);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        // Preferences
        const prefsItem = new PopupMenu.PopupMenuItem('Settings…');
        prefsItem.connect('activate', () => {
            this.menu.close();
            try {
                Main.extensionManager?.lookup('tahoe-widgets@gnome')?.openPreferences();
            } catch {}
        });
        this.menu.addMenuItem(prefsItem);
    }
}
