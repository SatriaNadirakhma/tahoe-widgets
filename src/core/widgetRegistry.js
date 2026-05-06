/**
 * WidgetRegistry — catalogue of every available widget type,
 * plus the map of currently-live instances.
 *
 * Flow:
 *   1. Extension calls registry.register(descriptor) for each widget class.
 *   2. On enable(), active IDs are loaded from StateManager.
 *   3. User adds a widget → registry.instantiate(id) → returns BaseWidget.
 *   4. User removes a widget → registry.destroy(id).
 *
 * A "descriptor" looks like:
 *   {
 *     id:          'clock',           // unique string key
 *     label:       'Clock',           // display name in picker
 *     description: 'Shows the time',  // one-liner
 *     icon:        '🕐',              // emoji or icon-name
 *     Cls:         ClockWidget,        // the widget class
 *     defaultSize: { width: 200, height: 110 },
 *   }
 */

import { Logger } from '../utils/logger.js';

export class WidgetRegistry {
    constructor(state) {
        this._state     = state;
        this._log       = new Logger('Registry');
        this._catalog   = new Map();   // id → descriptor
        this._instances = new Map();   // id → BaseWidget instance
    }

    /* ══ Catalog ══════════════════════════════════════════════════════ */

    register(descriptor) {
        const { id } = descriptor;
        if (!id) throw new Error('Widget descriptor must have an id');
        this._catalog.set(id, descriptor);
        this._log.debug(`Registered: ${id}`);
    }

    getCatalog() {
        return [...this._catalog.values()];
    }

    getDescriptor(id) {
        return this._catalog.get(id) ?? null;
    }

    /* ══ Instances ════════════════════════════════════════════════════ */

    /**
     * Instantiate a widget by id.
     * Throws if already active or id unknown.
     */
    instantiate(id, opts = {}) {
        if (this._instances.has(id))
            throw new Error(`Widget '${id}' is already active`);

        const desc = this._catalog.get(id);
        if (!desc)
            throw new Error(`Unknown widget id: '${id}'`);

        this._log.info(`Instantiating: ${id}`);

        const widget = new desc.Cls({
            ...opts,
            id,
            state:    this._state,
            registry: this,
        });

        this._instances.set(id, widget);
        this._state.addActiveWidget(id);
        return widget;
    }

    /**
     * Destroy and remove a widget instance by id.
     */
    destroyWidget(id) {
        const widget = this._instances.get(id);
        if (!widget) {
            this._log.warn(`destroyWidget: no instance for '${id}'`);
            return;
        }
        this._log.info(`Destroying: ${id}`);
        try { widget.destroy(); } catch (e) { this._log.error('destroy error', e); }
        this._instances.delete(id);
        this._state.removeActiveWidget(id);
    }

    getInstance(id) {
        return this._instances.get(id) ?? null;
    }

    getActiveInstances() {
        return [...this._instances.values()];
    }

    isActive(id) {
        return this._instances.has(id);
    }

    /* ══ Lifecycle ════════════════════════════════════════════════════ */

    destroyAll() {
        [...this._instances.keys()].forEach(id => this.destroyWidget(id));
    }
}
