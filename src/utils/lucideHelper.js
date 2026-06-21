import St  from 'gi://St';
import GLib from 'gi://GLib';
import Gio  from 'gi://Gio';

let _extensionPath = null;

export function setExtensionPath(path) {
    _extensionPath = path;
}

export function getExtensionPath() {
    return _extensionPath;
}

export function getLucideIconPath(name) {
    return GLib.build_filenamev([
        _extensionPath, 'icons', 'lucide', `${name}.svg`,
    ]);
}

export function getLucideIcon(name, size) {
    const file  = Gio.File.new_for_path(getLucideIconPath(name));
    const gicon = new Gio.FileIcon({ file });
    return new St.Icon({ gicon, icon_size: size ?? 24 });
}
