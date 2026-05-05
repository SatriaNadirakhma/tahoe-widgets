/**
 * ClockWidget — digital clock with date.
 * Refreshes every second. Apple Watch-style ultra-thin numerals.
 */

import St      from 'gi://St';
import Clutter from 'gi://Clutter';
import GLib    from 'gi://GLib';
import { BaseWidget } from './baseWidget.js';

const DAYS   = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

export class ClockWidget extends BaseWidget {
    constructor(opts) {
        super({ ...opts, id: 'clock', refreshMs: 1000 });
    }

    build() {
        this.actor.add_style_class_name('tahoe-clock');

        // Time row
        this._timeBox = new St.BoxLayout({
            style_class: 'tahoe-clock-time-row',
            vertical:    false,
            y_align:     Clutter.ActorAlign.BASELINE,
        });

        this._timeLabel = new St.Label({
            text:        '00:00',
            style_class: 'tahoe-clock-time',
            y_align:     Clutter.ActorAlign.FILL,
        });

        this._ampmLabel = new St.Label({
            text:        '',
            style_class: 'tahoe-clock-ampm',
            y_align:     Clutter.ActorAlign.END,
        });

        this._timeBox.add_child(this._timeLabel);
        this._timeBox.add_child(this._ampmLabel);

        this._dateLabel = new St.Label({
            text:        '',
            style_class: 'tahoe-clock-date',
        });

        this.actor.add_child(this._timeBox);
        this.actor.add_child(this._dateLabel);
    }

    refresh() {
        const now    = new Date();
        const fmt    = this._state.getSettings().clockFormat;
        const is12h  = fmt === '12h';

        let   hours  = now.getHours();
        let   ampm   = '';

        if (is12h) {
            ampm  = hours >= 12 ? 'PM' : 'AM';
            hours = hours % 12 || 12;
        }

        const mins   = String(now.getMinutes()).padStart(2, '0');
        const hStr   = is12h
            ? String(hours)                       // no leading zero for 12h
            : String(hours).padStart(2, '0');

        this._timeLabel.set_text(`${hStr}:${mins}`);
        this._ampmLabel.set_text(ampm);

        const day  = DAYS[now.getDay()];
        const mon  = MONTHS[now.getMonth()];
        const date = now.getDate();
        this._dateLabel.set_text(`${day}, ${mon} ${date}`);
    }
}
