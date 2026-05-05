/**
 * Tahoe Widgets - GNOME Shell Extension
 * macOS Tahoe-inspired desktop widgets
 *
 * @author  Your Name
 * @license GPL-2.0-or-later
 * @version 1.0.0
 */

import GLib from 'gi://GLib';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

import { WidgetContainer } from './src/widgetContainer.js';
import { ClockWidget }     from './src/widgets/clockWidget.js';
import { WeatherWidget }   from './src/widgets/weatherWidget.js';
import { CalendarWidget }  from './src/widgets/calendarWidget.js';
import { WorldClockWidget } from './src/widgets/worldClockWidget.js';
import { BatteryWidget }   from './src/widgets/batteryWidget.js';
import { QuickStatusWidget } from './src/widgets/quickStatusWidget.js';
import { StateManager }    from './src/utils/stateManager.js';
import { Logger }          from './src/utils/logger.js';

export default class TahoeWidgetsExtension extends Extension {
    constructor(metadata) {
        super(metadata);
        this._container   = null;
        this._state       = null;
        this._widgets     = [];
        this._logger      = null;
    }

    enable() {
        this._logger = new Logger('TahoeWidgets');
        this._logger.info('Extension enabling...');

        // Initialize state manager (loads saved positions & settings)
        this._state = new StateManager(this.getSettings());

        // Build the desktop layer
        this._buildDesktopLayer();

        // Connect to overview hide/show so widgets vanish in Activities
        this._overviewShowId = Main.overview.connect('showing', () => {
            this._container?.hide();
        });
        this._overviewHideId = Main.overview.connect('hidden', () => {
            this._container?.show();
        });

        this._logger.info('Extension enabled');
    }

    disable() {
        if (this._overviewShowId) {
            Main.overview.disconnect(this._overviewShowId);
            this._overviewShowId = null;
        }
        if (this._overviewHideId) {
            Main.overview.disconnect(this._overviewHideId);
            this._overviewHideId = null;
        }

        this._destroyWidgets();
        this._container?.destroy();
        this._container = null;
        this._state?.save();
        this._state     = null;
        this._logger?.info('Extension disabled');
        this._logger    = null;
    }

    _buildDesktopLayer() {
        // Full-screen transparent actor layered just above the wallpaper
        this._container = new WidgetContainer({
            state:     this._state,
            extension: this,
        });

        Main.layoutManager._backgroundGroup.add_child(this._container.actor);
        Main.layoutManager.connectObject(
            'monitors-changed', () => this._onMonitorsChanged(), this
        );

        this._spawnWidgets();
    }

    _spawnWidgets() {
        const settings = this._state.getSettings();
        const WidgetClasses = {
            clock:       ClockWidget,
            weather:     WeatherWidget,
            calendar:    CalendarWidget,
            worldClock:  WorldClockWidget,
            battery:     BatteryWidget,
            quickStatus: QuickStatusWidget,
        };

        settings.enabledWidgets.forEach(id => {
            const Cls = WidgetClasses[id];
            if (!Cls) return;

            const widget = new Cls({
                extension: this,
                state:     this._state,
                container: this._container,
            });
            this._widgets.push(widget);
            this._container.addWidget(widget);
        });
    }

    _destroyWidgets() {
        this._widgets.forEach(w => w.destroy());
        this._widgets = [];
    }

    _onMonitorsChanged() {
        this._destroyWidgets();
        this._container.reset();
        this._spawnWidgets();
    }
}
