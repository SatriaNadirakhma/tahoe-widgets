import St      from 'gi://St';
import Clutter from 'gi://Clutter';
import GLib    from 'gi://GLib';
import { BaseWidget } from './baseWidget.js';

const DOW  = ['Su','Mo','Tu','We','Th','Fr','Sa'];
const MONS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

export class CalendarWidget extends BaseWidget {
    build() {
        this.actor.add_style_class_name('tahoe-calendar');
        this._today = new Date(); this._viewDate = new Date();
        const header = new St.BoxLayout({ vertical: false, x_expand: true, style: 'spacing:4px; margin-bottom:8px;' });
        this._prevBtn = new St.Button({ label: '‹', style_class: 'tahoe-cal-nav', y_align: Clutter.ActorAlign.CENTER });
        this._prevBtn.connect('clicked', () => this._shiftMonth(-1));
        this._monthLabel = new St.Label({ text: '', style_class: 'tahoe-calendar-header', x_expand: true, x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER });
        this._nextBtn = new St.Button({ label: '›', style_class: 'tahoe-cal-nav', y_align: Clutter.ActorAlign.CENTER });
        this._nextBtn.connect('clicked', () => this._shiftMonth(1));
        header.add_child(this._prevBtn); header.add_child(this._monthLabel); header.add_child(this._nextBtn);
        this._content.add_child(header);
        this._grid = new St.Widget({ layout_manager: new Clutter.GridLayout({ orientation: Clutter.Orientation.HORIZONTAL }), x_expand: true });
        this._gridLayout = this._grid.layout_manager;
        this._content.add_child(this._grid);
        this._renderMonth(); this._scheduleMidnight();
    }
    _shiftMonth(delta) { this._viewDate.setMonth(this._viewDate.getMonth() + delta); this._renderMonth(); }
    _renderMonth() {
        this._today = new Date();
        const vd = this._viewDate, y = vd.getFullYear(), m = vd.getMonth();
        this._monthLabel.set_text(`${MONS[m]} ${y}`);
        this._grid.remove_all_children();
        DOW.forEach((d, col) => this._gridLayout.attach(new St.Label({ text: d, style_class: 'tahoe-cal-day-label', x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER }), col, 0, 1, 1));
        const firstDow = new Date(y, m, 1).getDay(), daysInMonth = new Date(y, m+1, 0).getDate();
        const daysInPrev = new Date(y, m, 0).getDate(), todayY = this._today.getFullYear(), todayM = this._today.getMonth(), todayD = this._today.getDate();
        let col = firstDow, row = 1;
        for (let i = firstDow-1; i >= 0; i--) this._gridLayout.attach(this._cell(daysInPrev-i,'tahoe-cal-day tahoe-cal-other'), firstDow-1-i, row, 1, 1);
        for (let day = 1; day <= daysInMonth; day++) {
            const isToday = day === todayD && m === todayM && y === todayY;
            this._gridLayout.attach(this._cell(day, `tahoe-cal-day${isToday ? ' tahoe-cal-today' : ''}`), col, row, 1, 1);
            if (++col > 6) { col = 0; row++; }
        }
        let trailing = 1;
        while (col <= 6 && col > 0) { this._gridLayout.attach(this._cell(trailing++,'tahoe-cal-day tahoe-cal-other'), col, row, 1, 1); col++; }
    }
    _cell(day, cls) { return new St.Label({ text: String(day), style_class: cls, x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER }); }
    _scheduleMidnight() {
        const now = new Date(), tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate()+1);
        const id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, tomorrow - now, () => {
            this._today = new Date(); this._viewDate = new Date(); this._renderMonth(); this._scheduleMidnight(); return GLib.SOURCE_REMOVE;
        });
        this._timers.add(id);
    }
}
