import St      from 'gi://St';
import Clutter from 'gi://Clutter';
import Gio     from 'gi://Gio';
import GLib    from 'gi://GLib';
import { BaseWidget } from './baseWidget.js';

/* ── WorldClockWidget ─────────────────────────────────────────────── */
export class WorldClockWidget extends BaseWidget {
    build() {
        this.actor.add_style_class_name('tahoe-world-clock');
        this._rows = []; this._buildRows();
        this.startTimer(60_000, () => this._tick());
        this._unsubs.push(
            this._state.subscribe('settings:world-clock-zones', () => {
                this._content.remove_all_children(); this._rows = []; this._buildRows(); this._tick();
            }),
            this._state.subscribe('settings:clock-format', () => this._tick()),
        );
    }
    _buildRows() {
        this._content.add_child(new St.Label({ text: 'World Clock', style_class: 'tahoe-label-caption', style: 'margin-bottom:6px;' }));
        (this._state.worldClockZones ?? []).forEach(tz => {
            const row = new St.BoxLayout({ vertical: false, x_expand: true, style_class: 'tahoe-world-clock-row', style: 'spacing:8px;' });
            const left = new St.BoxLayout({ vertical: true, x_expand: true });
            const city = new St.Label({ text: this._cityName(tz), style_class: 'tahoe-world-city' });
            const offset = new St.Label({ text: '', style_class: 'tahoe-world-offset' });
            left.add_child(city); left.add_child(offset);
            const time = new St.Label({ text: '--:--', style_class: 'tahoe-world-time', y_align: Clutter.ActorAlign.CENTER });
            row.add_child(left); row.add_child(time);
            row._tz = tz; row._offset = offset; row._time = time;
            this._content.add_child(row); this._rows.push(row);
        });
    }
    _tick() {
        const now = new Date(), is12h = this._state.clockFormat !== '24h';
        this._rows.forEach(row => {
            try {
                const parts = new Intl.DateTimeFormat('en-US', { timeZone: row._tz, hour: 'numeric', minute: '2-digit', hour12: is12h }).formatToParts(now);
                const p = Object.fromEntries(parts.map(x => [x.type, x.value]));
                row._time.set_text(is12h ? `${p.hour}:${p.minute} ${p.dayPeriod ?? ''}`.trim() : `${p.hour}:${p.minute}`);
                const diff = this._tzOffsetMinutes(row._tz, now) - (-now.getTimezoneOffset());
                const sign = diff >= 0 ? '+' : '−', h = Math.floor(Math.abs(diff)/60), m = Math.abs(diff)%60;
                row._offset.set_text(diff === 0 ? 'Local' : m > 0 ? `${sign}${h}h ${m}m` : `${sign}${h}h`);
            } catch { row._time.set_text('—'); }
        });
    }
    _cityName(tz) { const p = tz.split('/'); return p[p.length-1].replace(/_/g,' '); }
    _tzOffsetMinutes(tz, date) {
        try {
            const utc = new Date(date.toLocaleString('en-US', { timeZone: 'UTC' }));
            const tzd = new Date(date.toLocaleString('en-US', { timeZone: tz }));
            return (tzd - utc) / 60_000;
        } catch { return 0; }
    }
}

/* ── BatteryWidget ────────────────────────────────────────────────── */
const UPOWER_BUS = 'org.freedesktop.UPower';
const DISP_PATH  = '/org/freedesktop/UPower/devices/DisplayDevice';
const DEV_IFACE  = 'org.freedesktop.UPower.Device';
const PROP_IFACE = 'org.freedesktop.DBus.Properties';
const DEVICE_ICON = { 1:'🖱️', 2:'⌨️', 3:'🎮', 5:'🔋', 8:'🖥️' };

export class BatteryWidget extends BaseWidget {
    build() { this.actor.add_style_class_name('tahoe-battery'); this.showLoading(); this.startTimer(30_000, () => this._refresh()); }
    async _refresh() {
        try {
            const pct = await this._prop(DISP_PATH,'Percentage'), state = await this._prop(DISP_PATH,'State');
            this._renderMain(Math.round(pct ?? 0), state ?? 2); await this._renderDevices();
        } catch { this.showError('Battery info unavailable'); }
    }
    _renderMain(pct, state) {
        this._content.remove_all_children();
        this._content.add_child(new St.Label({ text: 'Battery', style_class: 'tahoe-label-caption', style: 'margin-bottom:8px;' }));
        const charging = (state===1||state===6), full = (state===4);
        const icon = full ? '⚡' : charging ? '⚡' : pct <= 20 ? '🪫' : '🔋';
        const topRow = new St.BoxLayout({ vertical: false, style: 'spacing:6px;' });
        topRow.add_child(new St.Label({ text: icon, style_class: 'tahoe-label-medium', y_align: Clutter.ActorAlign.CENTER }));
        topRow.add_child(new St.Label({ text: `${pct}%`, style_class: 'tahoe-battery-percent', y_align: Clutter.ActorAlign.CENTER }));
        if (charging||full) topRow.add_child(new St.Label({ text: full?'Full':'Charging', style_class: 'tahoe-label-small tahoe-muted', y_align: Clutter.ActorAlign.CENTER }));
        this._content.add_child(topRow);
        const barBg = new St.Widget({ x_expand: true, style: 'background:rgba(255,255,255,0.14);border-radius:4px;height:6px;margin:6px 0;' });
        const barColor = pct<=20?'rgba(255,80,80,0.9)':charging?'rgba(80,220,100,0.9)':'rgba(255,255,255,0.80)';
        barBg.add_child(new St.Widget({ style: `background:${barColor};border-radius:4px;height:6px;width:${pct}%;` }));
        this._content.add_child(barBg);
        this._devSection = new St.BoxLayout({ vertical: true, style: 'spacing:4px; margin-top:6px;' });
        this._content.add_child(this._devSection);
    }
    async _renderDevices() {
        if (!this._devSection) return;
        this._devSection.remove_all_children();
        try {
            const result = await this._dbusCall(UPOWER_BUS,'/org/freedesktop/UPower','org.freedesktop.UPower','EnumerateDevices',null,new GLib.VariantType('(ao)'));
            for (const path of (result?.[0] ?? [])) {
                try {
                    const type = await this._prop(path,'Type'), pct = await this._prop(path,'Percentage'), model = await this._prop(path,'Model');
                    if (type===5||!pct) continue;
                    const row = new St.BoxLayout({ vertical: false, style: 'spacing:8px;', x_expand: true });
                    row.add_child(new St.Label({ text: DEVICE_ICON[type]??'🔌', style_class: 'tahoe-status-icon', y_align: Clutter.ActorAlign.CENTER }));
                    row.add_child(new St.Label({ text: model||'Device', style_class: 'tahoe-status-text', x_expand: true, y_align: Clutter.ActorAlign.CENTER }));
                    row.add_child(new St.Label({ text: `${Math.round(pct)}%`, style_class: 'tahoe-status-value', y_align: Clutter.ActorAlign.CENTER }));
                    this._devSection.add_child(row);
                } catch {}
            }
        } catch {}
    }
    _prop(path, prop) {
        return new Promise((resolve, reject) => {
            Gio.DBus.system.call(UPOWER_BUS, path, PROP_IFACE, 'Get', new GLib.Variant('(ss)',[DEV_IFACE,prop]), new GLib.VariantType('(v)'), Gio.DBusCallFlags.NONE, 3000, null,
                (src, res) => { try { resolve(src.call_finish(res).get_child_value(0).unpack()); } catch(e) { reject(e); } });
        });
    }
    _dbusCall(bus,path,iface,method,params,retType) {
        return new Promise((resolve, reject) => {
            Gio.DBus.system.call(bus,path,iface,method,params,retType,Gio.DBusCallFlags.NONE,3000,null,
                (src,res) => { try { resolve(src.call_finish(res).recursiveUnpack()); } catch(e) { reject(e); } });
        });
    }
}

/* ── QuickStatusWidget ────────────────────────────────────────────── */
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