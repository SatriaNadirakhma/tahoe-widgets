/**
 * DataManager — central hub for all external data.
 */

import Soup   from 'gi://Soup';
import GLib   from 'gi://GLib';
import { Logger } from '../utils/logger.js';

const WEATHER_BASE  = 'https://api.open-meteo.com/v1/forecast';
const GEO_BASE      = 'https://geocoding-api.open-meteo.com/v1/search';

const WMO = {
    0:  ['sun',             'Clear'],        1:  ['sun',             'Mostly Clear'],
    2:  ['cloud-sun',       'Partly Cloudy'], 3:  ['cloud',           'Overcast'],
    45: ['cloud-fog',       'Fog'],           48: ['cloud-fog',       'Rime Fog'],
    51: ['cloud-drizzle',   'Light Drizzle'], 53: ['cloud-drizzle',   'Drizzle'],   55: ['cloud-drizzle',   'Heavy Drizzle'],
    61: ['cloud-rain',      'Light Rain'],    63: ['cloud-rain',      'Rain'],       65: ['cloud-rain-wind', 'Heavy Rain'],
    71: ['cloud-snow',      'Light Snow'],    73: ['cloud-snow',      'Snow'],       75: ['cloud-snow',      'Heavy Snow'],
    80: ['cloud-rain',      'Showers'],       81: ['cloud-rain-wind', 'Rain Showers'],
    85: ['cloud-snow',      'Snow Showers'],
    95: ['cloud-lightning', 'Thunderstorm'],  96: ['cloud-lightning', 'Thunderstorm + Hail'],
};

export class DataManager {
    constructor(state) {
        this._state     = state;
        this._log       = new Logger('Data');
        this._session   = new Soup.Session();
        this._session.timeout = 15;
        this._cache     = new Map();
        this._timers    = new Map();
        this._listeners = new Map();
        this._backoff   = new Map();

        this._startWeatherPoller();

        this._unsubWeather = state.subscribe('settings:weather-refresh-minutes',
            () => this._startWeatherPoller());
        this._unsubLoc = state.subscribe('settings:weather-location',
            () => { this._cache.delete('weather'); this._startWeatherPoller(); });
    }

    getWeather() { return this._cache.get('weather')?.data ?? null; }
    onWeather(fn) { return this._subscribe('weather', fn); }

    async fetchWeatherNow() {
        try {
            const loc  = this._state.weatherLocation?.trim();
            const unit = this._state.weatherUnit;
            let coords;
            if (!loc) {
                coords = await this._geolocate();
            } else {
                coords = loc.includes(',')
                    ? this._parseCoordsString(loc)
                    : await this._geocodeCity(loc);
            }
            if (!coords) throw new Error('Cannot determine location');
            const data = await this._fetchWeatherCoords(coords, unit);
            this._cache.set('weather', { data, ts: Date.now() });
            this._backoff.set('weather', 0);
            this._notify('weather', { status: 'ok', data });
            return data;
        } catch (err) {
            this._log.warn('Weather fetch failed:', err.message);
            const retries = (this._backoff.get('weather') ?? 0) + 1;
            this._backoff.set('weather', retries);
            this._notify('weather', { status: 'error', message: err.message });
            throw err;
        }
    }

    _startWeatherPoller() {
        this._stopPoller('weather');
        const minutes = this._state.weatherRefresh ?? 15;
        const ms      = Math.max(5, minutes) * 60_000;
        GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this.fetchWeatherNow().catch(() => {});
            return GLib.SOURCE_REMOVE;
        });
        this._timers.set('weather', GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
            this.fetchWeatherNow().catch(() => {});
            return GLib.SOURCE_CONTINUE;
        }));
    }

    _stopPoller(key) {
        const id = this._timers.get(key);
        if (id) { GLib.source_remove(id); this._timers.delete(key); }
    }

    async _geolocate() {
        try {
            const { default: Geoclue } = await import('gi://Geoclue');
            const client = await Geoclue.Simple.new('tahoe-widgets', Geoclue.AccuracyLevel.CITY, null);
            const loc = client.get_location();
            return { lat: loc.get_latitude(), lon: loc.get_longitude(), name: 'Current Location' };
        } catch {
            this._log.warn('Geoclue unavailable, falling back to IP');
        }
        try {
            const raw = await this._get('http://ip-api.com/json/?fields=lat,lon,city');
            return { lat: raw.lat, lon: raw.lon, name: raw.city ?? 'Auto' };
        } catch {
            throw new Error('Auto-location failed. Set a city in Settings.');
        }
    }

    async _geocodeCity(city) {
        const url  = `${GEO_BASE}?name=${encodeURIComponent(city)}&count=1&language=en&format=json`;
        const data = await this._get(url);
        const r    = data?.results?.[0];
        if (!r) throw new Error(`City not found: "${city}"`);
        return { lat: r.latitude, lon: r.longitude, name: r.name };
    }

    _parseCoordsString(str) {
        const [lat, lon] = str.split(',').map(Number);
        if (isNaN(lat) || isNaN(lon)) throw new Error('Invalid coordinates');
        return { lat, lon, name: str };
    }

    async _fetchWeatherCoords({ lat, lon, name }, unit) {
        const tUnit = unit === 'fahrenheit' ? 'fahrenheit' : 'celsius';
        const sym   = unit === 'fahrenheit' ? '°F' : '°C';
        const url   = `${WEATHER_BASE}?latitude=${lat}&longitude=${lon}`
            + `&current=temperature_2m,weathercode,windspeed_10m,relativehumidity_2m`
            + `&hourly=temperature_2m,weathercode`
            + `&daily=temperature_2m_max,temperature_2m_min,weathercode`
            + `&temperature_unit=${tUnit}&wind_speed_unit=kmh&forecast_days=3&timezone=auto`;
        const raw = await this._get(url);
        return this._normaliseWeather(raw, name, sym);
    }

    _normaliseWeather(raw, locationName, sym) {
        const c   = raw.current;
        const d   = raw.daily;
        const h   = raw.hourly;
        const wmo = WMO[c.weathercode] ?? ['cloud', 'Unknown'];
        const now     = new Date();
        const curHour = now.getHours();
        const forecast = [];
        for (let i = 1; i <= 6; i++) {
            const idx = curHour + i;
            if (idx >= h.time.length) break;
            const fw = WMO[h.weathercode[idx]] ?? ['cloud', ''];
            forecast.push({ time: h.time[idx].slice(11, 16), icon: fw[0],
                wmoCode: h.weathercode[idx],
                temp: `${Math.round(h.temperature_2m[idx])}${sym}` });
        }
        return {
            location: locationName, temperature: Math.round(c.temperature_2m),
            unit: sym, description: wmo[1], icon: wmo[0],
            wmoCode: c.weathercode,
            high: `${Math.round(d.temperature_2m_max[0])}${sym}`,
            low:  `${Math.round(d.temperature_2m_min[0])}${sym}`,
            humidity: `${c.relativehumidity_2m}%`,
            wind: `${Math.round(c.windspeed_10m)} km/h`,
            forecast, fetchedAt: Date.now(),
        };
    }

    _get(url) {
        return new Promise((resolve, reject) => {
            try {
                const msg = Soup.Message.new('GET', url);
                this._session.send_and_read_async(msg, GLib.PRIORITY_DEFAULT, null, (sess, res) => {
                    try {
                        const bytes = sess.send_and_read_finish(res);
                        resolve(JSON.parse(new TextDecoder().decode(bytes.get_data())));
                    } catch (e) { reject(e); }
                });
            } catch (e) { reject(e); }
        });
    }

    _subscribe(key, fn) {
        if (!this._listeners.has(key)) this._listeners.set(key, new Set());
        this._listeners.get(key).add(fn);
        return () => this._listeners.get(key)?.delete(fn);
    }

    _notify(key, data) {
        this._listeners.get(key)?.forEach(fn => { try { fn(data); } catch {} });
    }

    destroy() {
        this._timers.forEach(id => GLib.source_remove(id));
        this._timers.clear();
        this._unsubWeather?.();
        this._unsubLoc?.();
        this._listeners.clear();
        this._session = null;
    }
}
