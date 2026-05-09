import St      from 'gi://St';
import Clutter from 'gi://Clutter';
import { BaseWidget } from './baseWidget.js';

const DAYS   = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

export class ClockWidget extends BaseWidget {
    build() {
        this.actor.add_style_class_name('tahoe-clock');
        this._timeRow = new St.BoxLayout({ vertical: false, style: 'spacing:4px;',
            x_align: Clutter.ActorAlign.START });
        this._timeLabel = new St.Label({ text: '--:--', style_class: 'tahoe-clock-time',
            y_align: Clutter.ActorAlign.CENTER });
        this._ampmLabel = new St.Label({ text: '', style_class: 'tahoe-clock-ampm',
            y_align: Clutter.ActorAlign.CENTER });
        this._timeRow.add_child(this._timeLabel);
        this._timeRow.add_child(this._ampmLabel);
        this._dateLabel = new St.Label({ text: '', style_class: 'tahoe-clock-date' });
        this._content.add_child(this._timeRow);
        this._content.add_child(this._dateLabel);
        this._tick();
        this._timerId = this.startTimer(1000, () => this._tick(), false);
        this._unsubs.push(
            this._state.subscribe('settings:clock-format',       () => this._tick()),
            this._state.subscribe('settings:clock-show-seconds', () => this._tick()),
        );
    }
    _tick() {
        const now   = new Date();
        const is12h = this._state.clockFormat === '12h';
        const secs  = this._state.clockSeconds;
        let hours   = now.getHours(), ampm = '';
        if (is12h) { ampm = hours >= 12 ? 'PM' : 'AM'; hours = hours % 12 || 12; }
        const hStr = is12h ? String(hours) : String(hours).padStart(2,'0');
        const mStr = String(now.getMinutes()).padStart(2,'0');
        const sStr = secs ? `:${String(now.getSeconds()).padStart(2,'0')}` : '';
        this._timeLabel.set_text(`${hStr}:${mStr}${sStr}`);
        this._ampmLabel.set_text(is12h ? ampm : '');
        this._dateLabel.set_text(`${DAYS[now.getDay()]}, ${MONTHS[now.getMonth()]} ${now.getDate()}`);
    }
    destroy() { this.stopTimer(this._timerId); super.destroy(); }
}
