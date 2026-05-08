/**
 * Tahoe Widgets v2.1 — extension.js
 * FIX: Watch GSettings active-widgets changes in real-time.
 *      Widgets muncul/hilang langsung saat toggle di prefs,
 *      tanpa perlu restart extension.
 */

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

import { Logger }           from './src/utils/logger.js';
import { StateManager }     from './src/core/stateManager.js';
import { WidgetRegistry }   from './src/core/widgetRegistry.js';
import { LayoutManager }    from './src/core/layoutManager.js';
import { DataManager }      from './src/core/dataManager.js';
import { WidgetPicker }     from './src/ui/widgetPicker.js';
import { TahoePanelButton } from './src/ui/panelButton.js';

import { ClockWidget }    from './src/widgets/clockWidget.js';
import { WeatherWidget }  from './src/widgets/weatherWidget.js';
import { CalendarWidget } from './src/widgets/calendarWidget.js';
import {
    WorldClockWidget,
    BatteryWidget,
    QuickStatusWidget,
} from './src/widgets/otherWidgets.js';

const WIDGET_CATALOG = [
    { id: 'clock',       label: 'Clock',        description: 'Live digital clock',         icon: '🕐', Cls: ClockWidget       },
    { id: 'weather',     label: 'Weather',       description: 'Conditions + forecast',      icon: '🌤️', Cls: WeatherWidget     },
    { id: 'calendar',    label: 'Calendar',      description: 'Monthly mini-calendar',      icon: '📅', Cls: CalendarWidget    },
    { id: 'worldClock',  label: 'World Clock',   description: 'Multi-timezone display',     icon: '🌍', Cls: WorldClockWidget  },
    { id: 'battery',     label: 'Battery',       description: 'Battery + devices',          icon: '🔋', Cls: BatteryWidget     },
    { id: 'quickStatus', label: 'Quick Status',  description: 'Wi-Fi, CPU, RAM',            icon: '📊', Cls: QuickStatusWidget },
];

export default class TahoeWidgetsExtension extends Extension {

    enable() {
        this._log = new Logger('Extension');
        this._log.info('Enabling Tahoe Widgets v2.1');

        try {
            // ── Core singletons ─────────────────────────────────
            this._state    = new StateManager(this.getSettings());
            this._registry = new WidgetRegistry(this._state);
            this._layout   = new LayoutManager(this._state);
            this._data     = new DataManager(this._state);

            // ── Register catalog ─────────────────────────────────
            WIDGET_CATALOG.forEach(desc => this._registry.register(desc));

            // ── Wire registry → layout ───────────────────────────
            this._wireRegistryToLayout();

            // ── Restore saved widgets ────────────────────────────
            this._syncWidgets(this._state.getActiveWidgets());

            // ── UI chrome ────────────────────────────────────────
            this._picker   = new WidgetPicker(this._registry, this._state);
            this._panelBtn = new TahoePanelButton(
                this._picker, this._layout, this._state
            );

            // ── KEY FIX: Watch active-widgets GSettings changes ──
            // Fires every time user toggles a switch in prefs.js
            this._activeWidgetsChangedId = this._state.subscribe(
                'settings:active-widgets',
                () => this._onActiveWidgetsChanged()
            );

            // ── Hide widgets in Activities overview ───────────────
            this._overviewShowId = Main.overview.connect('showing',
                () => this._layout.hide());
            this._overviewHideId = Main.overview.connect('hidden',
                () => this._layout.show());

            // ── First-run notification ────────────────────────────
            if (this._state.isFirstRun) {
                this._state.isFirstRun = false;
                Main.notify('Tahoe Widgets',
                    'Buka Settings → Widgets untuk mengaktifkan widget!');
            }

            this._log.info('Tahoe Widgets enabled');
        } catch (e) {
            this._log.error('Enable failed:', e.message, e.stack);
            this._safeDisable();
        }
    }

    disable() {
        this._log?.info('Disabling');
        this._safeDisable();
        this._log = null;
    }

    /* ══ Sync: GSettings ↔ live instances ═══════════════════════════ */

    /**
     * Called on startup AND every time active-widgets GSettings changes.
     * Adds missing widgets, removes deactivated ones — without full restart.
     */
    _onActiveWidgetsChanged() {
        const desired = this._state.getActiveWidgets();
        this._log.info('active-widgets changed:', desired);
        this._syncWidgets(desired);
    }

    _syncWidgets(desiredIds) {
        const currentIds = this._registry.getActiveInstances().map(w => w.id);

        // Add widgets that are desired but not yet active
        desiredIds.forEach(id => {
            if (!this._registry.isActive(id)) {
                try {
                    this._registry.instantiate(id, { data: this._data });
                    this._log.info(`Added widget: ${id}`);
                } catch (e) {
                    this._log.error(`Failed to add widget '${id}':`, e.message);
                    this._state.removeActiveWidget(id);
                }
            }
        });

        // Remove widgets that are active but no longer desired
        currentIds.forEach(id => {
            if (!desiredIds.includes(id)) {
                try {
                    this._registry.destroyWidget(id);
                    this._log.info(`Removed widget: ${id}`);
                } catch (e) {
                    this._log.error(`Failed to remove widget '${id}':`, e.message);
                }
            }
        });
    }

    /* ══ Wire registry → layout ══════════════════════════════════════ */

    _wireRegistryToLayout() {
        const origInstantiate = this._registry.instantiate.bind(this._registry);
        this._registry.instantiate = (id, opts = {}) => {
            const widget = origInstantiate(id, { ...opts, data: this._data });
            this._layout.addWidget(widget);
            return widget;
        };

        const origDestroy = this._registry.destroyWidget.bind(this._registry);
        this._registry.destroyWidget = (id) => {
            this._layout.removeWidget(id);
            origDestroy(id);
        };
    }

    /* ══ Safe cleanup ════════════════════════════════════════════════ */

    _safeDisable() {
        if (this._overviewShowId) {
            Main.overview.disconnect(this._overviewShowId);
            this._overviewShowId = null;
        }
        if (this._overviewHideId) {
            Main.overview.disconnect(this._overviewHideId);
            this._overviewHideId = null;
        }
        if (this._activeWidgetsChangedId) {
            this._activeWidgetsChangedId(); // unsubscribe fn
            this._activeWidgetsChangedId = null;
        }

        this._panelBtn?.destroy();   this._panelBtn = null;
        this._picker?.destroy();     this._picker   = null;
        this._registry?.destroyAll();
        this._registry = null;
        this._layout?.destroy();     this._layout   = null;
        this._data?.destroy();       this._data     = null;
        this._state?.destroy();      this._state    = null;
    }
}