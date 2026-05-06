/**
 * DataManager — central hub for all external data.
 *
 * - Caches responses so multiple widgets share one fetch
 * - Implements exponential back-off on failures
 * - Notifies subscribers when fresh data arrives
 * - Cleans up all timers on destroy()
 */

import Soup   from 'gi://Soup';
import GLib   from 'gi://GLib';
import { Logger } from '../utils/logger.js';

const WEATHER_BASE  = 'https://api.open-meteo.com/v1/forecast';
const GEO_BASE      = 'https://geocoding-api.open-meteo.com/v1/search';

const WMO = {
    0:  ['☀️',  'Clear'],        1:  ['🌤️', 'Mostly Clear'],
    2:  ['⛅',  'Partly Cloudy'], 3:  ['☁️',  'Overcast'],
    45: ['🌫️', 'Fog'],           48: ['🌫️', 'Rime Fog'],
    51: ['🌦️', 'Light Drizzle'], 53: ['🌦️', 'Drizzle'],   55: ['🌧️', 'Heavy Drizzle'],
    61: ['🌧️', 'Light Rain'],    63: ['🌧️', 'Rain'],       65: ['🌧️', 'Heavy Rain'],
    71: ['🌨️', 'Light Snow'],    73: ['🌨️', 'Snow'],       75: ['❄️',  'Heavy Snow'],
    80: ['🌦️', 'Showers'],       81: ['🌧️', 'Rain Showers'],
    85: ['🌨️', 'Snow Showers'],
    95: ['⛈️',  'Thunderstorm'],  96: ['⛈️',  'Thunderstorm + Hail'],
};

export class DataManager {
    constructor(state) {
        this._state     = state;
        this._log       = new Logger('Data');
        this._session   = new Soup.Session();
        this._session.timeout = 15;

        this._cache     = new Map();  // key → { data, ts }
        this._timers    = new Map();  // key → GLib source id
        this._listeners = new Map();  // key → Set<fn>
        this._backoff   = new Map();  // key → retry count

        // Start weather poller if location is configured
        this._startWeatherPoller();

        // Re-start poller when relevant settings change
        this._unsubWeather = state.subscribe('settings:weather-refresh-minutes',
            () => this._startWeatherPoller());
        this._unsubLoc = state.subscribe('settings:weather-location',
            () => { this._cache.delete('weather'); this._startWeatherPoller(); });
    }

    /* ══ Weather ══════════════════════════════════════════════════════ */

    /**
     * Get cached weather data (may be null if not yet fetched).
     * Triggers a fresh fetch if cache is stale.
     */
    getWeather() {
        return this._cache.get('weather')?.data ?? null;
    }

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

    /* ══ Private: weather internals ═══════════════════════════════════ */

    _startWeatherPoller() {
        this._stopPoller('weather');
        const minutes = this._state.weatherRefresh ?? 15;
        const ms      = Math.max(5, minutes) * 60_000;

        // Immediate fetch
        GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this.fetchWeatherNow().catch(() => {});
            return GLib.SOURCE_REMOVE;
        });

        this._timers.set('weather', GLib.timeout_add(
            GLib.PRIORITY_DEFAULT, ms,
            () => {
                this.fetchWeatherNow().catch(() => {});
                return GLib.SOURCE_CONTINUE;
            }
        ));
    }

    _stopPoller(key) {
        const id = this._timers.get(key);
        if (id) { GLib.source_remove(id); this._timers.delete(key); }
    }

    async _geolocate() {
        // Try Geoclue if available
        try {
            const { default: Geoclue } = await import('gi://Geoclue');
            const client = await Geoclue.Simple.new(
                'tahoe-widgets', Geoclue.AccuracyLevel.CITY, null
            );
            const loc = client.get_location();
            return {
                lat:  loc.get_latitude(),
                lon:  loc.get_longitude(),
                name: 'Current Location',
            };
        } catch {
            this._log.warn('Geoclue unavailable, falling back to IP geolocation');
        }
        // Fallback: ip-api.com (no key, ~1000 req/day free)
        try {
            const raw  = await this._get('http://ip-api.com/json/?fields=lat,lon,city');
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
        const url   = `${WEATHER_BASE}`
            + `?latitude=${lat}&longitude=${lon}`
            + `&current=temperature_2m,weathercode,windspeed_10m,relativehumidity_2m`
            + `&hourly=temperature_2m,weathercode`
            + `&daily=temperature_2m_max,temperature_2m_min,weathercode`
            + `&temperature_unit=${tUnit}`
            + `&wind_speed_unit=kmh`
            + `&forecast_days=3`
            + `&timezone=auto`;

        const raw = await this._get(url);
        return this._normaliseWeather(raw, name, sym);
    }

    _normaliseWeather(raw, locationName, sym) {
        const c   = raw.current;
        const d   = raw.daily;
        const h   = raw.hourly;
        const wmo = WMO[c.weathercode] ?? ['🌡️', 'Unknown'];

        const now     = new Date();
        const curHour = now.getHours();

        const forecast = [];
        for (let i = 1; i <= 6; i++) {
            const idx = curHour + i;
            if (idx >= h.time.length) break;
            const fw = WMO[h.weathercode[idx]] ?? ['🌡️', ''];
            forecast.push({
                time: h.time[idx].slice(11, 16),
                icon: fw[0],
                temp: `${Math.round(h.temperature_2m[idx])}${sym}`,
            });
        }

        return {
            location:    locationName,
            temperature: Math.round(c.temperature_2m),
            unit:        sym,
            description: wmo[1],
            icon:        wmo[0],
            high:        `${Math.round(d.temperature_2m_max[0])}${sym}`,
            low:         `${Math.round(d.temperature_2m_min[0])}${sym}`,
            humidity:    `${c.relativehumidity_2m}%`,
            wind:        `${Math.round(c.windspeed_10m)} km/h`,
            forecast,
            fetchedAt:   Date.now(),
        };
    }

    /* ══ HTTP ═════════════════════════════════════════════════════════ */

    _get(url) {
        return new Promise((resolve, reject) => {
            try {
                const msg = Soup.Message.new('GET', url);
                this._session.send_and_read_async(
                    msg, GLib.PRIORITY_DEFAULT, null,
                    (sess, res) => {
                        try {
                            const bytes = sess.send_and_read_finish(res);
                            const text  = new TextDecoder().decode(bytes.get_data());
                            resolve(JSON.parse(text));
                        } catch (e) { reject(e); }
                    }
                );
            } catch (e) { reject(e); }
        });
    }

    /* ══ Pub/sub ══════════════════════════════════════════════════════ */

    _subscribe(key, fn) {
        if (!this._listeners.has(key)) this._listeners.set(key, new Set());
        this._listeners.get(key).add(fn);
        return () => this._listeners.get(key)?.delete(fn);
    }

    _notify(key, data) {
        this._listeners.get(key)?.forEach(fn => { try { fn(data); } catch {} });
    }

    /* ══ Lifecycle ════════════════════════════════════════════════════ */

    destroy() {
        this._timers.forEach((id) => GLib.source_remove(id));
        this._timers.clear();
        this._unsubWeather?.();
        this._unsubLoc?.();
        this._listeners.clear();
        this._session = null;
    }
}
