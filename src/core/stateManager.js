/**
 * StateManager v2.1 — FIXED
 *
 * Fix: removeActiveWidget / setActiveWidgets modify GSettings which triggers
 *      the 'changed' signal which calls _notify('settings:active-widgets', …)
 *      which can cause re-entrant _syncWidgets calls.
 *      Guard with _suppressNotify flag during programmatic writes.
 */

import GLib from 'gi://GLib';
import { Logger } from '../utils/logger.js';

const SAVE_DEBOUNCE_MS = 300;

export class StateManager {
    constructor(gSettings) {
        this._s              = gSettings;
        this._log            = new Logger('State');
        this._ws             = this._loadWidgetStates();
        this._listeners      = new Map();
        this._saveTimer      = null;
        this._suppressNotify = false;   // ← re-entrancy guard

        this._settingsChangedId = this._s.connect('changed', (_, key) => {
            if (!this._suppressNotify)
                this._notify(`settings:${key}`, this._s.get_value(key));
        });
    }

    /* ══ Widget state ════════════════════════════════════════════════ */

    getWidgetState(id)        { return { ...(this._ws[id] ?? {}) }; }
    getAllWidgetStates()       { return { ...this._ws }; }

    setWidgetState(id, partial) {
        this._ws[id] = { ...(this._ws[id] ?? {}), ...partial };
        this._scheduleSave();
    }

    deleteWidgetState(id) {
        delete this._ws[id];
        this._scheduleSave();
    }

    /* ══ Active widget list ══════════════════════════════════════════ */

    getActiveWidgets() {
        return this._s.get_strv('active-widgets');
    }

    setActiveWidgets(ids) {
        // Suppress the GSettings 'changed' echo so callers don't get a
        // recursive _syncWidgets call triggered by their own write.
        this._suppressNotify = true;
        try {
            this._s.set_strv('active-widgets', ids);
        } finally {
            this._suppressNotify = false;
        }
    }

    addActiveWidget(id) {
        const cur = this.getActiveWidgets();
        if (!cur.includes(id)) this.setActiveWidgets([...cur, id]);
    }

    removeActiveWidget(id) {
        this.setActiveWidgets(this.getActiveWidgets().filter(x => x !== id));
        this.deleteWidgetState(id);
    }

    /* ══ Visual settings (typed getters/setters) ═════════════════════ */

    get blurRadius()      { return this._s.get_int('blur-radius');            }
    get panelOpacity()    { return this._s.get_double('panel-opacity');       }
    get cornerRadius()    { return this._s.get_int('corner-radius');          }
    get widgetSpacing()   { return this._s.get_int('widget-spacing');         }
    get colorScheme()     { return this._s.get_string('color-scheme');        }
    get snapToGrid()      { return this._s.get_boolean('snap-to-grid');       }
    get gridSize()        { return this._s.get_int('grid-size');              }
    get topBarMargin()    { return this._s.get_int('top-bar-margin');         }
    get dockMargin()      { return this._s.get_int('dock-margin');            }
    get clockFormat()     { return this._s.get_string('clock-format');        }
    get clockSeconds()    { return this._s.get_boolean('clock-show-seconds'); }
    get weatherLocation() { return this._s.get_string('weather-location');    }
    get weatherUnit()     { return this._s.get_string('weather-unit');        }
    get weatherRefresh()  { return this._s.get_int('weather-refresh-minutes');}
    get worldClockZones() { return this._s.get_strv('world-clock-zones');     }
    get isFirstRun()      { return this._s.get_boolean('first-run');          }

    set blurRadius(v)      { this._s.set_int('blur-radius', v);              }
    set panelOpacity(v)    { this._s.set_double('panel-opacity', v);         }
    set cornerRadius(v)    { this._s.set_int('corner-radius', v);            }
    set widgetSpacing(v)   { this._s.set_int('widget-spacing', v);           }
    set colorScheme(v)     { this._s.set_string('color-scheme', v);          }
    set snapToGrid(v)      { this._s.set_boolean('snap-to-grid', v);         }
    set gridSize(v)        { this._s.set_int('grid-size', v);                }
    set clockFormat(v)     { this._s.set_string('clock-format', v);          }
    set clockSeconds(v)    { this._s.set_boolean('clock-show-seconds', v);   }
    set weatherLocation(v) { this._s.set_string('weather-location', v);      }
    set weatherUnit(v)     { this._s.set_string('weather-unit', v);          }
    set weatherRefresh(v)  { this._s.set_int('weather-refresh-minutes', v);  }
    set worldClockZones(v) { this._s.set_strv('world-clock-zones', v);       }
    set isFirstRun(v)      { this._s.set_boolean('first-run', v);            }

    /* ══ Reset ═══════════════════════════════════════════════════════ */

    resetAll() {
        this._log.info('Resetting all settings to defaults');
        [
            'blur-radius','panel-opacity','corner-radius','widget-spacing',
            'color-scheme','snap-to-grid','grid-size','top-bar-margin','dock-margin',
            'clock-format','clock-show-seconds','weather-location','weather-unit',
            'weather-refresh-minutes','world-clock-zones','active-widgets',
            'widget-states','first-run',
        ].forEach(k => this._s.reset(k));
        this._ws = {};
        this._notify('reset', null);
    }

    /* ══ Pub/sub ══════════════════════════════════════════════════════ */

    subscribe(event, fn) {
        if (!this._listeners.has(event)) this._listeners.set(event, new Set());
        this._listeners.get(event).add(fn);
        return () => this._listeners.get(event)?.delete(fn);
    }

    /* ══ Lifecycle ════════════════════════════════════════════════════ */

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
        } catch {
            return {};
        }
    }

    _scheduleSave() {
        if (this._saveTimer) { GLib.source_remove(this._saveTimer); }
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
        this._listeners.get(event)?.forEach(fn => { try { fn(data); } catch {} });
        this._listeners.get('*')?.forEach(fn => { try { fn(event, data); } catch {} });
    }
}
