/**
 * WeatherFetcher — fetches weather data from Open-Meteo (free, no key)
 * or OpenWeatherMap (requires API key).
 *
 * Uses GLib's Soup HTTP client via Shell's async helpers.
 */

import Soup   from 'gi://Soup';
import GLib   from 'gi://GLib';
import Gio    from 'gi://Gio';

const OPEN_METEO_GEO_URL    = 'https://geocoding-api.open-meteo.com/v1/search';
const OPEN_METEO_WEATHER_URL = 'https://api.open-meteo.com/v1/forecast';

// WMO Weather Codes → emoji + description
const WMO_CODES = {
    0:  ['☀️',  'Clear'],
    1:  ['🌤️', 'Mostly Clear'],
    2:  ['⛅',  'Partly Cloudy'],
    3:  ['☁️',  'Overcast'],
    45: ['🌫️', 'Foggy'],
    48: ['🌫️', 'Rime Fog'],
    51: ['🌦️', 'Light Drizzle'],
    53: ['🌦️', 'Drizzle'],
    61: ['🌧️', 'Light Rain'],
    63: ['🌧️', 'Rain'],
    65: ['🌧️', 'Heavy Rain'],
    71: ['🌨️', 'Light Snow'],
    73: ['🌨️', 'Snow'],
    80: ['🌦️', 'Showers'],
    95: ['⛈️',  'Thunderstorm'],
};

export class WeatherFetcher {
    constructor() {
        this._session = new Soup.Session();
        this._session.timeout = 10;
    }

    /**
     * Fetch weather for a location string.
     * Returns a normalised WeatherData object.
     */
    async fetch(location, unit = 'celsius') {
        const coords = await this._geocode(location);
        if (!coords) throw new Error(`Cannot geocode: ${location}`);

        const tempUnit = unit === 'fahrenheit' ? 'fahrenheit' : 'celsius';
        const url = `${OPEN_METEO_WEATHER_URL}` +
            `?latitude=${coords.lat}&longitude=${coords.lon}` +
            `&current=temperature_2m,weathercode,windspeed_10m,relativehumidity_2m` +
            `&hourly=temperature_2m,weathercode` +
            `&daily=temperature_2m_max,temperature_2m_min` +
            `&temperature_unit=${tempUnit}` +
            `&wind_speed_unit=kmh` +
            `&forecast_days=1` +
            `&timezone=auto`;

        const data = await this._get(url);
        return this._normalise(data, coords.name, unit);
    }

    async _geocode(query) {
        const url = `${OPEN_METEO_GEO_URL}?name=${encodeURIComponent(query)}&count=1&language=en&format=json`;
        const data = await this._get(url);
        const r = data?.results?.[0];
        if (!r) return null;
        return { lat: r.latitude, lon: r.longitude, name: r.name };
    }

    _normalise(raw, locationName, unit) {
        const c   = raw.current;
        const d   = raw.daily;
        const h   = raw.hourly;
        const sym = unit === 'fahrenheit' ? '°F' : '°C';

        const wmo     = WMO_CODES[c.weathercode] ?? ['🌡️', 'Unknown'];
        const now     = new Date();
        const curHour = now.getHours();

        // Build next 5 hourly forecasts
        const forecast = [];
        for (let i = 0; i < 5; i++) {
            const idx  = curHour + 1 + i;
            if (idx >= h.time.length) break;
            const fwmo = WMO_CODES[h.weathercode[idx]] ?? ['🌡️', ''];
            forecast.push({
                time:  h.time[idx].slice(11, 16),   // HH:MM
                icon:  fwmo[0],
                temp:  `${Math.round(h.temperature_2m[idx])}${sym}`,
            });
        }

        return {
            location:    locationName,
            temperature: `${Math.round(c.temperature_2m)}`,
            unit:        sym,
            description: wmo[1],
            icon:        wmo[0],
            high:        `${Math.round(d.temperature_2m_max[0])}${sym}`,
            low:         `${Math.round(d.temperature_2m_min[0])}${sym}`,
            humidity:    `${c.relativehumidity_2m}%`,
            wind:        `${Math.round(c.windspeed_10m)} km/h`,
            forecast,
            updatedAt:   Date.now(),
        };
    }

    _get(url) {
        return new Promise((resolve, reject) => {
            const msg = Soup.Message.new('GET', url);
            this._session.send_and_read_async(
                msg, GLib.PRIORITY_DEFAULT, null,
                (session, result) => {
                    try {
                        const bytes = session.send_and_read_finish(result);
                        const json  = new TextDecoder().decode(bytes.get_data());
                        resolve(JSON.parse(json));
                    } catch (e) {
                        reject(e);
                    }
                }
            );
        });
    }

    destroy() {
        this._session = null;
    }
}
