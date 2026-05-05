/**
 * Logger — thin wrapper around console.log that prefixes
 * all messages so they're easy to grep from journalctl.
 */
export class Logger {
    constructor(tag = 'TahoeWidgets') {
        this._tag = `[${tag}]`;
    }

    info(msg, ...args)  { console.log(`${this._tag} ${msg}`, ...args); }
    warn(msg, ...args)  { console.warn(`${this._tag} WARN: ${msg}`, ...args); }
    error(msg, ...args) { console.error(`${this._tag} ERROR: ${msg}`, ...args); }
    debug(msg, ...args) {
        // Gate debug logs behind environment variable to avoid log spam
        if (globalThis._tahoeDebug)
            console.log(`${this._tag} DBG: ${msg}`, ...args);
    }
}
