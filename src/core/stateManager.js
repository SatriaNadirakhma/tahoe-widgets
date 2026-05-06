/**
 * StateManager — single source of truth for all extension config.
 *
 * Responsibilities:
 *  - Typed read/write wrappers around GSettings
 *  - In-memory widget state (position, visibility, size)
 *  - Debounced auto-save (300 ms) so rapid drags don't thrash disk
 *  - Reset-to-defaults support
 *  - Change notifications via subscribe()
 *
 * All widget state is serialised as a single JSON blob in GSettings key
 * "widget-states" to avoid key proliferation.
 */

import GLib from 'gi://GLib';
import { Logger } from '../utils/logger.js';

const SAVE_DEBOUNCE_MS = 300;

export class StateManager {
    constructor(gSettings) {
        this._s         = gSettings;          // GSettings instance
        this._log       = new Logger('State');
        this._ws        = this._loadWidgetStates();   // in-memory widget states
        this._listeners = new Map();          // event → Set<fn>
        this._saveTimer = null;

        // Forward GSettings change signals to our own subscriber system
        this._settingsChangedId = this._s.connect('changed', (_, key) => {
            this._notify(`settings:${key}`, this._s.get_value(key));
        });
    }

    /* ══ Widget state ════════════════════════════════════════════════ */

    /** Returns a copy of the widget state for a given id. */
    getWidgetState(id) {
        return { ...this._ws[id] };
    }

    /** Merge partial state for a widget and schedule auto-save. */
    setWidgetState(id, partial) {
        const prev     = this._ws[id] ?? {};
        this._ws[id]   = { ...prev, ...partial };
        this._notify(`widget:${id}`, this._ws[id]);
        this._scheduleSave();
    }

    /** Remove a widget's state entirely. */
    deleteWidgetState(id) {
        delete this._ws[id];
        this._scheduleSave();
    }

    /** Returns all widget states as a plain object. */
    getAllWidgetStates() {
        return { ...this._ws };
    }

    /* ══ Active widget list ══════════════════════════════════════════ */

    getActiveWidgets() {
        return this._s.get_strv('active-widgets');
    }

    setActiveWidgets(ids) {
        this._s.set_strv('active-widgets', ids);
    }

    addActiveWidget(id) {
        const cur = this.getActiveWidgets();
        if (!cur.includes(id)) this.setActiveWidgets([...cur, id]);
    }

    removeActiveWidget(id) {
        this.setActiveWidgets(this.getActiveWidgets().filter(x => x !== id));
        this.deleteWidgetState(id);
    }

    /* ══ Visual settings (typed getters) ════════════════════════════ */

    get blurRadius()      { return this._s.get_int('blur-radius');         }
    get panelOpacity()    { return this._s.get_double('panel-opacity');    }
    get cornerRadius()    { return this._s.get_int('corner-radius');       }
    get widgetSpacing()   { return this._s.get_int('widget-spacing');      }
    get colorScheme()     { return this._s.get_string('color-scheme');     }
    get snapToGrid()      { return this._s.get_boolean('snap-to-grid');    }
    get gridSize()        { return this._s.get_int('grid-size');           }
    get topBarMargin()    { return this._s.get_int('top-bar-margin');      }
    get dockMargin()      { return this._s.get_int('dock-margin');         }
    get clockFormat()     { return this._s.get_string('clock-format');     }
    get clockSeconds()    { return this._s.get_boolean('clock-show-seconds'); }
    get weatherLocation() { return this._s.get_string('weather-location'); }
    get weatherUnit()     { return this._s.get_string('weather-unit');     }
    get weatherRefresh()  { return this._s.get_int('weather-refresh-minutes'); }
    get worldClockZones() { return this._s.get_strv('world-clock-zones');  }
    get isFirstRun()      { return this._s.get_boolean('first-run');       }

    set blurRadius(v)     { this._s.set_int('blur-radius', v);             }
    set panelOpacity(v)   { this._s.set_double('panel-opacity', v);        }
    set cornerRadius(v)   { this._s.set_int('corner-radius', v);           }
    set widgetSpacing(v)  { this._s.set_int('widget-spacing', v);          }
    set colorScheme(v)    { this._s.set_string('color-scheme', v);         }
    set snapToGrid(v)     { this._s.set_boolean('snap-to-grid', v);        }
    set gridSize(v)       { this._s.set_int('grid-size', v);               }
    set clockFormat(v)    { this._s.set_string('clock-format', v);         }
    set clockSeconds(v)   { this._s.set_boolean('clock-show-seconds', v);  }
    set weatherLocation(v){ this._s.set_string('weather-location', v);     }
    set weatherUnit(v)    { this._s.set_string('weather-unit', v);         }
    set weatherRefresh(v) { this._s.set_int('weather-refresh-minutes', v); }
    set worldClockZones(v){ this._s.set_strv('world-clock-zones', v);      }
    set isFirstRun(v)     { this._s.set_boolean('first-run', v);           }

    /* ══ Reset ═══════════════════════════════════════════════════════ */

    resetAll() {
        this._log.info('Resetting all settings to defaults');
        this._s.reset('blur-radius');
        this._s.reset('panel-opacity');
        this._s.reset('corner-radius');
        this._s.reset('widget-spacing');
        this._s.reset('color-scheme');
        this._s.reset('snap-to-grid');
        this._s.reset('grid-size');
        this._s.reset('clock-format');
        this._s.reset('clock-show-seconds');
        this._s.reset('weather-location');
        this._s.reset('weather-unit');
        this._s.reset('weather-refresh-minutes');
        this._s.reset('world-clock-zones');
        this._s.reset('active-widgets');
        this._s.reset('widget-states');
        this._ws = {};
        this._notify('reset', null);
    }

    /* ══ Pub/sub ══════════════════════════════════════════════════════ */

    /**
     * Subscribe to a named event.
     * @returns unsubscribe function
     */
    subscribe(event, fn) {
        if (!this._listeners.has(event)) this._listeners.set(event, new Set());
        this._listeners.get(event).add(fn);
        return () => this._listeners.get(event)?.delete(fn);
    }

    /* ══ Lifecycle ═══════════════════════════════════════════════════ */

    destroy() {
        this._flushSave();
        if (this._settingsChangedId) {
            this._s.disconnect(this._settingsChangedId);
            this._settingsChangedId = null;
        }
        this._listeners.clear();
    }

    /* ══ Private ══════════════════════════════════════════════════════ */

    _loadWidgetStates() {
        try {
            const raw = this._s.get_string('widget-states');
            return raw ? JSON.parse(raw) : {};
        } catch (e) {
            this._log?.warn('Failed to parse widget-states JSON, resetting', e.message);
            return {};
        }
    }

    _scheduleSave() {
        if (this._saveTimer) {
            GLib.source_remove(this._saveTimer);
            this._saveTimer = null;
        }
        this._saveTimer = GLib.timeout_add(
            GLib.PRIORITY_DEFAULT_IDLE, SAVE_DEBOUNCE_MS,
            () => { this._flushSave(); return GLib.SOURCE_REMOVE; }
        );
    }

    _flushSave() {
        if (this._saveTimer) {
            GLib.source_remove(this._saveTimer);
            this._saveTimer = null;
        }
        try {
            this._s.set_string('widget-states', JSON.stringify(this._ws));
        } catch (e) {
            this._log.error('Failed to save widget states', e.message);
        }
    }

    _notify(event, data) {
        // Exact match
        this._listeners.get(event)?.forEach(fn => { try { fn(data); } catch {} });
        // Wildcard listeners
        this._listeners.get('*')?.forEach(fn => { try { fn(event, data); } catch {} });
    }
}
