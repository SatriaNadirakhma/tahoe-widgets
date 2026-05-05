/**
 * CalendarWidget — current month mini-calendar.
 * Today is highlighted; refreshes at midnight.
 */

import St      from 'gi://St';
import Clutter from 'gi://Clutter';
import GLib    from 'gi://GLib';

import { BaseWidget } from './baseWidget.js';

const DAY_NAMES  = ['Su','Mo','Tu','We','Th','Fr','Sa'];
const MONTH_NAMES = [
    'January','February','March','April','May','June',
    'July','August','September','October','November','December'
];

export class CalendarWidget extends BaseWidget {
    constructor(opts) {
        super({ ...opts, id: 'calendar', refreshMs: 0 });
        this._scheduleAtMidnight();
    }

    build() {
        this.actor.add_style_class_name('tahoe-calendar');

        this._header = new St.Label({
            text:        '',
            style_class: 'tahoe-calendar-header',
        });

        this._grid = new St.Widget({
            layout_manager: new Clutter.GridLayout({ orientation: Clutter.Orientation.HORIZONTAL }),
            style_class:    'tahoe-calendar-grid',
        });
        this._layout = this._grid.layout_manager;

        this.actor.add_child(this._header);
        this.actor.add_child(this._grid);

        this._renderMonth(new Date());
    }

    refresh() {
        this._renderMonth(new Date());
        this._scheduleAtMidnight();
    }

    _renderMonth(today) {
        const y = today.getFullYear();
        const m = today.getMonth();
        const d = today.getDate();

        this._header.set_text(`${MONTH_NAMES[m]} ${y}`);

        this._grid.remove_all_children();

        // Day-of-week headers
        DAY_NAMES.forEach((name, col) => {
            const lbl = new St.Label({
                text:        name,
                style_class: 'tahoe-cal-day-label',
                x_align:     Clutter.ActorAlign.CENTER,
            });
            this._layout.attach(lbl, col, 0, 1, 1);
        });

        // First weekday of month
        const firstDay = new Date(y, m, 1).getDay();
        // Days in month
        const daysInMonth   = new Date(y, m + 1, 0).getDate();
        // Days in previous month (for leading blanks)
        const daysInPrev    = new Date(y, m, 0).getDate();

        let col = firstDay;
        let row = 1;

        // Leading days from previous month
        for (let i = firstDay - 1; i >= 0; i--) {
            const lbl = this._dayLabel(String(daysInPrev - i), 'other-month');
            this._layout.attach(lbl, firstDay - 1 - i, row, 1, 1);
        }

        // Current month days
        for (let day = 1; day <= daysInMonth; day++) {
            const isToday  = day === d;
            const extra    = isToday ? 'today' : '';
            const lbl      = this._dayLabel(String(day), extra);
            this._layout.attach(lbl, col, row, 1, 1);
            col++;
            if (col > 6) { col = 0; row++; }
        }

        // Trailing days from next month
        let trailing = 1;
        while (col <= 6 && col > 0) {
            const lbl = this._dayLabel(String(trailing++), 'other-month');
            this._layout.attach(lbl, col, row, 1, 1);
            col++;
        }
    }

    _dayLabel(text, extra = '') {
        const lbl = new St.Label({
            text,
            style_class: `tahoe-cal-day${extra ? ' ' + extra : ''}`,
            x_align:     Clutter.ActorAlign.CENTER,
            y_align:     Clutter.ActorAlign.CENTER,
            reactive:    true,
        });
        return lbl;
    }

    _scheduleAtMidnight() {
        this._clearRefresh();
        const now       = new Date();
        const tomorrow  = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
        const msUntil   = tomorrow - now;

        this._timeoutId = GLib.timeout_add(
            GLib.PRIORITY_DEFAULT, msUntil,
            () => { this.refresh(); return GLib.SOURCE_REMOVE; }
        );
    }
}
