/**
 * WorldClockWidget — displays time for multiple timezones.
 * Refreshes every minute.
 */

import St      from 'gi://St';
import Clutter from 'gi://Clutter';
import GLib    from 'gi://GLib';

import { BaseWidget } from './baseWidget.js';

export class WorldClockWidget extends BaseWidget {
    constructor(opts) {
        super({ ...opts, id: 'worldClock', refreshMs: 60_000 });
    }

    build() {
        this.actor.add_style_class_name('tahoe-world-clock');

        this._header = new St.Label({
            text:        'World Clock',
            style_class: 'tahoe-label-caption',
            style:       'margin-bottom:6px;',
        });
        this.actor.add_child(this._header);

        this._rows = [];
        this._buildRows();
    }

    _buildRows() {
        // Remove existing rows (re-build on settings change)
        this._rows.forEach(r => r.destroy());
        this._rows = [];

        const cities = this._state.getSettings().worldClockCities;

        cities.forEach(tz => {
            const row = new St.BoxLayout({
                vertical:    false,
                style_class: 'tahoe-world-clock-row',
                x_expand:    true,
            });

            const left = new St.BoxLayout({ vertical: true, x_expand: true });

            const cityName   = this._cityName(tz);
            const cityLabel  = new St.Label({ text: cityName, style_class: 'tahoe-world-city' });
            const offsetLabel = new St.Label({ text: '',      style_class: 'tahoe-world-offset' });

            left.add_child(cityLabel);
            left.add_child(offsetLabel);

            const timeLabel = new St.Label({ text: '--:--', style_class: 'tahoe-world-time' });

            row.add_child(left);
            row.add_child(timeLabel);

            row._tz          = tz;
            row._offsetLabel = offsetLabel;
            row._timeLabel   = timeLabel;

            this.actor.add_child(row);
            this._rows.push(row);
        });
    }

    refresh() {
        const now    = new Date();
        const fmt24  = this._state.getSettings().clockFormat === '24h';

        this._rows.forEach(row => {
            try {
                // Use Intl for timezone conversion
                const parts = new Intl.DateTimeFormat('en-US', {
                    timeZone:    row._tz,
                    hour:        'numeric',
                    minute:      '2-digit',
                    hour12:      !fmt24,
                }).formatToParts(now);

                const timeParts = Object.fromEntries(parts.map(p => [p.type, p.value]));
                const timeStr   = fmt24
                    ? `${timeParts.hour}:${timeParts.minute}`
                    : `${timeParts.hour}:${timeParts.minute} ${timeParts.dayPeriod ?? ''}`.trim();

                row._timeLabel.set_text(timeStr);

                // Offset vs local
                const localOffset  = -now.getTimezoneOffset();
                const remoteOffset = this._tzOffsetMinutes(row._tz, now);
                const diff         = remoteOffset - localOffset;
                const sign         = diff >= 0 ? '+' : '−';
                const hrs          = Math.floor(Math.abs(diff) / 60);
                const mins         = Math.abs(diff) % 60;
                const offsetStr    = mins > 0
                    ? `${sign}${hrs}h ${mins}m`
                    : diff === 0 ? 'Local' : `${sign}${hrs}h`;

                row._offsetLabel.set_text(offsetStr);
            } catch { row._timeLabel.set_text('—'); }
        });
    }

    _cityName(tz) {
        // "America/New_York" → "New York"
        const parts = tz.split('/');
        return (parts[parts.length - 1] ?? tz).replace(/_/g, ' ');
    }

    _tzOffsetMinutes(tz, date) {
        try {
            // Trick: format an ISO-like string in the target TZ, compute offset
            const utcDate  = new Date(date.toLocaleString('en-US', { timeZone: 'UTC' }));
            const tzDate   = new Date(date.toLocaleString('en-US', { timeZone: tz }));
            return (tzDate - utcDate) / 60_000;
        } catch { return 0; }
    }
}
