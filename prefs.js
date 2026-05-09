/**
 * prefs.js v2.1 — FIXED
 *
 * Fix: "Changes apply after toggling" → "Changes apply immediately"
 * Fix: Adw.MessageDialog needs transient_for parent to show properly
 */

import Adw  from 'gi://Adw';
import Gtk  from 'gi://Gtk';
import Gio  from 'gi://Gio';
import GLib from 'gi://GLib';
import { ExtensionPreferences } from
    'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class TahoePreferences extends ExtensionPreferences {
    fillPreferencesWindow(win) {
        const s = this.getSettings();
        win.set_default_size(680, 760);
        win.set_title('Tahoe Widgets');
        win.add(this._appearancePage(s));
        win.add(this._layoutPage(s));
        win.add(this._clockPage(s));
        win.add(this._weatherPage(s));
        win.add(this._worldClockPage(s));
        win.add(this._widgetsPage(s, win));
        win.add(this._aboutPage());
    }

    /* ══ Pages ══════════════════════════════════════════════════════ */

    _appearancePage(s) {
        const page = this._page('Appearance', 'preferences-desktop-appearance-symbolic');

        const vg = this._group('Visual Style');
        vg.add(this._spinRow(s, 'blur-radius',    'Blur Radius',    0, 60, 2));
        vg.add(this._spinRow(s, 'corner-radius',  'Corner Radius',  4, 36, 2));
        vg.add(this._spinRow(s, 'widget-spacing', 'Widget Spacing', 4, 64, 4));
        vg.add(this._scaleRow(s, 'panel-opacity', 'Panel Opacity',  0.05, 0.95, 0.05));
        page.add(vg);

        const cg = this._group('Color Scheme');
        cg.add(this._comboRow(s, 'color-scheme', 'Theme',
            [{ value: 'auto',  label: 'Automatic (follow shell)' },
             { value: 'light', label: 'Light' },
             { value: 'dark',  label: 'Dark'  }]));
        page.add(cg);
        return page;
    }

    _layoutPage(s) {
        const page = this._page('Layout', 'view-grid-symbolic');
        const sg = this._group('Snapping');
        sg.add(this._switchRow(s, 'snap-to-grid', 'Snap to Grid'));
        sg.add(this._spinRow(s, 'grid-size', 'Grid Size', 4, 64, 4));
        page.add(sg);
        const mg = this._group('Safe Area');
        mg.add(this._spinRow(s, 'top-bar-margin', 'Top Bar Margin', 0, 120, 4));
        mg.add(this._spinRow(s, 'dock-margin',    'Dock Margin',    0, 200, 8));
        page.add(mg);
        return page;
    }

    _clockPage(s) {
        const page = this._page('Clock', 'clock-symbolic');
        const cg = this._group('Display');
        cg.add(this._comboRow(s, 'clock-format', 'Format',
            [{ value: '12h', label: '12-hour (AM/PM)' },
             { value: '24h', label: '24-hour'          }]));
        cg.add(this._switchRow(s, 'clock-show-seconds', 'Show Seconds'));
        page.add(cg);
        return page;
    }

    _weatherPage(s) {
        const page = this._page('Weather', 'weather-clear-symbolic');
        const lg = this._group('Location');
        lg.add(this._entryRow(s, 'weather-location', 'City',
            'Leave blank for automatic detection'));
        lg.add(this._comboRow(s, 'weather-unit', 'Unit',
            [{ value: 'celsius',    label: 'Celsius (°C)'    },
             { value: 'fahrenheit', label: 'Fahrenheit (°F)' }]));
        page.add(lg);
        const rg = this._group('Refresh');
        rg.add(this._spinRow(s, 'weather-refresh-minutes', 'Interval (minutes)', 5, 120, 5));
        page.add(rg);
        return page;
    }

    _worldClockPage(s) {
        const page = this._page('World Clock', 'globe-symbolic');
        const wg = this._group('Timezones');
        wg.set_description('One IANA timezone per line — e.g. America/New_York');

        const buf = new Gtk.TextBuffer();
        buf.set_text(s.get_strv('world-clock-zones').join('\n'), -1);

        let saveTimer = null;
        buf.connect('changed', () => {
            if (saveTimer) GLib.source_remove(saveTimer);
            saveTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT_IDLE, 500, () => {
                const text  = buf.get_text(buf.get_start_iter(), buf.get_end_iter(), false);
                const zones = text.split('\n').map(l => l.trim()).filter(Boolean);
                s.set_strv('world-clock-zones', zones);
                saveTimer = null;
                return GLib.SOURCE_REMOVE;
            });
        });

        const tv = new Gtk.TextView({
            buffer: buf, monospace: true,
            margin_top: 8, margin_bottom: 8,
            margin_start: 8, margin_end: 8,
            wrap_mode: Gtk.WrapMode.NONE,
        });
        const frame = new Gtk.Frame();
        frame.set_child(tv);
        const row = new Adw.ActionRow();
        row.set_title('Timezone List');
        row.set_child(frame);
        wg.add(row);
        page.add(wg);
        return page;
    }

    _widgetsPage(s, win) {
        const page = this._page('Widgets', 'view-app-grid-symbolic');

        const all = [
            { id: 'clock',       icon: '🕐', label: 'Clock',       desc: 'Live digital clock'      },
            { id: 'weather',     icon: '🌤️', label: 'Weather',      desc: 'Conditions + forecast'   },
            { id: 'calendar',    icon: '📅', label: 'Calendar',     desc: 'Monthly mini-calendar'   },
            { id: 'worldClock',  icon: '🌍', label: 'World Clock',  desc: 'Multi-timezone display'  },
            { id: 'battery',     icon: '🔋', label: 'Battery',      desc: 'Battery + devices'       },
            { id: 'quickStatus', icon: '📊', label: 'Quick Status', desc: 'Wi-Fi, CPU, RAM'         },
        ];

        const wg = this._group('Enable / Disable');
        // ✅ FIXED: was "Changes apply after toggling the extension" — wrong!
        wg.set_description('Widgets appear and disappear immediately on the desktop');

        all.forEach(({ id, icon, label, desc }) => {
            const active = s.get_strv('active-widgets').includes(id);
            const row    = new Adw.ActionRow();
            row.set_title(`${icon}  ${label}`);
            row.set_subtitle(desc);

            const sw = new Gtk.Switch({ valign: Gtk.Align.CENTER });
            sw.set_active(active);
            sw.connect('state-set', (_w, state) => {
                const cur  = s.get_strv('active-widgets');
                const next = state
                    ? [...new Set([...cur, id])]
                    : cur.filter(x => x !== id);
                s.set_strv('active-widgets', next);
                return false;
            });
            row.add_suffix(sw);
            row.set_activatable_widget(sw);
            wg.add(row);
        });
        page.add(wg);

        // Danger zone
        const dg = this._group('Danger Zone');
        const resetRow = new Adw.ActionRow();
        resetRow.set_title('Reset All Settings');
        resetRow.set_subtitle('Remove all widgets and restore defaults');

        const resetBtn = new Gtk.Button();
        resetBtn.set_label('Reset');
        resetBtn.set_valign(Gtk.Align.CENTER);
        resetBtn.add_css_class('destructive-action');
        resetBtn.connect('clicked', () => {
            const dialog = new Adw.MessageDialog();
            dialog.set_transient_for(win);   // ✅ FIXED: needs parent window
            dialog.set_heading('Reset All Settings?');
            dialog.set_body('All widgets will be removed and settings restored to defaults.');
            dialog.add_response('cancel', 'Cancel');
            dialog.add_response('reset',  'Reset');
            dialog.set_response_appearance('reset', Adw.ResponseAppearance.DESTRUCTIVE);
            dialog.set_default_response('cancel');
            dialog.connect('response', (_d, res) => {
                if (res !== 'reset') return;
                [
                    'blur-radius','panel-opacity','corner-radius','widget-spacing',
                    'color-scheme','snap-to-grid','grid-size','top-bar-margin',
                    'dock-margin','clock-format','clock-show-seconds','weather-location',
                    'weather-unit','weather-refresh-minutes','world-clock-zones',
                    'active-widgets','widget-states','first-run',
                ].forEach(k => s.reset(k));
            });
            dialog.present();
        });
        resetRow.add_suffix(resetBtn);
        dg.add(resetRow);
        page.add(dg);
        return page;
    }

    _aboutPage() {
        const page = this._page('About', 'help-about-symbolic');
        const ag   = this._group('Tahoe Widgets');

        const ver = new Adw.ActionRow();
        ver.set_title('Version');
        ver.set_subtitle('2.1.0 — GNOME 45–50');
        ag.add(ver);

        const src = new Adw.ActionRow();
        src.set_title('Source Code');
        src.set_subtitle('github.com/yourname/tahoe-widgets');
        src.set_activatable(true);
        src.add_suffix(new Gtk.Image({ icon_name: 'external-link-symbolic' }));
        src.connect('activated', () => {
            Gio.AppInfo.launch_default_for_uri(
                'https://github.com/yourname/tahoe-widgets', null);
        });
        ag.add(src);

        const lic = new Adw.ActionRow();
        lic.set_title('License');
        lic.set_subtitle('GNU General Public License v2.0 or later');
        ag.add(lic);

        page.add(ag);
        return page;
    }

    /* ══ Row / page factories (all using setters — no undefined in constructors) */

    _page(title, iconName) {
        const p = new Adw.PreferencesPage();
        p.set_title(title);
        p.set_icon_name(iconName);
        return p;
    }

    _group(title) {
        const g = new Adw.PreferencesGroup();
        g.set_title(title);
        return g;
    }

    _spinRow(s, key, title, min, max, step) {
        const adj = new Gtk.Adjustment({
            lower: min, upper: max,
            step_increment: step, page_increment: step * 5,
        });
        const row = new Adw.SpinRow();
        row.set_title(title);
        row.set_adjustment(adj);
        row.set_value(s.get_int(key));
        row.connect('notify::value', () => s.set_int(key, row.get_value()));
        return row;
    }

    _scaleRow(s, key, title, min, max, step) {
        const adj = new Gtk.Adjustment({
            lower: min, upper: max, step_increment: step,
        });
        const scale = new Gtk.Scale({
            orientation: Gtk.Orientation.HORIZONTAL,
            adjustment: adj, value_pos: Gtk.PositionType.RIGHT,
            digits: 2, hexpand: true, valign: Gtk.Align.CENTER,
        });
        scale.set_value(s.get_double(key));
        scale.connect('value-changed', () => s.set_double(key, scale.get_value()));
        const row = new Adw.ActionRow();
        row.set_title(title);
        row.add_suffix(scale);
        return row;
    }

    _switchRow(s, key, title) {
        const row = new Adw.SwitchRow();
        row.set_title(title);
        row.set_active(s.get_boolean(key));
        row.connect('notify::active', () => s.set_boolean(key, row.get_active()));
        return row;
    }

    _entryRow(s, key, title, _placeholder) {
        const row = new Adw.EntryRow();
        row.set_title(title);
        row.set_show_apply_button(true);
        row.set_text(s.get_string(key) ?? '');
        row.connect('apply', () => s.set_string(key, row.get_text()));
        return row;
    }

    _comboRow(s, key, title, items) {
        const model = new Gtk.StringList();
        items.forEach(i => model.append(i.label));
        const row = new Adw.ComboRow();
        row.set_title(title);
        row.set_model(model);
        const cur = s.get_string(key);
        const idx = items.findIndex(i => i.value === cur);
        row.set_selected(idx >= 0 ? idx : 0);
        row.connect('notify::selected', () => {
            const sel = items[row.get_selected()];
            if (sel) s.set_string(key, sel.value);
        });
        return row;
    }
}
