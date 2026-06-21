import St      from 'gi://St';
import Clutter from 'gi://Clutter';
import { BaseWidget } from './baseWidget.js';
import { getLucideIcon } from '../utils/lucideIcon.js';

const WMO_ICON_MAP = {
    0:  { icon: 'sun',             color: '#FACC15' },
    1:  { icon: 'sun',             color: '#FACC15' },
    2:  { icon: 'cloud-sun',       color: '#FCD34D' },
    3:  { icon: 'cloud',           color: '#94A3B8' },
    45: { icon: 'cloud-fog',       color: '#CBD5E1' },
    48: { icon: 'cloud-fog',       color: '#CBD5E1' },
    51: { icon: 'cloud-drizzle',   color: '#60A5FA' },
    53: { icon: 'cloud-drizzle',   color: '#60A5FA' },
    55: { icon: 'cloud-drizzle',   color: '#60A5FA' },
    61: { icon: 'cloud-rain',      color: '#3B82F6' },
    63: { icon: 'cloud-rain',      color: '#3B82F6' },
    65: { icon: 'cloud-rain-wind', color: '#1D4ED8' },
    71: { icon: 'cloud-snow',      color: '#BAE6FD' },
    73: { icon: 'cloud-snow',      color: '#BAE6FD' },
    75: { icon: 'cloud-snow',      color: '#BAE6FD' },
    80: { icon: 'cloud-rain',      color: '#3B82F6' },
    81: { icon: 'cloud-rain-wind', color: '#1D4ED8' },
    85: { icon: 'cloud-snow',      color: '#BAE6FD' },
    95: { icon: 'cloud-lightning', color: '#7C3AED' },
    96: { icon: 'cloud-lightning', color: '#7C3AED' },
};

export class WeatherWidget extends BaseWidget {
    build() {
        this.actor.add_style_class_name('tahoe-weather');
        this.showLoading('Fetching weather...');
        if (this._data) {
            this._unsubs.push(this._data.onWeather(ev => this._onWeatherUpdate(ev)));
            const cached = this._data.getWeather();
            if (cached) this._render(cached);
        } else { this.showError('DataManager not available'); }
        this._unsubs.push(
            this._state.subscribe('settings:weather-location', () => {
                this.showLoading('Updating...'); this._data?.fetchWeatherNow().catch(() => {});
            }),
            this._state.subscribe('settings:weather-unit', () => {
                this._data?.fetchWeatherNow().catch(() => {});
            }),
        );
    }
    _weatherMeta(wmoCode) {
        return WMO_ICON_MAP[wmoCode] ?? { icon: 'cloud', color: '#94A3B8' };
    }
    _onWeatherUpdate({ status, data, message }) {
        if (status === 'ok') this._render(data); else this._renderError(message);
    }
    _render(d) {
        this._content.remove_all_children();
        const meta = this._weatherMeta(d.wmoCode);
        const topRow = new St.BoxLayout({ vertical: false, x_expand: true, style: 'spacing:6px;' });
        topRow.add_child(new St.Label({ text: d.location, style_class: 'tahoe-weather-location', x_expand: true }));
        const condIcon = getLucideIcon(meta.icon, 24);
        condIcon.style = `color:${meta.color};`;
        topRow.add_child(condIcon);
        this._content.add_child(topRow);
        const tempRow = new St.BoxLayout({ vertical: false, style: 'spacing:2px;', y_align: Clutter.ActorAlign.CENTER });
        tempRow.add_child(new St.Label({ text: `${d.temperature}`, style_class: 'tahoe-weather-temp', y_align: Clutter.ActorAlign.CENTER }));
        tempRow.add_child(new St.Label({ text: d.unit, style_class: 'tahoe-clock-ampm', y_align: Clutter.ActorAlign.CENTER }));
        const infoCol = new St.BoxLayout({ vertical: true, x_expand: true, y_align: Clutter.ActorAlign.CENTER, style: 'spacing:2px; padding-left:10px;' });
        infoCol.add_child(new St.Label({ text: d.description, style_class: 'tahoe-weather-desc' }));
        infoCol.add_child(new St.Label({ text: `H:${d.high}  L:${d.low}`, style_class: 'tahoe-weather-hi-lo' }));
        const detailRow = new St.BoxLayout({ vertical: false, style: 'spacing:3px;' });
        const humIcon = getLucideIcon('droplets', 11);
        humIcon.add_style_class_name('tahoe-weather-detail-icon');
        detailRow.add_child(humIcon);
        detailRow.add_child(new St.Label({ text: d.humidity, style_class: 'tahoe-label-small tahoe-muted' }));
        const sep = new St.Widget({ style: 'width:8px;' });
        detailRow.add_child(sep);
        const windIcon = getLucideIcon('wind', 11);
        windIcon.add_style_class_name('tahoe-weather-detail-icon');
        detailRow.add_child(windIcon);
        detailRow.add_child(new St.Label({ text: d.wind, style_class: 'tahoe-label-small tahoe-muted' }));
        infoCol.add_child(detailRow);
        const midRow = new St.BoxLayout({ vertical: false });
        midRow.add_child(tempRow); midRow.add_child(infoCol);
        this._content.add_child(midRow);
        this._content.add_child(new St.Widget({ style_class: 'tahoe-weather-separator', x_expand: true }));
        const forecastRow = new St.BoxLayout({ vertical: false, style: 'spacing:8px;', x_expand: true });
        d.forecast.slice(0,6).forEach(f => {
            const fMeta = this._weatherMeta(f.wmoCode);
            const cell = new St.BoxLayout({ vertical: true, style: 'spacing:2px; min-width:36px;', x_align: Clutter.ActorAlign.CENTER });
            cell.add_child(new St.Label({ text: f.time, style_class: 'tahoe-forecast-hour', x_align: Clutter.ActorAlign.CENTER }));
            const fIcon = getLucideIcon(fMeta.icon, 14);
            fIcon.style = `color:${fMeta.color};`;
            cell.add_child(fIcon);
            cell.add_child(new St.Label({ text: f.temp, style_class: 'tahoe-forecast-temp', x_align: Clutter.ActorAlign.CENTER }));
            forecastRow.add_child(cell);
        });
        this._content.add_child(forecastRow);
        const updated = new Date(d.fetchedAt);
        const timeStr = updated.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        this._content.add_child(new St.Label({ text: `Updated ${timeStr}`, style_class: 'tahoe-label-small tahoe-muted' }));
    }
    _renderError(msg) {
        this._content.remove_all_children();
        const box = new St.BoxLayout({ vertical: true, style: 'spacing:8px;', x_align: Clutter.ActorAlign.CENTER });
        const errIcon = getLucideIcon('cloud', 52);
        errIcon.style = 'color: rgba(255,255,255,0.48);';
        box.add_child(errIcon);
        box.add_child(new St.Label({ text: msg || 'Weather unavailable', style_class: 'tahoe-label-small tahoe-muted', x_align: Clutter.ActorAlign.CENTER }));
        const retryBtn = new St.Button({ label: 'Retry', style_class: 'tahoe-btn' });
        retryBtn.connect('clicked', () => { this.showLoading('Retrying...'); this._data?.fetchWeatherNow().catch(() => {}); });
        box.add_child(retryBtn);
        this._content.add_child(box);
    }
}
