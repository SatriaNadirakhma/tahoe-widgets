/**
 * QuickStatusWidget — compact card showing:
 * Wi-Fi SSID, Bluetooth status, active Focus, CPU load, memory use.
 * Refreshes every 5 seconds.
 */

import St      from 'gi://St';
import Clutter from 'gi://Clutter';
import GLib    from 'gi://GLib';
import Gio     from 'gi://Gio';

import { BaseWidget } from './baseWidget.js';

export class QuickStatusWidget extends BaseWidget {
    constructor(opts) {
        super({ ...opts, id: 'quickStatus', refreshMs: 5_000 });
    }

    build() {
        this.actor.add_style_class_name('tahoe-quick-status');

        this._header = new St.Label({
            text:        'Status',
            style_class: 'tahoe-label-caption',
            style:       'margin-bottom:8px;',
        });
        this.actor.add_child(this._header);

        this._rows = {};

        const rowDefs = [
            { key: 'wifi',      icon: '󰤨', label: 'Wi-Fi'     },
            { key: 'bluetooth', icon: '󰂯', label: 'Bluetooth'  },
            { key: 'cpu',       icon: '󰘚', label: 'CPU'        },
            { key: 'memory',    icon: '󰍛', label: 'Memory'     },
        ];

        rowDefs.forEach(({ key, icon, label }) => {
            const row = new St.BoxLayout({
                vertical:    false,
                style_class: 'tahoe-status-row',
                x_expand:    true,
                style:       'spacing:10px;',
            });

            const iconLbl = new St.Label({ text: icon, style_class: 'tahoe-status-icon',
                y_align: Clutter.ActorAlign.CENTER });
            const nameLbl = new St.Label({ text: label, style_class: 'tahoe-status-text',
                x_expand: true, y_align: Clutter.ActorAlign.CENTER });
            const valLbl  = new St.Label({ text: '—', style_class: 'tahoe-status-value',
                y_align: Clutter.ActorAlign.CENTER });

            row.add_child(iconLbl);
            row.add_child(nameLbl);
            row.add_child(valLbl);

            this._rows[key] = valLbl;
            this.actor.add_child(row);
        });
    }

    async refresh() {
        await Promise.allSettled([
            this._updateWifi(),
            this._updateBluetooth(),
            this._updateCpu(),
            this._updateMemory(),
        ]);
    }

    async _updateWifi() {
        try {
            // Read active connection SSID via NM DBus
            const ssid = await this._nmActiveSSID();
            this._rows.wifi.set_text(ssid || 'Off');
        } catch { this._rows.wifi.set_text('—'); }
    }

    async _updateBluetooth() {
        try {
            const powered = await this._rfkillBtPowered();
            this._rows.bluetooth.set_text(powered ? 'On' : 'Off');
        } catch { this._rows.bluetooth.set_text('—'); }
    }

    async _updateCpu() {
        try {
            // Read /proc/stat for a quick one-shot load estimate
            const load = await this._readCpuLoad();
            this._rows.cpu.set_text(`${load}%`);
        } catch { this._rows.cpu.set_text('—'); }
    }

    async _updateMemory() {
        try {
            const { used, total } = await this._readMemInfo();
            const pct = Math.round(used / total * 100);
            this._rows.memory.set_text(`${pct}%`);
        } catch { this._rows.memory.set_text('—'); }
    }

    /* ── System data helpers ─────────────────────────────────────── */

    _readFile(path) {
        return new Promise((resolve, reject) => {
            const file = Gio.File.new_for_path(path);
            file.load_contents_async(null, (f, res) => {
                try {
                    const [, bytes] = f.load_contents_finish(res);
                    resolve(new TextDecoder().decode(bytes));
                } catch (e) { reject(e); }
            });
        });
    }

    async _readCpuLoad() {
        // Two samples 200ms apart → δidle / δtotal
        const sample = async () => {
            const text  = await this._readFile('/proc/stat');
            const line  = text.split('\n')[0];
            const parts = line.trim().split(/\s+/).slice(1).map(Number);
            const idle  = parts[3] + (parts[4] ?? 0); // idle + iowait
            const total = parts.reduce((a, b) => a + b, 0);
            return { idle, total };
        };

        const a = await sample();
        await new Promise(r => GLib.timeout_add(GLib.PRIORITY_DEFAULT, 200, () => { r(); return GLib.SOURCE_REMOVE; }));
        const b = await sample();

        const dTotal = b.total - a.total;
        const dIdle  = b.idle  - a.idle;
        return dTotal === 0 ? 0 : Math.round((1 - dIdle / dTotal) * 100);
    }

    async _readMemInfo() {
        const text    = await this._readFile('/proc/meminfo');
        const parse   = key => {
            const match = text.match(new RegExp(`^${key}:\\s+(\\d+)`, 'm'));
            return match ? parseInt(match[1], 10) : 0;
        };
        const total   = parse('MemTotal');
        const free    = parse('MemFree');
        const buffers = parse('Buffers');
        const cached  = parse('Cached');
        const used    = total - free - buffers - cached;
        return { used, total };
    }

    async _nmActiveSSID() {
        return new Promise((resolve, reject) => {
            const conn = Gio.DBus.system;
            conn.call(
                'org.freedesktop.NetworkManager',
                '/org/freedesktop/NetworkManager',
                'org.freedesktop.DBus.Properties',
                'Get',
                new GLib.Variant('(ss)', [
                    'org.freedesktop.NetworkManager',
                    'ActiveConnections'
                ]),
                new GLib.VariantType('(v)'),
                Gio.DBusCallFlags.NONE, 2000, null,
                (src, res) => {
                    try {
                        const val       = src.call_finish(res);
                        const paths     = val.get_child_value(0).unpack().recursiveUnpack();
                        if (!paths.length) { resolve(null); return; }
                        // Get the ID (SSID) of first active connection
                        conn.call(
                            'org.freedesktop.NetworkManager',
                            paths[0],
                            'org.freedesktop.DBus.Properties', 'Get',
                            new GLib.Variant('(ss)', ['org.freedesktop.NetworkManager.Connection.Active', 'Id']),
                            new GLib.VariantType('(v)'),
                            Gio.DBusCallFlags.NONE, 2000, null,
                            (s2, r2) => {
                                try { resolve(s2.call_finish(r2).get_child_value(0).unpack()); }
                                catch (e) { reject(e); }
                            }
                        );
                    } catch (e) { reject(e); }
                }
            );
        });
    }

    async _rfkillBtPowered() {
        // Simpler: read /sys/class/rfkill/*/type and soft-block status
        try {
            const dir  = Gio.File.new_for_path('/sys/class/rfkill');
            const iter = dir.enumerate_children('standard::name', Gio.FileQueryInfoFlags.NONE, null);
            let info;
            while ((info = iter.next_file(null))) {
                const name    = info.get_name();
                const typePath = `/sys/class/rfkill/${name}/type`;
                const softPath = `/sys/class/rfkill/${name}/soft`;
                try {
                    const type = (await this._readFile(typePath)).trim();
                    if (type !== 'bluetooth') continue;
                    const soft = (await this._readFile(softPath)).trim();
                    return soft === '0'; // '0' = not blocked = powered on
                } catch { continue; }
            }
        } catch { /* rfkill not available */ }
        return false;
    }
}
