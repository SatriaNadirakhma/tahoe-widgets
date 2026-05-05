/**
 * StateManager — wraps GSettings and in-memory widget state.
 * Provides typed getters/setters and persists positions.
 */

export class StateManager {
    constructor(gSettings) {
        this._settings  = gSettings;
        this._positions = this._loadPositions();
        this._listeners = new Map();
    }

    /* ── Public API ──────────────────────────────────────────────── */

    getSettings() {
        return {
            enabledWidgets:       this._settings.get_strv('enabled-widgets'),
            blurRadius:           this._settings.get_int('blur-radius'),
            opacity:              this._settings.get_double('opacity'),
            cornerRadius:         this._settings.get_int('corner-radius'),
            widgetSpacing:        this._settings.get_int('widget-spacing'),
            weatherLocation:      this._settings.get_string('weather-location'),
            weatherUnit:          this._settings.get_string('weather-unit'),
            weatherProvider:      this._settings.get_string('weather-provider'),
            owmApiKey:            this._settings.get_string('openweathermap-api-key'),
            worldClockCities:     this._settings.get_strv('world-clock-cities'),
            clockFormat:          this._settings.get_string('clock-format'),
            snapToGrid:           this._settings.get_boolean('snap-to-grid'),
            snapGridSize:         this._settings.get_int('snap-grid-size'),
        };
    }

    getWidgetPosition(id) {
        return this._positions[id] ?? null;
    }

    setWidgetPosition(id, x, y) {
        this._positions[id] = { x, y };
        this._notifyListeners('positions', this._positions);
    }

    save() {
        this._settings.set_string(
            'widget-positions',
            JSON.stringify(this._positions)
        );
    }

    subscribe(event, fn) {
        if (!this._listeners.has(event))
            this._listeners.set(event, new Set());
        this._listeners.get(event).add(fn);
        return () => this._listeners.get(event)?.delete(fn);
    }

    connectSettings(key, fn) {
        return this._settings.connect(`changed::${key}`, fn);
    }

    disconnectSettings(id) {
        this._settings.disconnect(id);
    }

    /* ── Private ─────────────────────────────────────────────────── */

    _loadPositions() {
        try {
            const raw = this._settings.get_string('widget-positions');
            return raw ? JSON.parse(raw) : {};
        } catch {
            return {};
        }
    }

    _notifyListeners(event, data) {
        this._listeners.get(event)?.forEach(fn => fn(data));
    }
}
