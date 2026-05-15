/**
 * Tahoe Widgets v3.1 — extension.js  FIXED
 *
 * Fixes:
 *  1. _wireRegistryToLayout must run BEFORE WidgetPicker is created,
 *     so picker also uses the patched (layout-aware) instantiate.
 *  2. Re-entrancy guard: _syncing flag prevents _syncWidgets from being
 *     called recursively when destroyWidget internally modifies GSettings.
 *  3. First-run: show notification whenever no widgets are active,
 *     not just on literal first-run flag.
 *  4. Better error reporting with Main.notify on enable failure.
 */

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

import { Logger }           from './src/utils/logger.js';
import { registerFonts, unregisterFonts } from './src/utils/fontLoader.js';
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
    { id: 'clock',       label: 'Clock',        description: 'Live digital clock',       icon: '🕐', Cls: ClockWidget       },
    { id: 'weather',     label: 'Weather',       description: 'Conditions + 6hr forecast', icon: '🌤️', Cls: WeatherWidget    },
    { id: 'calendar',    label: 'Calendar',      description: 'Monthly mini-calendar',    icon: '📅', Cls: CalendarWidget    },
    { id: 'worldClock',  label: 'World Clock',   description: 'Multi-timezone display',   icon: '🌍', Cls: WorldClockWidget  },
    { id: 'battery',     label: 'Battery',       description: 'Battery + devices',        icon: '🔋', Cls: BatteryWidget     },
    { id: 'quickStatus', label: 'Quick Status',  description: 'Wi-Fi, CPU, RAM',          icon: '📊', Cls: QuickStatusWidget },
];

export default class TahoeWidgetsExtension extends Extension {

    enable() {
        this._log     = new Logger('Extension');
        this._syncing = false;   // re-entrancy guard
        this._log.info('Enabling Tahoe Widgets v3.1.0');

        try {
            // ── 0. Daftarkan font Inter dari folder fonts/ ─────────
            //    Harus sebelum widget dibuat agar St.Theme sudah
            //    mengenal "Inter" saat CSS pertama kali di-parse.
            registerFonts(this.path);

            // ── 1. Core singletons ─────────────────────────────────
            this._state    = new StateManager(this.getSettings());
            this._registry = new WidgetRegistry(this._state);
            this._layout   = new LayoutManager(this._state);
            this._data     = new DataManager(this._state);

            // ── 2. Register widget catalog ─────────────────────────
            WIDGET_CATALOG.forEach(d => this._registry.register(d));

            // ── 3. Wire registry → layout (MUST be before picker!) ─
            //    Picker gets the registry reference AFTER patching so
            //    picker.instantiate also calls layout.addWidget.
            this._wireRegistryToLayout();

            // ── 4. Restore saved active widgets ────────────────────
            const saved = this._state.getActiveWidgets();
            this._log.info(`Restoring ${saved.length} widget(s):`, saved);
            this._syncWidgets(saved);

            // ── 5. UI chrome (after wire, so picker uses patched registry) ──
            this._picker   = new WidgetPicker(this._registry, this._state);
            this._panelBtn = new TahoePanelButton(
                this._picker, this._layout, this._state
            );

            // ── 6. Live-watch active-widgets GSettings changes ─────
            this._unsubActiveWidgets = this._state.subscribe(
                'settings:active-widgets',
                () => this._onActiveWidgetsChanged()
            );

            // ── 7. Hide widgets when Activities overview opens ─────
            this._overviewShowId = Main.overview.connect('showing',
                () => this._layout.hide());
            this._overviewHideId = Main.overview.connect('hidden',
                () => this._layout.show());

            // ── 7b. Hide widgets on lock screen, restore on unlock ──
            //    Lock does NOT call disable()/enable(), so we must handle
            //    it explicitly via screenShield signals.
            if (Main.screenShield) {
                this._lockId = Main.screenShield.connect('lock-screen-shown',
                    () => this._layout.hide());
                this._unlockId = Main.screenShield.connect('lock-screen-hidden',
                    () => this._layout.show());
            }

            // ── 8. Onboarding: show hint ONCE on genuine first run ───
            //    isFirstRun guards against re-showing after suspend/resume
            //    or any other disable→enable cycle (e.g. GNOME Shell restart).
            if (saved.length === 0 && this._state.isFirstRun) {
                Main.notify(
                    'Tahoe Widgets',
                    'Click 🌊 on the top bar → "Add Widget" for adding new widgets!'
                );
                this._state.isFirstRun = false;   // never show again
            }

            this._log.info('Tahoe Widgets v3.1.0 enabled successfully');

        } catch (e) {
            this._log.error('Enable FAILED:', e.message, e.stack ?? '');
            Main.notify('Tahoe Widgets ERROR', e.message);
            this._safeDisable();
        }
    }

    disable() {
        this._log?.info('Disabling');
        this._safeDisable();
        this._log = null;
    }

    /* ══ Active-widgets sync ══════════════════════════════════════════ */

    _onActiveWidgetsChanged() {
        if (this._syncing) return;   // prevent re-entrant call
        const desired = this._state.getActiveWidgets();
        this._log.info('active-widgets changed →', desired);
        this._syncWidgets(desired);
    }

    _syncWidgets(desiredIds) {
        if (this._syncing) return;
        this._syncing = true;

        try {
            const currentIds = this._registry.getActiveInstances().map(w => w.id);

            // Add widgets that should exist but don't yet
            for (const id of desiredIds) {
                if (!this._registry.isActive(id)) {
                    try {
                        this._registry.instantiate(id, { data: this._data });
                        this._log.info(`+ Added widget: ${id}`);
                    } catch (e) {
                        this._log.error(`Failed to add '${id}':`, e.message);
                        // Remove from GSettings so we don't retry-crash on next load
                        this._state.removeActiveWidget(id);
                    }
                }
            }

            // Remove widgets that are active but no longer desired
            for (const id of currentIds) {
                if (!desiredIds.includes(id)) {
                    try {
                        this._registry.destroyWidget(id);
                        this._log.info(`- Removed widget: ${id}`);
                    } catch (e) {
                        this._log.error(`Failed to remove '${id}':`, e.message);
                    }
                }
            }
        } finally {
            this._syncing = false;
        }
    }

    /* ══ Registry → Layout wiring ═════════════════════════════════════ */

    _wireRegistryToLayout() {
        // Capture originals BEFORE patching
        const origInstantiate = this._registry.instantiate.bind(this._registry);
        const origDestroy     = this._registry.destroyWidget.bind(this._registry);

        // Patched instantiate: create widget + add to canvas
        this._registry.instantiate = (id, opts = {}) => {
            const widget = origInstantiate(id, { ...opts, data: this._data });
            this._layout.addWidget(widget);
            return widget;
        };

        // Patched destroyWidget: remove from canvas + destroy.
        // opts (e.g. { silent: true }) MUST be forwarded to origDestroy so
        // the silent flag reaches state.removeActiveWidget() guard.
        this._registry.destroyWidget = (id, opts = {}) => {
            this._layout.removeWidget(id);   // remove actor from canvas first
            origDestroy(id, opts);            // forward opts — silent flag preserved
        };
    }

    /* ══ Safe cleanup ═════════════════════════════════════════════════ */

    _safeDisable() {
        if (this._overviewShowId) {
            Main.overview.disconnect(this._overviewShowId);
            this._overviewShowId = null;
        }
        if (this._overviewHideId) {
            Main.overview.disconnect(this._overviewHideId);
            this._overviewHideId = null;
        }
        if (this._lockId && Main.screenShield) {
            Main.screenShield.disconnect(this._lockId);
            this._lockId = null;
        }
        if (this._unlockId && Main.screenShield) {
            Main.screenShield.disconnect(this._unlockId);
            this._unlockId = null;
        }
        if (this._unsubActiveWidgets) {
            this._unsubActiveWidgets();
            this._unsubActiveWidgets = null;
        }

        this._panelBtn?.destroy();    this._panelBtn = null;
        this._picker?.destroy();      this._picker   = null;

        // Restore original methods before destroying registry
        // (so destroyAll doesn't call the patched version after layout is gone)
        if (this._registry) {
            // Use destroyAllSilent so active-widgets GSettings key is preserved.
            // destroyAll() → destroyWidget() → removeActiveWidget() would wipe
            // the list, causing widgets to not restore after suspend/resume or
            // any other disable→enable cycle (lock screen, GNOME restart, etc.)
            try { this._registry.destroyAllSilent(); } catch {}
            this._registry = null;
        }

        this._layout?.destroy();      this._layout   = null;
        this._data?.destroy();        this._data     = null;
        this._state?.destroy();       this._state    = null;

        // Unregister font Inter dari St.Theme — paling akhir,
        // setelah semua widget yang memakai font tersebut sudah di-destroy.
        unregisterFonts();
    }
}