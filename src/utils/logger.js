/**
 * Logger — structured, levelled logger for Tahoe Widgets.
 * All output is prefixed so `journalctl | grep TahoeWidgets` works perfectly.
 *
 * Usage:
 *   const log = new Logger('LayoutManager');
 *   log.info('Widget added', { id: 'clock' });
 *   log.error('Failed to fetch', err);
 */

export const LogLevel = Object.freeze({ DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 });

export class Logger {
    /** @param {string} tag  - module name shown in brackets */
    constructor(tag, level = LogLevel.INFO) {
        this._tag   = tag;
        this._level = level;
    }

    debug(msg, ...args) { this._emit(LogLevel.DEBUG, 'DBG',   msg, args); }
    info (msg, ...args) { this._emit(LogLevel.INFO,  'INFO',  msg, args); }
    warn (msg, ...args) { this._emit(LogLevel.WARN,  'WARN',  msg, args); }
    error(msg, ...args) { this._emit(LogLevel.ERROR, 'ERROR', msg, args); }

    /** Create a child logger with a sub-tag */
    child(subtag) { return new Logger(`${this._tag}:${subtag}`, this._level); }

    setLevel(level) { this._level = level; }

    _emit(level, label, msg, args) {
        if (level < this._level) return;
        const prefix = `[TahoeWidgets:${this._tag}] ${label}: `;
        const extra  = args.length ? args : [];
        switch (level) {
            case LogLevel.DEBUG:
            case LogLevel.INFO:  console.log(prefix + msg,  ...extra); break;
            case LogLevel.WARN:  console.warn(prefix + msg, ...extra); break;
            case LogLevel.ERROR: console.error(prefix + msg,...extra); break;
        }
    }
}

export const rootLogger = new Logger('Root');
