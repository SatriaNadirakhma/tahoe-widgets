/**
 * WeatherWidget v2
 * - Subscribes to DataManager for push updates (no internal timer)
 * - Shows loading skeleton on first load
 * - Graceful error state with retry button
 * - Reacts to unit/location setting changes
 */

import St      from 'gi://St';
import Clutter from 'gi://Clutter';
import { BaseWidget } from './baseWidget.js';

export class WeatherWidget extends BaseWidget {
    build() {
        this.actor.add_style_class_name('tahoe-weather');
        this.showLoading('Fetching weather…');

        // Subscribe to DataManager weather updates
        if (this._data) {
            this._unsubs.push(
                this._data.onWeather(ev => this._onWeatherUpdate(ev))
            );
            // If cached data already exists, render it immediately
            const cached = this._data.getWeather();
            if (cached) this._render(cached);
        } else {
            this.showError('DataManager not available');
        }

        // Re-trigger fetch when settings change
        this._unsubs.push(
            this._state.subscribe('settings:weather-location', () => {
                this.showLoading('Updating…');
                this._data?.fetchWeatherNow().catch(() => {});
            }),
            this._state.subscribe('settings:weather-unit', () => {
                this._data?.fetchWeatherNow().catch(() => {});
            }),
        );
    }

    _onWeatherUpdate({ status, data, message }) {
        if (status === 'ok') {
            this._render(data);
        } else {
            this._renderError(message);
        }
    }

    _render(d) {
        this._content.remove_all_children();

        // ── Location + icon ──────────────────────────────────────
        const topRow = new St.BoxLayout({ vertical: false, x_expand: true,
            style: 'spacing:6px;' });
        topRow.add_child(new St.Label({ text: d.location,
            style_class: 'tahoe-weather-location', x_expand: true }));
        topRow.add_child(new St.Label({ text: d.icon,
            style_class: 'tahoe-label-medium' }));
        this._content.add_child(topRow);

        // ── Temperature row ──────────────────────────────────────
        const tempRow = new St.BoxLayout({ vertical: false,
            style: 'spacing:2px;', y_align: Clutter.ActorAlign.CENTER });
        tempRow.add_child(new St.Label({
            text:        `${d.temperature}`,
            style_class: 'tahoe-weather-temp',
            y_align:     Clutter.ActorAlign.CENTER,
        }));
        tempRow.add_child(new St.Label({
            text:        d.unit,
            style_class: 'tahoe-clock-ampm',
            y_align:     Clutter.ActorAlign.CENTER,
        }));

        const infoCol = new St.BoxLayout({ vertical: true, x_expand: true,
            y_align: Clutter.ActorAlign.CENTER, style: 'spacing:2px; padding-left:10px;' });
        infoCol.add_child(new St.Label({ text: d.description,
            style_class: 'tahoe-weather-desc' }));
        infoCol.add_child(new St.Label({ text: `H:${d.high}  L:${d.low}`,
            style_class: 'tahoe-weather-hi-lo' }));
        infoCol.add_child(new St.Label({ text: `💧 ${d.humidity}  💨 ${d.wind}`,
            style_class: 'tahoe-label-small tahoe-muted' }));

        const midRow = new St.BoxLayout({ vertical: false });
        midRow.add_child(tempRow);
        midRow.add_child(infoCol);
        this._content.add_child(midRow);

        // ── Divider ──────────────────────────────────────────────
        this._content.add_child(new St.Widget({
            style: 'height:1px; background:rgba(255,255,255,0.12); margin:4px 0;',
            x_expand: true,
        }));

        // ── Hourly forecast ──────────────────────────────────────
        const forecastRow = new St.BoxLayout({ vertical: false,
            style: 'spacing:8px;', x_expand: true });
        d.forecast.slice(0, 6).forEach(f => {
            const cell = new St.BoxLayout({ vertical: true,
                style: 'spacing:2px; min-width:36px;',
                x_align: Clutter.ActorAlign.CENTER });
            cell.add_child(new St.Label({ text: f.time,
                style_class: 'tahoe-forecast-hour',
                x_align: Clutter.ActorAlign.CENTER }));
            cell.add_child(new St.Label({ text: f.icon,
                style_class: 'tahoe-forecast-icon',
                x_align: Clutter.ActorAlign.CENTER }));
            cell.add_child(new St.Label({ text: f.temp,
                style_class: 'tahoe-forecast-temp',
                x_align: Clutter.ActorAlign.CENTER }));
            forecastRow.add_child(cell);
        });
        this._content.add_child(forecastRow);

        // ── Last updated ────────────────────────────────────────
        const updated = new Date(d.fetchedAt);
        const timeStr = updated.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        this._content.add_child(new St.Label({
            text:        `Updated ${timeStr}`,
            style_class: 'tahoe-label-small tahoe-muted',
        }));
    }

    _renderError(msg) {
        this._content.remove_all_children();

        const box = new St.BoxLayout({ vertical: true, style: 'spacing:8px;',
            x_align: Clutter.ActorAlign.CENTER });
        box.add_child(new St.Label({ text: '☁️', style_class: 'tahoe-label-large',
            x_align: Clutter.ActorAlign.CENTER }));
        box.add_child(new St.Label({ text: msg || 'Weather unavailable',
            style_class: 'tahoe-label-small tahoe-muted',
            x_align: Clutter.ActorAlign.CENTER }));

        // Retry button
        const retryBtn = new St.Button({
            label:       'Retry',
            style_class: 'tahoe-btn',
        });
        retryBtn.connect('clicked', () => {
            this.showLoading('Retrying…');
            this._data?.fetchWeatherNow().catch(() => {});
        });
        box.add_child(retryBtn);
        this._content.add_child(box);
    }
}
