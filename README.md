# Tahoe Widgets

macOS Tahoe-inspired glassmorphism desktop widgets for GNOME Shell.

![GNOME Shell](https://img.shields.io/badge/GNOME%20Shell-45%E2%80%9350-blue?logo=gnome)
![License](https://img.shields.io/badge/license-GPL--2.0--or--later-green)

---

## Widgets

| Widget         | Description                            | Size          |
| -------------- | -------------------------------------- | ------------- |
| Clock          | Cairo-drawn analog clock face          | 155 x 155     |
| Weather        | Conditions, temperature, 6-hr forecast | min 290 wide  |
| Calendar (1x1) | Day name, date, month, year            | 155 x 155     |
| Calendar (2x1) | Today panel + mini monthly grid        | 329 x 220     |
| World Clock    | Up to 4 timezone analog mini-clocks    | 329 x 155     |
| Battery        | UPower battery meter + progress bar    | min 190 wide  |
| Quick Status   | Wi-Fi, Bluetooth, CPU, RAM usage       | min 200 wide  |

All widgets support drag-and-drop, grid snapping, and position persistence
across restarts via GSettings.

---

## Language & Tools

| What               | Detail                                                   |
| ------------------ | -------------------------------------------------------- |
| **Language**       | GJS (GNOME JavaScript) — ES modules, no CommonJS         |
| **Toolkit**        | St, Clutter, Pango, Cairo, GLib, Gio, Soup              |
| **Settings**       | GSettings / dconf (17 keys, compiled from gschema.xml)   |
| **Preferences UI** | GTK 4, libadwaita (Adw.PreferencesWindow)                |
| **Font**           | Inter variable font (bundled in `fonts/`)                |
| **Icons**          | 31 Lucide SVG icons (bundled in `icons/lucide/`)         |
| **Weather API**    | Open-Meteo (free, no API key)                            |
| **Data bus**       | D-Bus (UPower, NetworkManager), /proc, /sys              |

Build dependencies on Fedora:

```bash
sudo dnf install -y gnome-shell glib2-devel git
```

---

## Installation

```bash
git clone https://github.com/yourname/tahoe-widgets
cd tahoe-widgets
chmod +x dev.sh
./dev.sh install
./dev.sh enable
```

On **Wayland** (Fedora 40+): log out and back in after installing.
On **X11**: `./dev.sh restart` or press `Alt+F2`, type `r`, press Enter.

### Update

```bash
cd tahoe-widgets
git pull
./dev.sh install
./dev.sh reload          # X11  — or log out/in on Wayland
```

Settings are preserved across updates (stored in dconf).

---

## Project Structure

```
tahoe-widgets@gnome/
├── extension.js                     # enable() / disable() entry point
├── prefs.js                         # Adw.PreferencesWindow (7 pages)
├── stylesheet.css                   # All widget CSS + theming layers
├── metadata.json                    # UUID, shell-version, schema
├── dev.sh                           # Developer CLI (install, reload, logs)
├── schemas/
│   └── org.gnome.shell.extensions.tahoe-widgets.gschema.xml
├── fonts/
│   ├── Inter-VariableFont_opsz,wght.ttf
│   └── Inter-Italic-VariableFont_opsz,wght.ttf
├── icons/
│   └── lucide/                      # 31 SVG icons (weather, system, UI)
└── src/
    ├── core/
    │   ├── stateManager.js           # GSettings + pub/sub event bus
    │   ├── widgetRegistry.js         # Widget catalog + instance factory
    │   ├── layoutManager.js          # Canvas, drag-and-drop, auto-place
    │   └── dataManager.js            # Weather fetcher (Open-Meteo)
    ├── widgets/
    │   ├── baseWidget.js             # Abstract base (actor, blur, menu)
    │   ├── clockWidget.js            # Analog clock (Cairo)
    │   ├── weatherWidget.js          # Weather display + forecast
    │   ├── calendarWidget.js         # Calendar (1x1) + CalendarDouble (2x1)
    │   └── otherWidgets.js           # WorldClock, Battery, QuickStatus
    ├── ui/
    │   ├── panelButton.js            # Top-bar button + right-click menu
    │   └── widgetPicker.js           # "Add Widget" slide-out panel
    └── utils/
        ├── lucideHelper.js           # SVG -> St.Icon loader
        ├── fontLoader.js             # @font-face injection into St.Theme
        └── logger.js                 # Tagged console logger
```

---

## License

GNU General Public License v2.0 or later. See [LICENSE](LICENSE).

This project is inspired by macOS widget aesthetics but contains no Apple
assets, trademarks, or code.
