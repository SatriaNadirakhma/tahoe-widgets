/**
 * BatteryWidget — shows system battery + connected Bluetooth devices.
 * Uses UPower via DBus. Refreshes every 30 seconds.
 */

import St      from 'gi://St';
import Clutter from 'gi://Clutter';
import GLib    from 'gi://GLib';
import Gio     from 'gi://Gio';

import { BaseWidget } from './baseWidget.js';

const UPOWER_BUS  = 'org.freedesktop.UPower';
const UPOWER_PATH = '/org/freedesktop/UPower';
const UPOWER_IFACE = 'org.freedesktop.UPower';
const DEVICE_IFACE = 'org.freedesktop.UPower.Device';

// UPower device types
const DEVICE_TYPES = {
    1: '🖱️ Mouse',
    2: '⌨️ Keyboard',
    3: '🎮 Controller',
    5: '🔋 Battery',
    8: '🖥️ Display',
};

export class BatteryWidget extends BaseWidget {
    constructor(opts) {
        super({ ...opts, id: 'battery', refreshMs: 30_000 });
    }

    build() {
        this.actor.add_style_class_name('tahoe-battery');

        this._header = new St.Label({
            text:        'Battery',
            style_class: 'tahoe-label-caption',
            style:       'margin-bottom:10px;',
        });

        // Main battery display
        this._mainBox = new St.BoxLayout({ vertical: true, style: 'spacing:6px;' });

        this._percentLabel = new St.Label({
            text:        '--%',
            style_class: 'tahoe-battery-percent',
        });

        this._statusLabel = new St.Label({
            text:        '',
            style_class: 'tahoe-label-small',
        });

        // Progress bar
        this._barBg = new St.Widget({
            style_class: 'tahoe-battery-bar-bg',
            x_expand:    true,
            height:      8,
        });
        this._barFill = new St.Widget({
            style_class: 'tahoe-battery-bar-fill',
            height:      8,
            width:       0,
        });
        this._barBg.add_child(this._barFill);

        this._mainBox.add_child(this._percentLabel);
        this._mainBox.add_child(this._barBg);
        this._mainBox.add_child(this._statusLabel);

        // Divider
        this._divider = new St.Widget({
            style: 'background: rgba(255,255,255,0.10); height: 1px; margin: 8px 0;',
            x_expand: true,
        });

        // Connected devices section
        this._devicesBox = new St.BoxLayout({ vertical: true, style: 'spacing:6px;' });

        this.actor.add_child(this._header);
        this.actor.add_child(this._mainBox);
        this.actor.add_child(this._divider);
        this.actor.add_child(this._devicesBox);
    }

    async refresh() {
        try {
            await this._updateMainBattery();
            await this._updateDevices();
        } catch (err) {
            this._percentLabel.set_text('⚠');
            this._statusLabel.set_text(err.message);
        }
    }

    async _updateMainBattery() {
        const displayDevice = await this._dbusProp(
            UPOWER_BUS,
            '/org/freedesktop/UPower/devices/DisplayDevice',
            DEVICE_IFACE,
            'Percentage'
        );
        const state = await this._dbusProp(
            UPOWER_BUS,
            '/org/freedesktop/UPower/devices/DisplayDevice',
            DEVICE_IFACE,
            'State'
        );

        const pct = Math.round(displayDevice ?? 0);
        this._percentLabel.set_text(`${pct}%`);

        // State: 1=Charging 2=Discharging 4=Full 6=PendingCharge
        const charging    = state === 1 || state === 6;
        const full        = state === 4;
        const statusText  = full ? '⚡ Fully Charged' : charging ? '⚡ Charging' : '';
        this._statusLabel.set_text(statusText);

        // Update bar width (will be set after allocation)
        const barClass = pct <= 20
            ? 'tahoe-battery-bar-fill low'
            : charging
                ? 'tahoe-battery-bar-fill charging'
                : 'tahoe-battery-bar-fill';
        this._barFill.style_class = barClass;

        // Use allocation for bar width
        this._barBg.connect('notify::allocation', () => {
            const w = this._barBg.get_width();
            this._barFill.set_width(Math.round(w * pct / 100));
        });
    }

    async _updateDevices() {
        this._devicesBox.remove_all_children();

        let devices = [];
        try {
            devices = await this._dbusCall(
                UPOWER_BUS, UPOWER_PATH, UPOWER_IFACE, 'EnumerateDevices', null,
                new GLib.VariantType('(ao)')
            );
            devices = devices?.[0] ?? [];
        } catch { return; }

        for (const path of devices) {
            try {
                const type    = await this._dbusProp(UPOWER_BUS, path, DEVICE_IFACE, 'Type');
                const pct     = await this._dbusProp(UPOWER_BUS, path, DEVICE_IFACE, 'Percentage');
                const model   = await this._dbusProp(UPOWER_BUS, path, DEVICE_IFACE, 'Model');
                const powered = await this._dbusProp(UPOWER_BUS, path, DEVICE_IFACE, 'PowerSupply');

                // Skip system battery (shown above) and unpowered/absent devices
                if (type === 5 || powered || pct === 0) continue;

                const icon    = DEVICE_TYPES[type] ?? '🔌';
                const row     = new St.BoxLayout({ vertical: false, style: 'spacing:8px;', x_expand: true });

                row.add_child(new St.Label({
                    text:     icon,
                    style_class: 'tahoe-status-icon',
                    y_align:  Clutter.ActorAlign.CENTER,
                }));
                row.add_child(new St.Label({
                    text:     model || 'Device',
                    style_class: 'tahoe-status-text',
                    x_expand: true,
                    y_align:  Clutter.ActorAlign.CENTER,
                }));
                row.add_child(new St.Label({
                    text:     `${Math.round(pct)}%`,
                    style_class: 'tahoe-status-value',
                    y_align:  Clutter.ActorAlign.CENTER,
                }));

                this._devicesBox.add_child(row);
            } catch { /* skip device on error */ }
        }
    }

    /* ── DBus helpers ─────────────────────────────────────────────── */

    _dbusProp(busName, path, iface, prop) {
        return new Promise((resolve, reject) => {
            const proxy = Gio.DBusProxy.new_for_bus_sync(
                Gio.BusType.SYSTEM, Gio.DBusProxyFlags.NONE, null,
                busName, path, 'org.freedesktop.DBus.Properties', null
            );
            proxy.call(
                'Get',
                new GLib.Variant('(ss)', [iface, prop]),
                Gio.DBusCallFlags.NONE, 2000, null,
                (p, res) => {
                    try {
                        const val = p.call_finish(res);
                        resolve(val.get_child_value(0).unpack());
                    } catch (e) { reject(e); }
                }
            );
        });
    }

    _dbusCall(busName, path, iface, method, params, retType) {
        return new Promise((resolve, reject) => {
            const conn = Gio.DBus.system;
            conn.call(busName, path, iface, method, params,
                retType, Gio.DBusCallFlags.NONE, 2000, null,
                (src, res) => {
                    try {
                        const val = src.call_finish(res);
                        resolve(val.recursiveUnpack());
                    } catch (e) { reject(e); }
                }
            );
        });
    }
}
