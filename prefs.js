/**
 * prefs.js — GNOME Extensions Preferences panel.
 * Opens via gnome-extensions-app or `gnome-extensions prefs tahoe-widgets@gnome`.
 * Uses Adw (libadwaita) widgets available since GNOME 42.
 */

import Adw  from 'gi://Adw';
import Gtk  from 'gi://Gtk';
import Gdk  from 'gi://Gdk';
import GLib from 'gi://GLib';
import Gio  from 'gi://Gio';

import { ExtensionPreferences, gettext as _ }
    from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class TahoePreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        window.set_default_size(640, 720);
        window.set_title('Tahoe Widgets');

        /* ── Appearance page ───────────────────────────────────── */
        const appearancePage = new Adw.PreferencesPage({
            title: 'Appearance',
            icon_name: 'preferences-desktop-appearance-symbolic',
        });
        window.add(appearancePage);

        const visualGroup = new Adw.PreferencesGroup({ title: 'Visual' });
        appearancePage.add(visualGroup);

        // Blur radius
        visualGroup.add(this._makeSpinRow(settings, 'blur-radius',
            'Blur Radius', 'Background blur strength (px)', 0, 60, 1));

        // Opacity
        visualGroup.add(this._makeScaleRow(settings, 'opacity',
            'Opacity', 'Widget background opacity', 0.0, 1.0, 0.05));

        // Corner radius
        visualGroup.add(this._makeSpinRow(settings, 'corner-radius',
            'Corner Radius', 'Rounded corner size (px)', 0, 32, 1));

        // Widget spacing
        visualGroup.add(this._makeSpinRow(settings, 'widget-spacing',
            'Widget Spacing', 'Gap between widgets (px)', 4, 48, 2));

        // Clock format
        const clockGroup = new Adw.PreferencesGroup({ title: 'Clock' });
        appearancePage.add(clockGroup);

        clockGroup.add(this._makeComboRow(settings, 'clock-format',
            'Format', 'Time display format',
            [{ value: '12h', label: '12-hour (AM/PM)' },
             { value: '24h', label: '24-hour'         }]));

        /* ── Weather page ──────────────────────────────────────── */
        const weatherPage = new Adw.PreferencesPage({
            title: 'Weather',
            icon_name: 'weather-clear-symbolic',
        });
        window.add(weatherPage);

        const weatherGroup = new Adw.PreferencesGroup({ title: 'Location & Units' });
        weatherPage.add(weatherGroup);

        weatherGroup.add(this._makeEntryRow(settings, 'weather-location',
            'Location', 'City name or leave blank for auto-detect'));

        weatherGroup.add(this._makeComboRow(settings, 'weather-unit',
            'Unit', 'Temperature unit',
            [{ value: 'celsius',    label: 'Celsius (°C)'    },
             { value: 'fahrenheit', label: 'Fahrenheit (°F)' }]));

        weatherGroup.add(this._makeComboRow(settings, 'weather-provider',
            'Provider', 'Data source (Open-Meteo needs no key)',
            [{ value: 'openmeteo',      label: 'Open-Meteo (free)'     },
             { value: 'openweathermap', label: 'OpenWeatherMap (key required)' }]));

        weatherGroup.add(this._makeEntryRow(settings, 'openweathermap-api-key',
            'OWM API Key', 'Required only for OpenWeatherMap'));

        /* ── World Clock page ──────────────────────────────────── */
        const worldPage = new Adw.PreferencesPage({
            title: 'World Clock',
            icon_name: 'globe-symbolic',
        });
        window.add(worldPage);

        const worldGroup = new Adw.PreferencesGroup({
            title:       'Timezones',
            description: 'One IANA timezone per line, e.g. America/New_York',
        });
        worldPage.add(worldGroup);

        const tzBuffer = new Gtk.TextBuffer();
        tzBuffer.set_text(settings.get_strv('world-clock-cities').join('\n'), -1);
        const tzView = new Gtk.TextView({
            buffer:       tzBuffer,
            monospace:    true,
            margin_top:   8,
            margin_bottom: 8,
            margin_start: 8,
            margin_end:   8,
        });
        const tzFrame = new Gtk.Frame();
        tzFrame.set_child(tzView);

        tzBuffer.connect('changed', () => {
            const lines = tzBuffer.get_text(
                tzBuffer.get_start_iter(), tzBuffer.get_end_iter(), false
            ).split('\n').map(l => l.trim()).filter(Boolean);
            settings.set_strv('world-clock-cities', lines);
        });

        const tzRow = new Adw.ActionRow({ title: 'Timezones' });
        tzRow.set_child(tzFrame);
        worldGroup.add(tzRow);

        /* ── Layout page ───────────────────────────────────────── */
        const layoutPage = new Adw.PreferencesPage({
            title: 'Layout',
            icon_name: 'view-grid-symbolic',
        });
        window.add(layoutPage);

        const snapGroup = new Adw.PreferencesGroup({ title: 'Snapping' });
        layoutPage.add(snapGroup);

        snapGroup.add(this._makeSwitchRow(settings, 'snap-to-grid',
            'Snap to Grid', 'Align widgets to a pixel grid when dragging'));

        snapGroup.add(this._makeSpinRow(settings, 'snap-grid-size',
            'Grid Size', 'Snapping grid size (px)', 4, 64, 4));

        /* ── Widgets page ──────────────────────────────────────── */
        const widgetsPage = new Adw.PreferencesPage({
            title: 'Widgets',
            icon_name: 'view-app-grid-symbolic',
        });
        window.add(widgetsPage);

        const enabledGroup = new Adw.PreferencesGroup({
            title:       'Enable / Disable',
            description: 'Changes take effect after restarting the extension',
        });
        widgetsPage.add(enabledGroup);

        const allWidgets = [
            { id: 'clock',       label: 'Clock'        },
            { id: 'weather',     label: 'Weather'       },
            { id: 'calendar',    label: 'Calendar'      },
            { id: 'worldClock',  label: 'World Clock'   },
            { id: 'battery',     label: 'Battery'       },
            { id: 'quickStatus', label: 'Quick Status'  },
        ];

        allWidgets.forEach(({ id, label }) => {
            const enabled = settings.get_strv('enabled-widgets').includes(id);
            const row     = new Adw.SwitchRow({ title: label });
            row.set_active(enabled);
            row.connect('notify::active', () => {
                const cur = settings.get_strv('enabled-widgets');
                const next = row.get_active()
                    ? [...new Set([...cur, id])]
                    : cur.filter(x => x !== id);
                settings.set_strv('enabled-widgets', next);
            });
            enabledGroup.add(row);
        });
    }

    /* ── Row factory helpers ─────────────────────────────────────── */

    _makeSpinRow(settings, key, title, subtitle, min, max, step) {
        const row = new Adw.SpinRow({
            title, subtitle,
            adjustment: new Gtk.Adjustment({ lower: min, upper: max, step_increment: step }),
        });
        row.set_value(settings.get_int(key));
        row.connect('notify::value', () => settings.set_int(key, row.get_value()));
        return row;
    }

    _makeScaleRow(settings, key, title, subtitle, min, max, step) {
        const scale = new Gtk.Scale({
            orientation:    Gtk.Orientation.HORIZONTAL,
            adjustment:     new Gtk.Adjustment({ lower: min, upper: max, step_increment: step }),
            value_pos:      Gtk.PositionType.RIGHT,
            digits:         2,
            hexpand:        true,
            valign:         Gtk.Align.CENTER,
        });
        scale.set_value(settings.get_double(key));
        scale.connect('value-changed', () => settings.set_double(key, scale.get_value()));
        const row = new Adw.ActionRow({ title, subtitle });
        row.add_suffix(scale);
        return row;
    }

    _makeEntryRow(settings, key, title, subtitle) {
        const row = new Adw.EntryRow({ title, show_apply_button: true });
        row.set_text(settings.get_string(key));
        row.connect('apply', () => settings.set_string(key, row.get_text()));
        return row;
    }

    _makeSwitchRow(settings, key, title, subtitle) {
        const row = new Adw.SwitchRow({ title, subtitle });
        row.set_active(settings.get_boolean(key));
        row.connect('notify::active', () => settings.set_boolean(key, row.get_active()));
        return row;
    }

    _makeComboRow(settings, key, title, subtitle, items) {
        const model  = new Gtk.StringList();
        items.forEach(i => model.append(i.label));
        const row    = new Adw.ComboRow({ title, subtitle, model });
        const curVal = settings.get_string(key);
        const idx    = items.findIndex(i => i.value === curVal);
        row.set_selected(idx >= 0 ? idx : 0);
        row.connect('notify::selected', () => {
            settings.set_string(key, items[row.get_selected()]?.value ?? items[0].value);
        });
        return row;
    }
}
