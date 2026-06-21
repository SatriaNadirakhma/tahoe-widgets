import St  from 'gi://St';
import Gio from 'gi://Gio';
import { getLucideIconPath } from './lucideHelper.js';

export function getLucideIcon(name, size) {
    const file  = Gio.File.new_for_path(getLucideIconPath(name));
    const gicon = new Gio.FileIcon({ file });
    return new St.Icon({ gicon, icon_size: size ?? 24 });
}
