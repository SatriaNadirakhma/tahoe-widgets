# Tahoe Widgets

> macOS Tahoe-inspired glassmorphism desktop widgets for GNOME Shell on Fedora.

![GNOME Shell](https://img.shields.io/badge/GNOME%20Shell-45%2B-blue?logo=gnome)
![License](https://img.shields.io/badge/license-GPL--2.0--or--later-green)
![Fedora](https://img.shields.io/badge/Fedora-39%2B-blue?logo=fedora)

---

## Widgets

| Widget | Description | Refresh |
|--------|-------------|---------|
| **Clock** | Digital time + date, 12h/24h | 1 s |
| **Weather** | Temp, description, 5-hour forecast (Open-Meteo) | 10 min |
| **Calendar** | Current-month mini calendar, today highlighted | midnight |
| **World Clock** | Time for multiple timezones with UTC offset | 1 min |
| **Battery** | System battery + connected Bluetooth devices | 30 s |
| **Quick Status** | Wi-Fi SSID, Bluetooth, CPU %, RAM % | 5 s |

All widgets support **drag-and-drop**, **grid snapping**, and **position persistence**.

---

## Requirements

- Fedora 39+ (or any distro with GNOME Shell 45+)
- GNOME Shell 45, 46, 47, or 48
- `glib2` (for `glib-compile-schemas`)
- `gnome-extensions-app` (optional, for GUI management)

---

## Quick Install

```bash
git clone https://github.com/yourname/tahoe-widgets
cd tahoe-widgets
chmod +x dev.sh
./dev.sh install

# Wayland: log out and back in
# X11:     ./dev.sh restart
./dev.sh enable
```

---

## Updating

When the developer publishes an update to the repository, follow these steps to upgrade your local installation:

```bash
# 1. Pull the latest changes
cd tahoe-widgets
git pull

# 2. Re-install the extension (rsyncs new files + recompiles schemas)
./dev.sh install

# 3. Reload the extension to apply the update
./dev.sh reload
# Or, if you are on Wayland:
# Log out and back in
```

> **Note:** The `./dev.sh install` command uses `rsync -a --delete`, which ensures old files are removed and new ones are copied in place. Your widget positions and settings (stored in GSettings) are preserved across updates.

---

## Settings

Open **GNOME Extensions** app → Tahoe Widgets → ⚙️, or:

```bash
gnome-extensions prefs tahoe-widgets@gnome
```

---

---

# Development Guide

This section explains **incremental development** — from zero to full extension.
Each step has a goal, minimal working code, expected output, and verification method.

---

## Step 0 — Environment Setup

**Goal:** Ensure all tools are installed and your Fedora is ready.

```bash
# Fedora — install dev dependencies
sudo dnf install -y \
    gnome-shell-extension-tool \
    glib2-devel \
    gnome-extensions-app \
    git

# Verify GNOME Shell version (need 45+)
gnome-shell --version
# Expected: GNOME Shell 45.x / 46.x / 47.x / 48.x

# Verify glib tools
glib-compile-schemas --version
# Expected: GLib version string

# Enable extension dev mode (removes "unsafe" warning)
gsettings set org.gnome.shell disable-extension-version-validation true
```

### Wayland vs X11

On **Wayland** (default on Fedora 40+): you must **log out and back in** to reload the shell after installing/changing an extension.

On **X11**: you can use `Alt+F2 → r → Enter` or our `./dev.sh restart` script.

> **Tip:** During active development, run a nested GNOME session so you don't need to log out:
> ```bash
> dbus-run-session -- gnome-shell --nested --wayland &
> ```

---

## Step 1 — Hello World Extension

**Goal:** Create the bare minimum extension that loads without errors.

### File structure

```
~/.local/share/gnome-shell/extensions/tahoe-widgets@gnome/
├── metadata.json
└── extension.js
```

### `metadata.json`

```json
{
  "name": "Tahoe Widgets",
  "description": "Hello World",
  "uuid": "tahoe-widgets@gnome",
  "version": 1,
  "shell-version": ["45", "46", "47", "48"]
}
```

### `extension.js`

```javascript
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

export default class TahoeWidgets extends Extension {
    enable() {
        console.log('[TahoeWidgets] Hello from Tahoe Widgets!');
        Main.notify('Tahoe Widgets', 'Extension enabled ✓');
    }
    disable() {
        console.log('[TahoeWidgets] Disabled');
    }
}
```

### Install & test

```bash
UUID="tahoe-widgets@gnome"
EXT_DIR="${HOME}/.local/share/gnome-shell/extensions/${UUID}"
mkdir -p "${EXT_DIR}"
cp metadata.json extension.js "${EXT_DIR}/"

gnome-extensions enable "${UUID}"
# Wayland: log out → log in
# X11: Alt+F2 → r → Enter
```

### Verify

```bash
# You should see a notification pop up on screen.
# Also check logs:
journalctl -f /usr/bin/gnome-shell | grep TahoeWidgets
# Expected: [TahoeWidgets] Hello from Tahoe Widgets!
```

---

## Step 2 — Clock Widget (Proof of Concept)

**Goal:** Show a live clock label on the desktop.

### Add `stylesheet.css`

```css
.tahoe-widget {
    background-color: rgba(255,255,255,0.15);
    border: 1px solid rgba(255,255,255,0.30);
    border-radius: 16px;
    padding: 16px;
    box-shadow: 0 8px 24px rgba(0,0,0,0.30);
}
.tahoe-clock-time {
    font-size: 48px;
    font-weight: 100;
    color: rgba(255,255,255,0.95);
    font-family: "Cantarell", sans-serif;
}
.tahoe-clock-date {
    font-size: 13px;
    color: rgba(255,255,255,0.60);
    margin-top: 2px;
}
```

### Updated `extension.js`

```javascript
import St      from 'gi://St';
import Clutter from 'gi://Clutter';
import GLib    from 'gi://GLib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

export default class TahoeWidgets extends Extension {
    enable() {
        this._box = new St.BoxLayout({
            style_class: 'tahoe-widget',
            vertical: true,
            reactive: true,
        });

        this._timeLabel = new St.Label({
            text: '00:00',
            style_class: 'tahoe-clock-time',
        });
        this._dateLabel = new St.Label({
            text: '',
            style_class: 'tahoe-clock-date',
        });

        this._box.add_child(this._timeLabel);
        this._box.add_child(this._dateLabel);

        // Pin to desktop background layer
        Main.layoutManager._backgroundGroup.add_child(this._box);

        // Position: top-right corner
        const m = Main.layoutManager.primaryMonitor;
        this._box.set_position(m.x + m.width - 220, m.y + 40);

        // Tick every second
        this._timer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000, () => {
            this._tick();
            return GLib.SOURCE_CONTINUE;
        });
        this._tick();
    }

    _tick() {
        const now   = new Date();
        const h     = now.getHours() % 12 || 12;
        const m     = String(now.getMinutes()).padStart(2, '0');
        const ampm  = now.getHours() >= 12 ? 'PM' : 'AM';
        const days  = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
        const mons  = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
        this._timeLabel.set_text(`${h}:${m} ${ampm}`);
        this._dateLabel.set_text(`${days[now.getDay()]}, ${mons[now.getMonth()]} ${now.getDate()}`);
    }

    disable() {
        if (this._timer) { GLib.source_remove(this._timer); this._timer = null; }
        this._box?.destroy();
        this._box = null;
    }
}
```

### Verify

Reinstall, reload shell. You should see a glass-style clock in the top-right corner updating every second.

```bash
# Check for errors
journalctl -f /usr/bin/gnome-shell | grep -E 'TahoeWidgets|error|Error'
```

---

## Step 3 — Basic Layout + Spacing

**Goal:** Add multiple widgets in a column with consistent spacing.

Key technique: position widgets programmatically using `actor.height` after the first allocation.

```javascript
// After adding each widget, place it below the previous one:
let yOffset = 40;
const SPACING = 16;

widgets.forEach(widget => {
    const m = Main.layoutManager.primaryMonitor;
    widget.set_position(m.x + m.width - widget.width - 32, m.y + yOffset);
    // We use allocation signal to read actual height after first render
    widget.connect('notify::allocation', () => {
        yOffset += widget.height + SPACING;
    });
});
```

---

## Step 4 — Blur & Glassmorphism

**Goal:** Add real background blur using `Clutter.BlurEffect`.

```javascript
// Works on GNOME 43+ with GNOME Shell 44+
import Clutter from 'gi://Clutter';

function applyBlur(actor, sigma = 8) {
    try {
        const blur = new Clutter.BlurEffect({ sigma });
        actor.add_effect_with_name('blur', blur);
    } catch (e) {
        // GNOME version does not support BlurEffect — skip silently
        console.warn('[TahoeWidgets] BlurEffect unavailable:', e.message);
    }
}
```

> **Performance note:** `Clutter.BlurEffect` uses GPU-accelerated per-actor blur. It does **not** blur the wallpaper behind the actor — it blurs the actor's own content. For wallpaper-blurring (like macOS frosted glass), you need a third-party compositor (picom/Mutter patches). The semi-transparent background + drop shadow combination achieves a visually similar effect with no performance penalty.

---

## Step 5 — Adding More Widgets Incrementally

Each widget follows the same pattern:

1. Create a `St.BoxLayout` with `style_class: 'tahoe-widget'`
2. Add `St.Label` / `St.Icon` children
3. Start a `GLib.timeout_add` for data refresh
4. On `disable()`, remove the timeout and destroy the actor

Add one widget at a time and verify it loads before proceeding to the next.

```bash
# After each widget addition:
./dev.sh install && ./dev.sh restart   # X11
# or: log out → log in                 # Wayland
./dev.sh logs                           # watch for errors
```

---

## Step 6 — Settings Schema

**Goal:** Add GSettings for user configuration.

```bash
# After creating schemas/org.gnome.shell.extensions.tahoe-widgets.gschema.xml
glib-compile-schemas schemas/
# Then install and test:
gsettings --schemadir schemas/ get org.gnome.shell.extensions.tahoe-widgets blur-radius
```

---

## Step 7 — Drag and Drop

**Goal:** Make widgets repositionable.

Set `reactive: true` on the widget actor, then connect to `button-press-event`, `motion-event`, `button-release-event`. Store position in GSettings so it survives restarts. See `src/widgetContainer.js` in this repo for the full implementation.

---

## Step 8 — Debugging

### Common errors and fixes

| Error | Cause | Fix |
|-------|-------|-----|
| `Extension is not valid` | Syntax error in JS | Run `node --input-type=module < extension.js` locally |
| `could not load resource` | Wrong import path | Check capitalization, verify path with `ls` |
| `BlurEffect not found` | Old GNOME version | Wrap in try/catch, degrade gracefully |
| Widget invisible | Wrong layer / z-order | Use `_backgroundGroup` not `uiGroup` |
| Settings not loading | Schema not compiled | Run `glib-compile-schemas schemas/` |

### Debug workflow

```bash
# 1. Watch logs live
journalctl -f /usr/bin/gnome-shell | grep -i 'tahoe\|error\|gjs'

# 2. Enable GJS debug output
export G_MESSAGES_DEBUG=all
journalctl -f /usr/bin/gnome-shell

# 3. Run GNOME Shell nested (Wayland) for safe testing
dbus-run-session -- gnome-shell --nested --wayland &

# 4. Check extension status
gnome-extensions info tahoe-widgets@gnome

# 5. Force disable if shell becomes unresponsive (SSH from another terminal)
DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/$(id -u)/bus \
    gnome-extensions disable tahoe-widgets@gnome
```

---

## Step 9 — GNOME Version Compatibility

### Version matrix

| GNOME Shell | Fedora | Key API changes |
|-------------|--------|-----------------|
| 45          | 39     | ESM imports required (`import … from 'gi://…'`) |
| 46          | 40     | `ExtensionPreferences` in `prefs.js` |
| 47          | 41     | Adw 1.5 row types |
| 48          | 42     | `Clutter.BlurEffect` improvements |

### Compatibility tips

```javascript
// 1. Always guard optional APIs
try {
    const blur = new Clutter.BlurEffect({ sigma: 8 });
    actor.add_effect(blur);
} catch { /* skip */ }

// 2. Check shell version at runtime
import * as Config from 'resource:///org/gnome/shell/misc/config.js';
const [major] = Config.PACKAGE_VERSION.split('.').map(Number);
if (major >= 46) { /* use new API */ }

// 3. List all supported versions in metadata.json shell-version array
// Update this list whenever you verify on a new GNOME version.
```

---

## Project Structure

```
tahoe-widgets@gnome/
├── extension.js          # Entry point (enable/disable)
├── prefs.js              # Preferences window
├── metadata.json         # Extension metadata + version compat
├── stylesheet.css        # All widget CSS (glassmorphism tokens)
├── dev.sh                # Developer helper script
├── schemas/
│   └── org.gnome.shell.extensions.tahoe-widgets.gschema.xml
└── src/
    ├── widgetContainer.js     # Full-screen drag-and-drop layer
    ├── widgets/
    │   ├── baseWidget.js      # Abstract base (blur, refresh timer)
    │   ├── clockWidget.js
    │   ├── weatherWidget.js
    │   ├── calendarWidget.js
    │   ├── worldClockWidget.js
    │   ├── batteryWidget.js
    │   └── quickStatusWidget.js
    └── utils/
        ├── stateManager.js    # GSettings wrapper + position persistence
        ├── logger.js          # Prefixed console logger
        └── weatherFetcher.js  # Open-Meteo HTTP client
```

---

## License2.1

GNU General Public License v2.0 or later.  
See [LICENSE](LICENSE) for full text.

This project is inspired by macOS widget aesthetics but contains no Apple assets, trademarks, or code.
