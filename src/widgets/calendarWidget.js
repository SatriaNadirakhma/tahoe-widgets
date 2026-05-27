import St      from 'gi://St';
import Clutter from 'gi://Clutter';
import GLib    from 'gi://GLib';
import { BaseWidget, CALENDAR_SMALL, CALENDAR_MEDIUM } from './baseWidget.js';

const DOW       = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const DOW_SHORT = ['Su','Mo','Tu','We','Th','Fr','Sa'];
const MONS      = ['January','February','March','April','May','June','July','August','September','October','November','December'];

/* ══════════════════════════════════════════════════════════════════
   1×1 Calendar — Compact "Today" widget (155×155)
   No monthly grid. Shows day name, large date number, month + year.
   Centered layout matching the Clock widget's sizing philosophy.
   ══════════════════════════════════════════════════════════════════ */

export class CalendarWidget extends BaseWidget {

    build() {
        this.actor.add_style_class_name('tahoe-calendar-small');
        this.actor.set_size(CALENDAR_SMALL.width, CALENDAR_SMALL.height);
        this._content.style = 'spacing:4px; padding:0 4px;';

        this._today = new Date();

        this._dayLabel = new St.Label({
            text:        DOW[this._today.getDay()],
            style_class: 'tahoe-label',
            x_align:     Clutter.ActorAlign.CENTER,
            x_expand:    true,
        });

        this._dateLabel = new St.Label({
            text:        String(this._today.getDate()),
            style_class: 'tahoe-today-date',
            x_align:     Clutter.ActorAlign.CENTER,
            x_expand:    true,
        });

        this._monthLabel = new St.Label({
            text:        `${MONS[this._today.getMonth()]} ${this._today.getFullYear()}`,
            style_class: 'tahoe-label-small tahoe-muted',
            x_align:     Clutter.ActorAlign.CENTER,
            x_expand:    true,
        });

        this._content.add_child(new St.Widget({ y_expand: true }));
        this._content.add_child(this._dayLabel);
        this._content.add_child(this._dateLabel);
        this._content.add_child(this._monthLabel);
        this._content.add_child(new St.Widget({ y_expand: true }));

        this._scheduleMidnight();
    }

    _updateToday() {
        const t = new Date();
        this._dayLabel.set_text(DOW[t.getDay()]);
        this._dateLabel.set_text(String(t.getDate()));
        this._monthLabel.set_text(`${MONS[t.getMonth()]} ${t.getFullYear()}`);
    }

    _scheduleMidnight() {
        const now = new Date();
        const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
        const id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, tomorrow - now, () => {
            this._today = new Date();
            this._updateToday();
            this._scheduleMidnight();
            return GLib.SOURCE_REMOVE;
        });
        this._timers.add(id);
    }
}

/* ══════════════════════════════════════════════════════════════════
   2×1 Calendar Double widget (329×220)
   Left panel: large Today view (date number, weekday, month)
   Right panel: compact monthly calendar with prev/next navigation
   Dedicated composable layout — not a resize of the 1×1 variant.
   ══════════════════════════════════════════════════════════════════ */

export class CalendarDoubleWidget extends BaseWidget {

    build() {
        this.actor.add_style_class_name('tahoe-calendar-double');
        this.actor.set_size(CALENDAR_MEDIUM.width, CALENDAR_MEDIUM.height);
        this._content.style = 'spacing:0; padding:6px 8px;';

        this._today    = new Date();
        this._viewDate = new Date();

        const row = new St.BoxLayout({
            vertical: false,
            x_expand: true,
            y_expand: true,
            style:    'spacing:6px;',
        });

        /* ── Left panel: Today ──────────────────────────────── */

        this._todayPanel = new St.BoxLayout({
            vertical:  true,
            x_expand:  true,
            y_expand:  true,
            y_align:   Clutter.ActorAlign.CENTER,
            style:     'spacing:4px;',
        });

        this._dayLabel = new St.Label({
            style_class: 'tahoe-label',
            x_align:     Clutter.ActorAlign.CENTER,
            x_expand:    true,
        });
        this._todayPanel.add_child(new St.Widget({ y_expand: true }));
        this._todayPanel.add_child(this._dayLabel);

        this._dateLabel = new St.Label({
            style_class: 'tahoe-today-date',
            x_align:     Clutter.ActorAlign.CENTER,
            x_expand:    true,
        });
        this._todayPanel.add_child(this._dateLabel);

        this._monthSmall = new St.Label({
            style_class: 'tahoe-label-small tahoe-muted',
            x_align:     Clutter.ActorAlign.CENTER,
            x_expand:    true,
        });
        this._todayPanel.add_child(this._monthSmall);
        this._todayPanel.add_child(new St.Widget({ y_expand: true }));

        /* ── Right panel: Mini calendar ─────────────────────── */

        this._calPanel = new St.BoxLayout({
            vertical: true,
            x_expand: true,
            y_expand: true,
            style:    'spacing:1px;',
        });

        const calHeader = new St.BoxLayout({
            vertical: false,
            x_expand: true,
            style:    'spacing:2px;',
        });
        this._prevBtn = new St.Button({
            label:       '‹',
            style_class: 'tahoe-cal-nav-small',
            y_align:     Clutter.ActorAlign.CENTER,
        });
        this._prevBtn.connect('clicked', () => this._shiftMonth(-1));

        this._calMonthLabel = new St.Label({
            style_class: 'tahoe-calendar-header-small',
            x_expand:    true,
            x_align:     Clutter.ActorAlign.CENTER,
            y_align:     Clutter.ActorAlign.CENTER,
        });

        this._nextBtn = new St.Button({
            label:       '›',
            style_class: 'tahoe-cal-nav-small',
            y_align:     Clutter.ActorAlign.CENTER,
        });
        this._nextBtn.connect('clicked', () => this._shiftMonth(1));

        calHeader.add_child(this._prevBtn);
        calHeader.add_child(this._calMonthLabel);
        calHeader.add_child(this._nextBtn);
        this._calPanel.add_child(calHeader);

        this._grid = new St.Widget({
            layout_manager: new Clutter.GridLayout({
                orientation: Clutter.Orientation.HORIZONTAL,
            }),
            x_expand: true,
            y_expand: true,
        });
        this._calPanel.add_child(this._grid);

        /* ── Assemble ───────────────────────────────────────── */

        row.add_child(this._todayPanel);
        row.add_child(this._calPanel);
        this._content.add_child(row);

        this._updateToday();
        this._renderMonth();
        this._scheduleMidnight();
    }

    /* ── Today panel refresh ──────────────────────────────── */

    _updateToday() {
        const t = new Date();
        this._dayLabel.set_text(DOW[t.getDay()]);
        this._dateLabel.set_text(String(t.getDate()));
        this._monthSmall.set_text(`${MONS[t.getMonth()]} ${t.getFullYear()}`);
    }

    /* ── Mini‑calendar navigation / render ─────────────────── */

    _shiftMonth(delta) {
        this._viewDate.setMonth(this._viewDate.getMonth() + delta);
        this._renderMonth();
    }

    _renderMonth() {
        const layout = this._grid.layout_manager;
        this._grid.remove_all_children();

        const vd = this._viewDate;
        const y  = vd.getFullYear();
        const m  = vd.getMonth();
        this._calMonthLabel.set_text(`${MONS[m]} ${y}`);

        DOW_SHORT.forEach((d, col) => {
            layout.attach(
                new St.Label({
                    text:        d,
                    style_class: 'tahoe-cal-day-label-small',
                    x_align:     Clutter.ActorAlign.CENTER,
                    y_align:     Clutter.ActorAlign.CENTER,
                }),
                col, 0, 1, 1);
        });

        const firstDow   = new Date(y, m, 1).getDay();
        const daysInMonth = new Date(y, m + 1, 0).getDate();
        const daysInPrev  = new Date(y, m, 0).getDate();
        const today       = new Date();
        const todayY      = today.getFullYear();
        const todayM      = today.getMonth();
        const todayD      = today.getDate();

        for (let i = firstDow - 1; i >= 0; i--) {
            layout.attach(
                this._cell(daysInPrev - i, 'tahoe-cal-day-small tahoe-cal-other'),
                firstDow - 1 - i, 1, 1, 1);
        }

        let col = firstDow, row = 1;
        for (let day = 1; day <= daysInMonth; day++) {
            const isToday = day === todayD && m === todayM && y === todayY;
            layout.attach(
                this._cell(day, `tahoe-cal-day-small${isToday ? ' tahoe-cal-today' : ''}`),
                col, row, 1, 1);
            if (++col > 6) { col = 0; row++; }
        }

        let trailing = 1;
        while (col <= 6 && col > 0) {
            layout.attach(
                this._cell(trailing++, 'tahoe-cal-day-small tahoe-cal-other'),
                col, row, 1, 1);
            col++;
        }
    }

    _cell(day, cls) {
        return new St.Label({
            text:        String(day),
            style_class: cls,
            x_align:     Clutter.ActorAlign.CENTER,
            y_align:     Clutter.ActorAlign.CENTER,
        });
    }

    /* ── Midnight rollover ─────────────────────────────────── */

    _scheduleMidnight() {
        const now = new Date();
        const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
        const id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, tomorrow - now, () => {
            this._today    = new Date();
            this._viewDate = new Date();
            this._updateToday();
            this._renderMonth();
            this._scheduleMidnight();
            return GLib.SOURCE_REMOVE;
        });
        this._timers.add(id);
    }
}
