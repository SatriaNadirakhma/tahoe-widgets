/**
 * WeatherWidget — current conditions + 5-hour forecast.
 * Data source: Open-Meteo (free, no API key needed).
 * Refreshes every 10 minutes.
 */

import St      from 'gi://St';
import Clutter from 'gi://Clutter';
import GLib    from 'gi://GLib';
import Gio     from 'gi://Gio';

import { BaseWidget }    from './baseWidget.js';
import { WeatherFetcher } from '../utils/weatherFetcher.js';

// Geoclue for auto-location
let Geoclue = null;
try { Geoclue = (await import('gi://Geoclue')).default; } catch { /* optional */ }

export class WeatherWidget extends BaseWidget {
    constructor(opts) {
        super({ ...opts, id: 'weather', refreshMs: 10 * 60 * 1000 });
        this._fetcher = new WeatherFetcher();
    }

    build() {
        this.actor.add_style_class_name('tahoe-weather');

        /* ── Location + icon row ─────────── */
        const topRow = new St.BoxLayout({ vertical: false, style_class: 'tahoe-weather-top' });

        this._locationLabel = new St.Label({
            text:        '—',
            style_class: 'tahoe-weather-location',
            x_expand:    true,
        });
        this._iconLabel = new St.Label({ text: '—', style_class: 'tahoe-label-medium' });

        topRow.add_child(this._locationLabel);
        topRow.add_child(this._iconLabel);

        /* ── Temp + description row ──────── */
        const midRow = new St.BoxLayout({ vertical: false, style: 'spacing: 8px;' });

        this._tempLabel = new St.Label({
            text:        '--',
            style_class: 'tahoe-weather-temp',
            y_align:     Clutter.ActorAlign.CENTER,
        });
        this._unitLabel = new St.Label({
            text:        '°',
            style_class: 'tahoe-clock-ampm',
            y_align:     Clutter.ActorAlign.CENTER,
        });

        const descCol = new St.BoxLayout({ vertical: true, x_expand: true,
            y_align: Clutter.ActorAlign.CENTER, style: 'padding-bottom:6px;' });
        this._descLabel  = new St.Label({ text: '', style_class: 'tahoe-weather-desc' });
        this._hiloLabel  = new St.Label({ text: '', style_class: 'tahoe-weather-hi-lo' });
        descCol.add_child(this._descLabel);
        descCol.add_child(this._hiloLabel);

        midRow.add_child(this._tempLabel);
        midRow.add_child(this._unitLabel);
        midRow.add_child(descCol);

        /* ── Forecast row ────────────────── */
        this._forecastRow = new St.BoxLayout({
            vertical:    false,
            style_class: 'tahoe-forecast-row',
            style:       'spacing:12px;',
        });

        /* ── Loading / error label ───────── */
        this._statusLabel = new St.Label({
            text:        'Loading…',
            style_class: 'tahoe-label-small',
        });

        this.actor.add_child(topRow);
        this.actor.add_child(midRow);
        this.actor.add_child(this._forecastRow);
        this.actor.add_child(this._statusLabel);
    }

    async refresh() {
        const { weatherLocation, weatherUnit } = this._state.getSettings();

        // Determine location
        let loc = weatherLocation?.trim();
        if (!loc) {
            loc = await this._autoLocation();
            if (!loc) {
                this._statusLabel.set_text('Set location in settings');
                return;
            }
        }

        try {
            const data = await this._fetcher.fetch(loc, weatherUnit);
            this._render(data);
            this._statusLabel.set_text('');
        } catch (err) {
            this._statusLabel.set_text(`⚠ ${err.message}`);
        }
    }

    _render(d) {
        this._locationLabel.set_text(d.location);
        this._iconLabel.set_text(d.icon);
        this._tempLabel.set_text(d.temperature);
        this._unitLabel.set_text(d.unit);
        this._descLabel.set_text(d.description);
        this._hiloLabel.set_text(`H:${d.high}  L:${d.low}`);

        // Rebuild forecast cells
        this._forecastRow.remove_all_children();
        d.forecast.forEach(f => {
            const cell = new St.BoxLayout({
                vertical:    true,
                style_class: 'tahoe-forecast-cell',
                style:       'spacing:2px; min-width:38px;',
                x_align:     Clutter.ActorAlign.CENTER,
            });
            cell.add_child(new St.Label({ text: f.time, style_class: 'tahoe-forecast-hour',
                x_align: Clutter.ActorAlign.CENTER }));
            cell.add_child(new St.Label({ text: f.icon, style_class: 'tahoe-forecast-icon',
                x_align: Clutter.ActorAlign.CENTER }));
            cell.add_child(new St.Label({ text: f.temp, style_class: 'tahoe-forecast-temp',
                x_align: Clutter.ActorAlign.CENTER }));
            this._forecastRow.add_child(cell);
        });
    }

    async _autoLocation() {
        if (!Geoclue) return null;
        try {
            const client = await Geoclue.Simple.new(
                'tahoe-widgets', Geoclue.AccuracyLevel.CITY, null
            );
            const loc = client.get_location();
            // Reverse-geocode via Open-Meteo (lat/lon → city name not needed;
            // Open-Meteo accepts lat/lon directly)
            return `${loc.get_latitude()},${loc.get_longitude()}`;
        } catch {
            return null;
        }
    }

    destroy() {
        this._fetcher.destroy();
        super.destroy();
    }
}