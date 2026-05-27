/**
 * otherWidgets.js v3.0
 *
 * WorldClockWidget — redesigned as macOS Medium (2×4 = 329×155 px):
 *   Up to 4 mini analog clocks drawn with Cairo.
 *   White face = daytime (06:00–19:59), dark face = nighttime.
 *   City name + day/offset label beneath each clock.
 *
 * BatteryWidget & QuickStatusWidget — unchanged.
 */

import St         from 'gi://St';
import Clutter    from 'gi://Clutter';
import Gio        from 'gi://Gio';
import GLib       from 'gi://GLib';
import Pango      from 'gi://Pango';
import PangoCairo from 'gi://PangoCairo';
import { BaseWidget, WIDGET_MEDIUM } from './baseWidget.js';

const LINE_CAP_ROUND = 1;

/* ══════════════════════════════════════════════════════════════════
   WorldClockWidget
   ══════════════════════════════════════════════════════════════════ */

export class WorldClockWidget extends BaseWidget {

    build() {
        this.actor.add_style_class_name('tahoe-world-clock');
        this.actor.set_size(WIDGET_MEDIUM.width, WIDGET_MEDIUM.height);
        this._content.style = 'spacing:0; padding:0;';

        this._dial = new St.DrawingArea({
            reactive: false,
            x_expand: true,
            y_expand: true,
        });
        this._dial.connect('repaint', area => this._drawWorldClock(area));
        this._content.add_child(this._dial);

        this._timerId = this.startTimer(1000, () => this._tick(), false);
        this._tick();

        this._unsubs.push(
            this._state.subscribe('settings:world-clock-zones',
                () => this._tick()),
            this._state.subscribe('settings:clock-format',
                () => this._tick()),
        );
    }

    _tick() {
        this._dial.queue_repaint();
    }

    /* ── Cairo world-clock drawing ──────────────────────────────── */

    _drawWorldClock(area) {
        const cr    = area.get_context();
        const w     = area.get_width();
        const h     = area.get_height();
        const zones = (this._state.worldClockZones ?? []).slice(0, 4);

        if (!zones.length) {
            this._drawPlaceholder(cr, w, h);
            cr.$dispose();
            return;
        }

        const count  = zones.length;
        const cellW  = w / count;
        // Clock face radius — fits within cell, leaves room for labels
        const clockR = Math.min(cellW / 2 - 8, h * 0.40);
        const clockCY = h * 0.42;          // vertical centre of clock face
        const now    = new Date();

        for (let i = 0; i < count; i++) {
            const tz = zones[i];
            const cx = cellW * i + cellW / 2;

            // ── Resolve local time in this timezone ────────────────
            let tzHr = 0, tzMin = 0, tzSec = 0;
            try {
                const parts = new Intl.DateTimeFormat('en-US', {
                    timeZone: tz,
                    hour: 'numeric', minute: '2-digit', second: '2-digit',
                    hour12: false,
                }).formatToParts(now);
                const p  = Object.fromEntries(parts.map(x => [x.type, x.value]));
                tzHr  = parseInt(p.hour   ?? '0');
                tzMin = parseInt(p.minute ?? '0');
                tzSec = parseInt(p.second ?? '0');
            } catch { /* fallback to 0 */ }

            const isDaytime = tzHr >= 6 && tzHr < 20;

            // ── Clock face ─────────────────────────────────────────
            cr.arc(cx, clockCY, clockR, 0, 2 * Math.PI);
            cr.setSourceRGBA(
                ...( isDaytime ? [1, 1, 1, 0.92] : [0.17, 0.16, 0.17, 0.92] )
            );
            cr.fill();

            const fg = isDaytime ? [0.15, 0.15, 0.15] : [1, 1, 1];

            // ── Hour tick marks ────────────────────────────────────
            cr.setLineCap(LINE_CAP_ROUND);
            for (let t = 0; t < 12; t++) {
                const a   = (t / 12) * 2 * Math.PI - Math.PI / 2;
                const isH = (t % 3 === 0);
                const r1  = clockR;
                const r2  = clockR - (isH ? 6 : 3);
                cr.setSourceRGBA(...fg, isH ? 0.55 : 0.25);
                cr.setLineWidth(isH ? 1.5 : 0.8);
                cr.moveTo(cx + Math.cos(a) * r1, clockCY + Math.sin(a) * r1);
                cr.lineTo(cx + Math.cos(a) * r2, clockCY + Math.sin(a) * r2);
                cr.stroke();
            }

            // ── Hour hand ──────────────────────────────────────────
            const hr       = (tzHr % 12) + tzMin / 60;
            const hrAngle  = (hr  / 12) * 2 * Math.PI - Math.PI / 2;
            cr.setLineCap(LINE_CAP_ROUND);
            cr.setLineWidth(2);
            cr.setSourceRGBA(...fg, 0.95);
            cr.moveTo(cx, clockCY);
            cr.lineTo(cx + Math.cos(hrAngle) * clockR * 0.50,
                      clockCY + Math.sin(hrAngle) * clockR * 0.50);
            cr.stroke();

            // ── Minute hand ────────────────────────────────────────
            const minAngle = ((tzMin + tzSec / 60) / 60) * 2 * Math.PI - Math.PI / 2;
            cr.setLineWidth(1.5);
            cr.setSourceRGBA(...fg, 0.95);
            cr.moveTo(cx, clockCY);
            cr.lineTo(cx + Math.cos(minAngle) * clockR * 0.72,
                      clockCY + Math.sin(minAngle) * clockR * 0.72);
            cr.stroke();

            // ── Second hand (orange) ───────────────────────────────
            const secAngle = (tzSec / 60) * 2 * Math.PI - Math.PI / 2;
            cr.setLineWidth(0.8);
            cr.setSourceRGBA(1, 0.502, 0, 0.9);
            cr.moveTo(cx - Math.cos(secAngle) * clockR * 0.15,
                      clockCY - Math.sin(secAngle) * clockR * 0.15);
            cr.lineTo(cx + Math.cos(secAngle) * clockR * 0.78,
                      clockCY + Math.sin(secAngle) * clockR * 0.78);
            cr.stroke();

            // ── Center dots ────────────────────────────────────────
            cr.arc(cx, clockCY, 3, 0, 2 * Math.PI);
            cr.setSourceRGBA(...fg, 1);
            cr.fill();
            cr.arc(cx, clockCY, 1.5, 0, 2 * Math.PI);
            cr.setSourceRGBA(1, 0.502, 0, 1);
            cr.fill();

            // ── Text labels ────────────────────────────────────────
            try {
                const labelY = clockCY + clockR + 7;

                // City name
                const cityLayout = PangoCairo.create_layout(cr);
                cityLayout.set_font_description(
                    Pango.FontDescription.from_string('Inter Semi-Bold 8')
                );
                cityLayout.set_alignment(Pango.Alignment.CENTER);
                cityLayout.set_width(Pango.units_from_double(cellW - 4));
                const cityName = tz.split('/').pop().replace(/_/g, ' ');
                cityLayout.set_text(cityName, -1);
                const [, cInk] = cityLayout.get_pixel_extents();
                cr.moveTo(cx - (cInk.width / 2 + cInk.x), labelY);
                cr.setSourceRGBA(1, 1, 1, 0.92);
                PangoCairo.show_layout(cr, cityLayout);

                // Day + UTC offset
                const offLayout = PangoCairo.create_layout(cr);
                offLayout.set_font_description(
                    Pango.FontDescription.from_string('Inter 7')
                );
                offLayout.set_alignment(Pango.Alignment.CENTER);
                offLayout.set_width(Pango.units_from_double(cellW - 4));

                const tzDate  = new Date(now.toLocaleString('en-US', { timeZone: tz }));
                const dayDiff = tzDate.getDate() - now.getDate();
                const dayStr  = dayDiff > 0 ? 'Tomorrow'
                              : dayDiff < 0 ? 'Yesterday'
                              : 'Today';

                const offMin  = this._tzOffsetMinutes(tz, now);
                const sign    = offMin >= 0 ? '+' : '−';
                const offH    = Math.floor(Math.abs(offMin) / 60);
                const offM    = Math.abs(offMin) % 60;
                const offStr  = offM > 0
                    ? `${sign}${offH}h${offM}m`
                    : `${sign}${offH}HRS`;

                offLayout.set_text(`${dayStr}\n${offStr}`, -1);
                const [, oInk] = offLayout.get_pixel_extents();
                cr.moveTo(cx - (oInk.width / 2 + oInk.x), labelY + 12);
                cr.setSourceRGBA(0.55, 0.55, 0.55, 1);
                PangoCairo.show_layout(cr, offLayout);

            } catch { /* skip labels if Pango unavailable */ }
        }

        cr.$dispose();
    }

    _drawPlaceholder(cr, w, h) {
        try {
            const layout = PangoCairo.create_layout(cr);
            layout.set_font_description(
                Pango.FontDescription.from_string('Inter 10')
            );
            layout.set_text('No timezones — add them in Settings', -1);
            const [, ink] = layout.get_pixel_extents();
            cr.moveTo(w / 2 - (ink.width / 2 + ink.x),
                      h / 2 - (ink.height / 2 + ink.y));
            cr.setSourceRGBA(1, 1, 1, 0.4);
            PangoCairo.show_layout(cr, layout);
        } catch {}
    }

    _tzOffsetMinutes(tz, date) {
        try {
            const utc = new Date(date.toLocaleString('en-US', { timeZone: 'UTC' }));
            const tzd = new Date(date.toLocaleString('en-US', { timeZone: tz }));
            return (tzd - utc) / 60_000;
        } catch { return 0; }
    }

    destroy() {
        this.stopTimer(this._timerId);
        super.destroy();
    }
}

/* ══════════════════════════════════════════════════════════════════
   BatteryWidget — rewritten to reliably detect laptop battery
   ══════════════════════════════════════════════════════════════════ */
const UPOWER_BUS = 'org.freedesktop.UPower';
const DISP_PATH  = '/org/freedesktop/UPower/devices/DisplayDevice';
const DEV_IFACE  = 'org.freedesktop.UPower.Device';
const PROP_IFACE = 'org.freedesktop.DBus.Properties';
const DEVICE_ICON = { 1:'🖱️', 2:'⌨️', 3:'🎮', 5:'🔋', 8:'🖥️' };

export class BatteryWidget extends BaseWidget {
    build() {
        this.actor.add_style_class_name('tahoe-battery');
        this._batPath = null;
        this._upowerIds = [];
        this.showLoading();
        this._refresh();
        this.startTimer(30_000, () => this._refresh());
        this._subscribeUPower();
    }

    /* ══ Real-time UPower listener ═════════════════════════════════ */

    _subscribeUPower() {
        try {
            const id1 = Gio.DBus.system.signal_subscribe(
                UPOWER_BUS, DEV_IFACE, 'PropertiesChanged',
                null, null, Gio.DBusSignalFlags.NONE,
                () => this._refresh());
            if (id1 != null) this._upowerIds.push(id1);
        } catch {}

        // Re-enumerate when devices added/removed
        try {
            const id2 = Gio.DBus.system.signal_subscribe(
                UPOWER_BUS, 'org.freedesktop.UPower', 'DeviceAdded',
                null, null, Gio.DBusSignalFlags.NONE,
                () => { this._batPath = null; this._refresh(); });
            if (id2 != null) this._upowerIds.push(id2);
        } catch {}

        try {
            const id3 = Gio.DBus.system.signal_subscribe(
                UPOWER_BUS, 'org.freedesktop.UPower', 'DeviceRemoved',
                null, null, Gio.DBusSignalFlags.NONE,
                () => { this._batPath = null; this._refresh(); });
            if (id3 != null) this._upowerIds.push(id3);
        } catch {}
    }

    _cleanupUPower() {
        this._upowerIds.forEach(id => {
            try { Gio.DBus.system.signal_unsubscribe(id); } catch {}
        });
        this._upowerIds = [];
    }

    /* ══ Battery path detection ════════════════════════════════════ */

    async _findBattery() {
        if (this._batPath) return this._batPath;

        // Try DisplayDevice first — fast, no extra round-trips
        try {
            const pct = await this._prop(DISP_PATH, 'Percentage');
            if (pct != null) { this._batPath = DISP_PATH; return this._batPath; }
        } catch {}

        // Fall back to enumerating actual devices for the first internal battery
        try {
            const result = await this._dbusCall(
                UPOWER_BUS, '/org/freedesktop/UPower',
                'org.freedesktop.UPower', 'EnumerateDevices',
                null, new GLib.VariantType('(ao)'));
            const paths = result?.[0] ?? [];
            for (const path of paths) {
                try {
                    const type = await this._prop(path, 'Type');
                    if (type === 2) { this._batPath = path; return this._batPath; }
                } catch {}
            }
        } catch {}

        return null;
    }

    /* ══ Data refresh ══════════════════════════════════════════════ */

    async _refresh() {
        try {
            const path = await this._findBattery();
            if (!path) { this.showError('No battery'); return; }

            const [pct, state] = await Promise.all([
                this._prop(path, 'Percentage').catch(() => null),
                this._prop(path, 'State').catch(() => null),
            ]);
            if (pct == null) { this.showError('Battery info unavailable'); return; }

            this._renderMain(Math.round(pct), state ?? 2);
        } catch {
            this.showError('Battery info unavailable');
        }
    }

    /* ══ UI ════════════════════════════════════════════════════════ */

    _renderMain(pct, state) {
        this._content.remove_all_children();
        this._content.add_child(new St.Label({ text: 'Battery', style_class: 'tahoe-label-caption', style: 'margin-bottom:8px;' }));
        const charging = state === 1, full = state === 4;
        const icon = full ? '⚡' : charging ? '⚡' : pct <= 20 ? '🪫' : '🔋';
        const topRow = new St.BoxLayout({ vertical: false, style: 'spacing:6px;' });
        topRow.add_child(new St.Label({ text: icon, style_class: 'tahoe-label-medium', y_align: Clutter.ActorAlign.CENTER }));
        topRow.add_child(new St.Label({ text: `${pct}%`, style_class: 'tahoe-battery-percent', y_align: Clutter.ActorAlign.CENTER }));
        if (charging || full) topRow.add_child(new St.Label({ text: full ? 'Full' : 'Charging', style_class: 'tahoe-label-small tahoe-muted', y_align: Clutter.ActorAlign.CENTER }));
        this._content.add_child(topRow);
        const barBg = new St.Widget({ x_expand: true, style: 'background:rgba(255,255,255,0.14);border-radius:4px;height:6px;margin:6px 0;' });
        const barColor = pct <= 20 ? 'rgba(255,80,80,0.9)' : charging ? 'rgba(80,220,100,0.9)' : 'rgba(255,255,255,0.80)';
        barBg.add_child(new St.Widget({ style: `background:${barColor};border-radius:4px;height:6px;width:${pct}%;` }));
        this._content.add_child(barBg);
    }

    /* ══ D-Bus helpers ═════════════════════════════════════════════ */

    _prop(path, prop) {
        return new Promise((resolve, reject) => {
            Gio.DBus.system.call(UPOWER_BUS, path, PROP_IFACE, 'Get', new GLib.Variant('(ss)',[DEV_IFACE,prop]), new GLib.VariantType('(v)'), Gio.DBusCallFlags.NONE, 5000, null,
                (src, res) => { try { resolve(src.call_finish(res).get_child_value(0).unpack()); } catch(e) { reject(e); } });
        });
    }

    _dbusCall(bus, path, iface, method, params, retType) {
        return new Promise((resolve, reject) => {
            Gio.DBus.system.call(bus, path, iface, method, params, retType, Gio.DBusCallFlags.NONE, 5000, null,
                (src, res) => { try { resolve(src.call_finish(res).recursiveUnpack()); } catch(e) { reject(e); } });
        });
    }

    /* ══ Lifecycle ═════════════════════════════════════════════════ */

    destroy() {
        this._cleanupUPower();
        super.destroy();
    }
}

/* ══════════════════════════════════════════════════════════════════
   QuickStatusWidget — unchanged
   ══════════════════════════════════════════════════════════════════ */
export class QuickStatusWidget extends BaseWidget {
    build() {
        this.actor.add_style_class_name('tahoe-quick-status');
        this._content.add_child(new St.Label({ text: 'Status', style_class: 'tahoe-label-caption', style: 'margin-bottom:8px;' }));
        this._vals = {};
        [{ key:'wifi',icon:'📶',label:'Wi-Fi'},{ key:'bt',icon:'📡',label:'Bluetooth'},{ key:'cpu',icon:'💻',label:'CPU'},{ key:'mem',icon:'🧠',label:'Memory'}].forEach(({ key, icon, label }) => {
            const row = new St.BoxLayout({ vertical: false, style: 'spacing:8px; padding:4px 0;', x_expand: true });
            row.add_child(new St.Label({ text: icon, style_class: 'tahoe-status-icon', y_align: Clutter.ActorAlign.CENTER }));
            row.add_child(new St.Label({ text: label, style_class: 'tahoe-status-text', x_expand: true, y_align: Clutter.ActorAlign.CENTER }));
            const val = new St.Label({ text: '—', style_class: 'tahoe-status-value', y_align: Clutter.ActorAlign.CENTER });
            this._vals[key] = val; row.add_child(val); this._content.add_child(row);
        });
        this.startTimer(5_000, () => this._refresh());
    }
    async _refresh() { await Promise.allSettled([this._wifi(),this._bluetooth(),this._cpu(),this._memory()]); }
    async _wifi() { try { const s = await this._nmSSID(); this._vals.wifi.set_text(s||'Off'); } catch { this._vals.wifi.set_text('—'); } }
    async _bluetooth() { try { this._vals.bt.set_text(await this._btPowered() ? 'On' : 'Off'); } catch { this._vals.bt.set_text('—'); } }
    async _cpu() { try { this._vals.cpu.set_text(`${await this._cpuLoad()}%`); } catch { this._vals.cpu.set_text('—'); } }
    async _memory() { try { const {used,total} = await this._memInfo(); this._vals.mem.set_text(`${Math.round(used/total*100)}%`); } catch { this._vals.mem.set_text('—'); } }
    _readFile(path) {
        return new Promise((res,rej) => { const f=Gio.File.new_for_path(path); f.load_contents_async(null,(file,result) => { try { const[,b]=file.load_contents_finish(result); res(new TextDecoder().decode(b)); } catch(e){rej(e);} }); });
    }
    async _cpuLoad() {
        const sample = async () => { const txt=await this._readFile('/proc/stat'), parts=txt.split('\n')[0].trim().split(/\s+/).slice(1).map(Number); return {idle:parts[3]+(parts[4]??0),total:parts.reduce((a,b)=>a+b,0)}; };
        const a=await sample(); await new Promise(r=>GLib.timeout_add(GLib.PRIORITY_DEFAULT,250,()=>{r();return GLib.SOURCE_REMOVE;})); const b=await sample();
        const dt=b.total-a.total; return dt===0?0:Math.round((1-(b.idle-a.idle)/dt)*100);
    }
    async _memInfo() { const txt=await this._readFile('/proc/meminfo'),n=k=>parseInt((txt.match(new RegExp(`^${k}:\\s+(\\d+)`,'m'))??[])[1]??'0'); const total=n('MemTotal'); return {used:total-n('MemFree')-n('Buffers')-n('Cached'),total}; }
    async _nmSSID() {
        return new Promise((resolve,reject) => {
            Gio.DBus.system.call('org.freedesktop.NetworkManager','/org/freedesktop/NetworkManager','org.freedesktop.DBus.Properties','Get',
                new GLib.Variant('(ss)',['org.freedesktop.NetworkManager','ActiveConnections']),new GLib.VariantType('(v)'),Gio.DBusCallFlags.NONE,2000,null,
                (src,res) => { try { const paths=src.call_finish(res).get_child_value(0).unpack().recursiveUnpack(); if(!paths.length){resolve(null);return;}
                    Gio.DBus.system.call('org.freedesktop.NetworkManager',paths[0],'org.freedesktop.DBus.Properties','Get',
                        new GLib.Variant('(ss)',['org.freedesktop.NetworkManager.Connection.Active','Id']),new GLib.VariantType('(v)'),Gio.DBusCallFlags.NONE,2000,null,
                        (s2,r2) => { try{resolve(s2.call_finish(r2).get_child_value(0).unpack());}catch(e){reject(e);} }); } catch(e){reject(e);} });
        });
    }
    async _btPowered() {
        try { const dir=Gio.File.new_for_path('/sys/class/rfkill'),iter=dir.enumerate_children('standard::name',Gio.FileQueryInfoFlags.NONE,null); let info;
            while((info=iter.next_file(null))){ const name=info.get_name(),type=(await this._readFile(`/sys/class/rfkill/${name}/type`)).trim(); if(type!=='bluetooth')continue; return(await this._readFile(`/sys/class/rfkill/${name}/soft`)).trim()==='0'; } } catch {}
        return false;
    }
}