/**
 * WidgetRegistry v3.0
 *
 * Fix: destroyWidget called state.removeActiveWidget which fires
 *      GSettings 'changed' → extension._syncWidgets → destroyWidget again.
 *      Guard with _destroying Set to prevent double-destroy.
 */

import { Logger } from '../utils/logger.js';

export class WidgetRegistry {
    constructor(state) {
        this._state      = state;
        this._log        = new Logger('Registry');
        this._catalog    = new Map();
        this._instances  = new Map();
        this._destroying = new Set();  // ← re-entrancy guard
    }

    /* ══ Catalog ══════════════════════════════════════════════════════ */

    register(descriptor) {
        if (!descriptor.id) throw new Error('Widget descriptor must have an id');
        this._catalog.set(descriptor.id, descriptor);
        this._log.debug(`Registered: ${descriptor.id}`);
    }

    getCatalog()          { return [...this._catalog.values()]; }
    getDescriptor(id)     { return this._catalog.get(id) ?? null; }

    /* ══ Instances ════════════════════════════════════════════════════ */

    instantiate(id, opts = {}) {
        if (this._instances.has(id))
            throw new Error(`Widget '${id}' is already active`);

        const desc = this._catalog.get(id);
        if (!desc) throw new Error(`Unknown widget id: '${id}'`);

        this._log.info(`Instantiating: ${id}`);

        const widget = new desc.Cls({
            ...opts,
            id,
            state:    this._state,
            registry: this,
        });

        this._instances.set(id, widget);
        // Suppress GSettings echo — state change handled by extension._syncWidgets
        this._state.addActiveWidget(id);
        return widget;
    }

    destroyWidget(id) {
        // ── Guard: prevent re-entrant destroy ──────────────────────
        if (this._destroying.has(id)) {
            this._log.warn(`destroyWidget: already destroying '${id}', skipping`);
            return;
        }

        const widget = this._instances.get(id);
        if (!widget) {
            this._log.warn(`destroyWidget: no instance for '${id}'`);
            return;
        }

        this._destroying.add(id);
        try {
            this._log.info(`Destroying: ${id}`);
            widget.destroy();
            this._instances.delete(id);
            // removeActiveWidget modifies GSettings but StateManager._suppressNotify
            // ensures the 'changed' event is silenced during this write.
            this._state.removeActiveWidget(id);
        } catch (e) {
            this._log.error(`destroyWidget error for '${id}':`, e.message);
        } finally {
            this._destroying.delete(id);
        }
    }

    getInstance(id)          { return this._instances.get(id) ?? null; }
    getActiveInstances()     { return [...this._instances.values()]; }
    isActive(id)             { return this._instances.has(id); }

    destroyAll() {
        [...this._instances.keys()].forEach(id => {
            try { this.destroyWidget(id); } catch {}
        });
    }
}
