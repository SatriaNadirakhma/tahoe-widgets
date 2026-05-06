/**
 * Tahoe Widgets v2 — Production-Ready GNOME Shell Extension
 *
 * Architecture overview
 * ─────────────────────
 * extension.js (this file)
 *   └─ orchestrates four core singletons:
 *
 *  StateManager    — single source of truth (GSettings + widget positions)
 *  WidgetRegistry  — catalog of available widget types + active instances
 *  LayoutManager   — full-screen canvas, drag/drop, snapping, z-order
 *  DataManager     — external data fetching (weather, geolocation)
 *
 *  Two UI helpers:
 *  WidgetPicker    — slide-in "Add Widget" panel
 *  TahoePanelButton— top-bar indicator with menu
 *
 * Startup sequence
 * ─────────────────
 *  1. Build core singletons
 *  2. Register all widget descriptors into WidgetRegistry
 *  3. Load active widget list from StateManager
 *  4. Instantiate each saved widget + add to LayoutManager canvas
 *  5. If first run → show onboarding notification
 *
 * No widget is shown automatically on fresh install.
 * User adds them via the WidgetPicker (🌊 panel button → Add Widget).
 */

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

import { Logger }          from './src/utils/logger.js';
import { StateManager }    from './src/core/stateManager.js';
import { WidgetRegistry }  from './src/core/widgetRegistry.js';
import { LayoutManager }   from './src/core/layoutManager.js';
import { DataManager }     from './src/core/dataManager.js';
import { WidgetPicker }    from './src/ui/widgetPicker.js';
import { TahoePanelButton } from './src/ui/panelButton.js';

// Widget classes
import { ClockWidget }     from './src/widgets/clockWidget.js';
import { WeatherWidget }   from './src/widgets/weatherWidget.js';
import { CalendarWidget }  from './src/widgets/calendarWidget.js';
import {
    WorldClockWidget,
    BatteryWidget,
    QuickStatusWidget,
} from './src/widgets/otherWidgets.js';

/** All available widget descriptors — edit here to add new widgets. */
const WIDGET_CATALOG = [
    {
        id:          'clock',
        label:       'Clock',
        description: 'Live digital clock with date',
        icon:        '🕐',
        Cls:         ClockWidget,
    },
    {
        id:          'weather',
        label:       'Weather',
        description: 'Current conditions + 6-hour forecast',
        icon:        '🌤️',
        Cls:         WeatherWidget,
    },
    {
        id:          'calendar',
        label:       'Calendar',
        description: 'Monthly mini-calendar with today highlight',
        icon:        '📅',
        Cls:         CalendarWidget,
    },
    {
        id:          'worldClock',
        label:       'World Clock',
        description: 'Time in multiple timezones',
        icon:        '🌍',
        Cls:         WorldClockWidget,
    },
    {
        id:          'battery',
        label:       'Battery',
        description: 'System battery + connected devices',
        icon:        '🔋',
        Cls:         BatteryWidget,
    },
    {
        id:          'quickStatus',
        label:       'Quick Status',
        description: 'Wi-Fi, Bluetooth, CPU & RAM',
        icon:        '📊',
        Cls:         QuickStatusWidget,
    },
];

export default class TahoeWidgetsExtension extends Extension {
    /* ══ enable ════════════════════════════════════════════════════════ */

    enable() {
        this._log = new Logger('Extension');
        this._log.info('Enabling Tahoe Widgets v2');

        try {
            // 1. Core singletons
            this._state    = new StateManager(this.getSettings());
            this._registry = new WidgetRegistry(this._state);
            this._layout   = new LayoutManager(this._state);
            this._data     = new DataManager(this._state);

            // 2. Register widget catalog
            WIDGET_CATALOG.forEach(desc => this._registry.register(desc));

            // 3. Restore previously active widgets
            this._restoreWidgets();

            // 4. UI chrome
            this._picker = new WidgetPicker(this._registry, this._state);
            this._panelBtn = new TahoePanelButton(
                this._picker, this._layout, this._state
            );

            // 5. Wire registry → layout (add/remove from canvas automatically)
            this._wireRegistryToLayout();

            // 6. Hide widgets in Activities overview
            this._overviewShowId = Main.overview.connect('showing',
                () => this._layout.hide());
            this._overviewHideId = Main.overview.connect('hidden',
                () => this._layout.show());

            // 7. First-run onboarding
            if (this._state.isFirstRun) {
                this._state.isFirstRun = false;
                Main.notify(
                    'Tahoe Widgets',
                    'Click 🌊 in the top bar → "Add Widget" to get started!'
                );
            }

            this._log.info('Tahoe Widgets enabled successfully');
        } catch (e) {
            this._log.error('Failed to enable:', e.message, e.stack);
            // Clean up partial state so GNOME Shell doesn't crash
            this._safeDisable();
        }
    }

    /* ══ disable ═══════════════════════════════════════════════════════ */

    disable() {
        this._log?.info('Disabling Tahoe Widgets');
        this._safeDisable();
        this._log?.info('Disabled');
        this._log = null;
    }

    _safeDisable() {
        // Disconnect overview signals
        if (this._overviewShowId) {
            Main.overview.disconnect(this._overviewShowId);
            this._overviewShowId = null;
        }
        if (this._overviewHideId) {
            Main.overview.disconnect(this._overviewHideId);
            this._overviewHideId = null;
        }

        // Teardown in reverse construction order
        this._panelBtn?.destroy();  this._panelBtn = null;
        this._picker?.destroy();    this._picker   = null;
        this._registry?.destroyAll();
        this._registry = null;
        this._layout?.destroy();    this._layout   = null;
        this._data?.destroy();      this._data     = null;
        this._state?.destroy();     this._state    = null;
    }

    /* ══ Widget restoration ════════════════════════════════════════════ */

    _restoreWidgets() {
        const activeIds = this._state.getActiveWidgets();
        this._log.info(`Restoring ${activeIds.length} widget(s):`, activeIds);

        activeIds.forEach(id => {
            try {
                const widget = this._registry.instantiate(id, {
                    data: this._data,
                });
                this._layout.addWidget(widget);
            } catch (e) {
                this._log.error(`Failed to restore widget '${id}':`, e.message);
                // Remove broken widget from active list so it doesn't loop-crash
                this._state.removeActiveWidget(id);
            }
        });
    }

    /* ══ Registry → Layout wiring ═════════════════════════════════════ */

    /**
     * Monkey-patch the registry's instantiate/destroyWidget so that
     * whenever the user adds or removes a widget via the picker,
     * the layout canvas is automatically updated.
     */
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
}
