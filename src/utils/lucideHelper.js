import GLib from 'gi://GLib';

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
