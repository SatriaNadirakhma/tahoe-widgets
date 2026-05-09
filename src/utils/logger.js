export const LogLevel = Object.freeze({ DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 });
export class Logger {
    constructor(tag, level = LogLevel.INFO) { this._tag = tag; this._level = level; }
    debug(msg, ...a) { this._emit(LogLevel.DEBUG, 'DBG',   msg, a); }
    info (msg, ...a) { this._emit(LogLevel.INFO,  'INFO',  msg, a); }
    warn (msg, ...a) { this._emit(LogLevel.WARN,  'WARN',  msg, a); }
    error(msg, ...a) { this._emit(LogLevel.ERROR, 'ERROR', msg, a); }
    child(sub) { return new Logger(`${this._tag}:${sub}`, this._level); }
    setLevel(l) { this._level = l; }
    _emit(level, label, msg, args) {
        if (level < this._level) return;
        const p = `[TahoeWidgets:${this._tag}] ${label}: `;
        switch (level) {
            case LogLevel.DEBUG: case LogLevel.INFO:  console.log(p+msg,   ...args); break;
            case LogLevel.WARN:  console.warn(p+msg,  ...args); break;
            case LogLevel.ERROR: console.error(p+msg, ...args); break;
        }
    }
}
export const rootLogger = new Logger('Root');
