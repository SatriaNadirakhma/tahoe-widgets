# Tahoe Widgets — Design Document

macOS Tahoe-inspired glassmorphism desktop widgets for GNOME Shell 45–50.

---

## 1. Project Overview

Tahoe Widgets is a GNOME Shell extension that renders persistent desktop widgets
(clock, weather, calendar, world clock, battery, system status) with a
frosted-glass visual style. Widgets are **draggable**, **auto-saved**, and
managed through a right-side slide-out panel.

| Attribute        | Value                                          |
| ---------------- | ---------------------------------------------- |
| **UUID**         | `tahoe-widgets@gnome`                          |
| **Shell**        | GNOME 45, 46, 47, 48, 49, 50                   |
| **License**      | GPL-2.0-or-later                               |
| **Language**     | GJS (GNOME JavaScript) — ES modules           |
| **Toolkit**      | St, Clutter, Gio, GLib, Pango, Cairo, Gtk      |
| **Data sources** | Open-Meteo API, UPower D-Bus, NetworkManager, /proc |
| **Icons**        | Lucide SVG (31 bundled icons)                  |
| **Font**         | Inter variable font (bundled + theme-loaded)   |
| **Settings**     | GSettings (dconf) — 17 keys                    |

---

## 2. Directory Structure

```
tahoe-widgets@gnome/
├── extension.js             # Entry point — enable/disable lifecycle
├── prefs.js                 # Adw.PreferencesWindow — 7 settings pages
├── stylesheet.css           # All widget CSS — glassmorphism, typography, overrides
├── metadata.json            # Extension metadata (uuid, shell-version, schema)
├── dev.sh                   # Developer CLI (install, reload, logs, restart)
├── schemas/
│   └── org.gnome.shell.extensions.tahoe-widgets.gschema.xml
├── fonts/
│   ├── Inter-VariableFont_opsz,wght.ttf
│   └── Inter-Italic-VariableFont_opsz,wght.ttf
├── icons/
│   └── lucide/              # 31 SVG icons (weather, system, UI chrome)
└── src/
    ├── core/
    │   ├── stateManager.js   # GSettings wrapper + pub/sub event bus
    │   ├── widgetRegistry.js # Widget descriptor catalog + instance factory
    │   ├── layoutManager.js  # Canvas, drag-and-drop, auto-placement
    │   └── dataManager.js    # Weather fetcher (Open-Meteo) + WMO mapping
    ├── widgets/
    │   ├── baseWidget.js     # Abstract base (actor, blur, menu, styling)
    │   ├── clockWidget.js    # Cairo-drawn analog clock (155×155)
    │   ├── weatherWidget.js  # Weather display + 6-hr forecast
    │   ├── calendarWidget.js # CalendarWidget (1×1) + CalendarDoubleWidget (2×1)
    │   └── otherWidgets.js   # WorldClock, Battery, QuickStatus
    ├── ui/
    │   ├── panelButton.js    # Top-bar button + right-click menu
    │   └── widgetPicker.js   # "Add Widget" slide-out overlay
    └── utils/
        ├── lucideHelper.js   # SVG → St.Icon loader
        ├── fontLoader.js     # @font-face injection into St.Theme
        └── logger.js         # Tagged console logger with level filtering
```

---

## 3. Architecture Overview

### 3.1 Extension Lifecycle

```
enable()
  ├── setExtensionPath(this.path)         // singleton for asset loading
  ├── registerFonts(this.path)            // inject @font-face into St.Theme
  ├── new StateManager(gSettings)         // GSettings wrapper
  ├── new WidgetRegistry(state)           // descriptor catalog
  ├── new LayoutManager(state)            // canvas + drag-and-drop
  ├── new DataManager(state)              // weather data hub
  ├── for each WIDGET_CATALOG → registry.register(desc)
  ├── _wireRegistryToLayout()             // patch instantiate/destroyWidget
  ├── _syncWidgets(savedIds)              // restore persisted widgets
  ├── new WidgetPicker(registry, state)   // "Add Widget" panel
  ├── new TahoePanelButton(picker, ...)   // top-bar button
  ├── subscribe('settings:active-widgets')→ react to GSettings
  ├── connect(overview showing/hidden)    → hide/show canvas
  └── connect(screenShield lock/unlock)   → hide/show on lock screen

disable()
  └── _safeDisable()
       ├── disconnect all signals
       ├── destroy panel button, picker
       ├── registry.destroyAllSilent()    // preserve active-widgets list
       ├── destroy layout, data, state
       └── unregisterFonts()
```

### 3.2 Widget Instantiation

```
registry.instantiate(id, { data })
  ├── lookup descriptor in catalog
  ├── new WidgetClass({ id, state, registry, data })
  │    └── BaseWidget constructor
  │         ├── create actor (St.BoxLayout + .tahoe-widget CSS)
  │         ├── _applyPanelStyle()    // background + corner radius
  │         ├── _applyBlur()          // Clutter.BlurEffect (transparent only)
  │         ├── add drag handle widget
  │         ├── add _content box
  │         ├── _buildContextMenu()   // right-click menu
  │         └── subscribe to settings changes
  │              └── this.build()     // ← subclass populates content
  ├── state.addActiveWidget(id)       // persist to GSettings
  └── layout.addWidget(widget)        // add to canvas, position
```

### 3.3 Data Flow

```
                    ┌─────────────┐
                    │  GSettings   │  (dconf)
                    │  (17 keys)   │
                    └──────┬───────┘
                           │
                    ┌──────▼───────┐
                    │ StateManager │  pub/sub event bus
                    │              │  "settings:*" events
                    └──┬──┬───┬───┘
                       │  │   │
          ┌────────────┘  │   └──────────────┐
          │               │                  │
   ┌──────▼──────┐  ┌─────▼──────┐   ┌──────▼───────┐
   │  Registry   │  │  Layout    │   │  DataManager │
   │  catalog    │  │  canvas    │   │  Open-Meteo  │
   │  instances  │  │  drag/drop │   │  Soup HTTP   │
   └──────┬──────┘  └─────┬──────┘   └──────┬───────┘
          │               │                  │
          └───────┬───────┘                  │
                  │                   onWeather()
          ┌───────▼───────┐                  │
          │ Widget Actors │◄─────────────────┘
          │ (on Canvas)   │
          └───────────────┘
```

### 3.4 Re-entrancy Guards

Multiple guards prevent recursive call loops:

| Guard | Location | Mechanism |
|-------|----------|-----------|
| `_syncing` flag | `extension.js` | Prevents `_syncWidgets` re-entry when `destroyWidget` modifies GSettings |
| `_suppressNotify` | `stateManager.js` | Blocks `'changed'` signal echo during programmatic `set_strv` |
| `_destroying` Set | `widgetRegistry.js` | Prevents double-destroy of same widget |
| `_drag` null check | `layoutManager.js` | Skips auto-place idle callback if user already started dragging |

---

## 4. Core Modules

### 4.1 StateManager (`src/core/stateManager.js`)

Central GSettings wrapper + publish/subscribe event bus.

```
StateManager
├── Widget State Map     { id → { x, y, visible, width, height } }
│   ├── getWidgetState(id)       // deep-clone
│   ├── setWidgetState(id, partial)  // merge, debounce save (300ms)
│   └── deleteWidgetState(id)
├── Active Widget List   GSettings 'active-widgets' (string array)
│   ├── getActiveWidgets()
│   ├── setActiveWidgets(ids)    // with suppressNotify guard
│   ├── addActiveWidget(id)
│   └── removeActiveWidget(id)
├── Typed Getters/Setters  (blurRadius, panelOpacity, cornerRadius, …)
├── resetAll()             // resets all 17 keys to defaults
├── subscribe(event, fn)   // returns unsubscribe function
├── destroy()              // flush save, disconnect signal
└── ★ Notify escape hatch:
    _notify(event, data) dispatches to listeners; '*' wildcard supported
```

**Design decision — Widget State as JSON blob:**
Widget positions are stored in a single `widget-states` GSettings key as a
JSON string. A 300ms debounce timer batches writes. This avoids 1 key per
widget (which would require schema changes when adding/removing widget types).

### 4.2 WidgetRegistry (`src/core/widgetRegistry.js`)

Widget descriptor catalog + instance manager.

```
WidgetRegistry
├── Catalog  Map<id, { id, label, description, icon, Cls, defaults? }>
│   └── register(descriptor)
├── Instances  Map<id, WidgetInstance>
│   ├── instantiate(id, opts)    // construct, addActiveWidget
│   ├── destroyWidget(id, opts)  // destroy with re-entrancy guard
│   ├── getInstance(id)
│   ├── getActiveInstances()
│   └── isActive(id)
├── destroyAll()          // destroys all, touches GSettings
└── destroyAllSilent()    // destroys all, preserves active-widgets list
                          // (used on disable / suspend to survive restart)
```

**Design decision — Silent destroy:**
`destroyAllSilent()` passes `silent:true` to `destroyWidget()`, which skips
`state.removeActiveWidget()`. This preserves the active-widgets GSettings list
when the extension disables (lock screen, shell restart), so widgets restore
on next enable.

### 4.3 LayoutManager (`src/core/layoutManager.js`)

Desktop canvas, drag-and-drop, auto-placement, edit mode.

```
LayoutManager
├── Canvas  St.Widget + Clutter.FixedLayout, sized to primary monitor
│   └── placed in Main.layoutManager._backgroundGroup (above wallpaper, below windows)
├── Widget Map  Map<id, {widget, actor}>
│   ├── addWidget(widget)       // restore position or auto-place
│   └── removeWidget(id)        // clean up pending timers, listeners
├── show() / hide()             // toggle canvas visibility
├── setEditMode(enabled)        // toggle .tahoe-edit-mode CSS + drag handles
├── Drag & Drop
│   └── global.stage 'captured-event'  → handles BUTTON_PRESS / MOTION / RELEASE
│       ├── Snap to grid (if enabled)
│       ├── Safe-area clamping
│       ├── Remove blur during drag (performance)
│       ├── Re-apply blur on release
│       ├── Skip drag on interactive children (St.Button, St.Entry)
│       └── Persist position via stateManager
├── Auto-Placement
│   ├── Stack widgets vertically at left margin
│   ├── Uses GLib.idle_add to wait for natural size allocation
│   ├── Skip if user started dragging (actor._tahoeAutoPlace flag)
│   └── Wrap to top if overflows safe area
├── _safeArea()     → { x, y, w, h } (monitor - top margin - dock margin)
└── _onMonitorsChanged()   // reposition canvas, clamp all widgets
```

**Design decision — captured-event pattern:**
GNOME 45+ changed Clutter's implicit pointer grab behavior. The previous
approach (`captured-event` → stop press → stage motion/release listeners)
was unreliable because stage-level signals aren't delivered without a grab.
The current implementation handles all three event types inside a single
`captured-event` handler, which fires unconditionally during the capture
phase of the event pipeline.

### 4.4 DataManager (`src/core/dataManager.js`)

Central data hub — currently focused on weather.

```
DataManager
├── HTTP  Soup.Session (15s timeout)
│   └── _get(url) → Promise<JSON>
├── Weather
│   ├── fetchWeatherNow()         // full pipeline: geolocate → fetch → normalize
│   ├── _startWeatherPoller()     // recurring timer (based on refresh-minutes)
│   ├── _geolocate()              // Geoclue → IP geolocation fallback
│   ├── _geocodeCity(city)        // Open-Meteo Geocoding API
│   ├── _fetchWeatherCoords({lat,lon,name}, unit)   // Open-Meteo Forecast API
│   └── _normaliseWeather(raw, location, sym)       // WMO code → structured data
├── Pub/Sub
│   ├── getWeather()       // cached data
│   ├── onWeather(fn)      // subscribe → returns unsubscribe
│   └── _notify(key, data)
├── WMO Code Map  code → [lucideIconName, description]
└── destroy()       // stop pollers, clear session
```

**Design decision — WMO code mapping:**
Open-Meteo returns numeric WMO weather codes. The extension maps these to
Lucide SVG icon names with weather-appropriate colors (sun→yellow, rain→blue,
snow→light blue, etc.) defined in `weatherWidget.js`.

---

## 5. Widget Architecture

### 5.1 Widget Catalog

Seven widget types are registered at startup:

| Widget ID          | Class                    | Size        | Description                     |
| ------------------ | ------------------------ | ----------- | ------------------------------- |
| `clock`            | `ClockWidget`           | 155 × 155   | Analog clock face (Cairo)       |
| `weather`          | `WeatherWidget`         | ≥ 290 wide  | Conditions + 6-hr forecast      |
| `calendar`         | `CalendarWidget`        | 155 × 155   | Today: date, day & month         |
| `calendar-double`  | `CalendarDoubleWidget`  | 329 × 220   | Today + mini monthly calendar   |
| `worldClock`       | `WorldClockWidget`      | 329 × 155   | Up to 4 timezone mini-clocks    |
| `battery`          | `BatteryWidget`         | ≥ 190 wide  | Battery percentage + devices    |
| `quickStatus`      | `QuickStatusWidget`     | ≥ 200 wide  | Wi-Fi, Bluetooth, CPU, RAM      |

### 5.2 BaseWidget (`src/widgets/baseWidget.js`)

Abstract base class. Every widget extends this.

```
BaseWidget
├── actor           St.BoxLayout (.tahoe-widget) — the visible widget panel
├── _content        St.BoxLayout — content area (subclass populates)
├── _dragHandle     St.Widget (.tahoe-drag-handle) — visible in edit mode
├── _menu           PopupMenu — right-click context menu
├── _state          StateManager reference
├── _registry       WidgetRegistry reference
├── _data           DataManager reference (optional)
├── _timers         Set<timerId> — registered GLib timeouts
├── _unsubs         Array<fn> — settings change unsubscribe callbacks
├── _log            Logger with tag "Widget:{id}"
│
├── build()                  // override point — subclass builds UI here
├── onEditMode(enabled)     // show/hide drag handle
│
├── startTimer(ms, fn, immediate)    // try/catch wrapper + auto-register
├── stopTimer(id)                    // remove from registry
│
├── showLoading(message)    // clear content, show loading text
├── showError(message)      // clear content, show error icon + message
│
├── _applyPanelStyle()      // apply background mode (transparent/auto/light/dark)
│   └── _resolveSystemColorScheme()  // read org.gnome.desktop.interface
├── _applyBlur()             // Clutter.BlurEffect (transparent mode only)
├── _buildContextMenu()      // "Remove Widget" + "Widget Settings..."
│
└── destroy()                // clear timers, subscriptions, menu, actor
```

**Design decision — Blur during drag:**
`Clutter.BlurEffect` causes significant rendering lag during drag operations.
The drag handler temporarily removes the blur effect on drag start, stores a
reapply callback on `actor._tahoeReapplyBlur`, and re-executes it on drag end.

### 5.3 Widget-specific Designs

#### ClockWidget
- Cairo-drawn analog clock on `St.DrawingArea`
- Face: white filled circle (`rgba(1,1,1,0.88)`)
- Numbers 1-12: `PangoCairo` with Inter Semi-Bold 9 (fallback: Cantarell)
- Hands: hour (50% radius), minute (73%), second (orange, 78%)
- Center dot: dark outer + orange inner
- 1-second repaint timer via `GLib.timeout_add`

#### WeatherWidget
- `WMO_LUCIDE` map: WMO code → `{icon, color}` for condition-appropriate colors
- Icons loaded as `St.Icon` via `getLucideIcon(name, size)`
- Layout: top row (location + icon), middle row (temp + details), forecast row
- Forecast: 6 hourly cells with time, weather icon, temperature
- Error state: cloud icon + message + retry button

#### CalendarWidget (1×1)
- Centered column: day name, large date (60px Inter Light), month + year
- Midnight rollover: `setTimeout` to next midnight, then re-schedule

#### CalendarDoubleWidget (2×1)
- Two-panel layout: Today panel (left) + Mini calendar (right)
- Mini calendar: `Clutter.GridLayout` 7-column, Su-Sa headers
- Highlight: today cell uses `.tahoe-cal-today` (white bg, dark text)
- Other-month days: `.tahoe-cal-other` (faded)
- Navigation: `<` `>` buttons shift by ±1 month

#### WorldClockWidget
- Cairo-drawn multi-clock on `St.DrawingArea`
- Up to 4 timezones (from GSettings `world-clock-zones`)
- Daytime face: white, Nighttime: dark (`rgba(0.17,0.16,0.17,0.92)`)
- Hand colors adapt: dark hands on white face, white hands on dark face
- Labels: city name + UTC offset using `PangoCairo` + `Intl.DateTimeFormat`
- 1-second repaint timer

#### BatteryWidget
- `UPower` D-Bus: `DisplayDevice` → enumerate for internal battery (Type=2)
- Real-time updates: D-Bus signal subscriptions (`PropertiesChanged`, `DeviceAdded`, `DeviceRemoved`)
- 30-second polling timer as fallback
- Adaptive icon: charging → `battery-charging`, low → `battery-warning`, normal → `battery-full`
- Colored progress bar: red ≤20%, green charging, white normal

#### QuickStatusWidget
- 4 status rows refreshed every 5 seconds
- Wi-Fi: `NetworkManager` D-Bus → `ActiveConnections` → `Connection.Active` Id
- Bluetooth: `/sys/class/rfkill/*/soft` file read
- CPU: `/proc/stat` delta sampling (250ms interval)
- Memory: `/proc/meminfo` parsing (used = total - free - buffers - cached)
- All four queries wrapped in `Promise.allSettled` for resilience

---

## 6. UI Chrome

### 6.1 PanelButton (`src/ui/panelButton.js`)

Top-bar button using `GObject.registerClass` (required for GNOME 49+).

```
TahoePanelButton  (PanelMenu.Button)
├── Left-click  → toggle() WidgetPicker
├── Right-click → PopupMenu
│   ├── "Edit Mode" toggle  → layout.setEditMode(state)
│   ├── "Add Widget…"       → picker.show()
│   └── "Settings…"         → openPreferences()
└── Icon: waves.svg (Lucide)
```

### 6.2 WidgetPicker (`src/ui/widgetPicker.js`)

"Add Widget" slide-out panel.

```
WidgetPicker
├── Scrim  full-screen semi-transparent overlay
├── Panel  320px wide, positioned right side below top bar
│   ├── Header: "Add Widget" + close (x.svg)
│   ├── Scrollable list: catalog cards
│   │   └── Each card: icon + label + description + Add/Remove button
│   └── Footer: "Reset All to Defaults" danger button
├── Animation: ease() translation_x (slide in/out), opacity fade
├── Chrome: Main.layoutManager.addChrome() with affectsStruts: false
└── Reset: state.resetAll() + registry.destroyAll() + hide()
```

---

## 7. Assets & Theming

### 7.1 Icon System

All emoji/Unicode symbols have been replaced with **Lucide SVG icons** (31 icons
bundled in `icons/lucide/`). Icons are loaded via:

```
lucideHelper.js
├── setExtensionPath(path)         // called during enable()
└── getLucideIcon(name, size)      // returns St.Icon backed by Gio.FileIcon
```

The SVG files use `stroke="currentColor"`, allowing CSS `color` property to
control fill color. Weather condition icons use explicit per-condition colors
via inline `style`; utility icons (battery, status, UI chrome) use CSS classes
with light/dark mode overrides.

### 7.2 Font System

Inter variable font is bundled in `fonts/`. During `enable()`, `fontLoader.js`:
1. Checks that the font file exists
2. Generates `@font-face` CSS rules (normal + italic, weight 100–900)
3. Writes CSS to `/tmp/tahoe-inter-fonts.css`
4. Loads stylesheet into St.Theme via `theme.load_stylesheet()`

All CSS text classes reference `"Inter", "Cantarell", "Noto Sans"` as the
font-family stack. PangoCairo in clock widgets uses `Pango.FontDescription`
with `"Inter Semi-Bold 9"` / `"Cantarell"` fallback.

### 7.3 CSS Architecture

Three-layer styling system:

| Layer | Selector | Purpose |
|-------|----------|---------|
| **Base** | `.tahoe-widget` | Glassmorphism (rgba bg, border, border-radius), 18px/20px padding |
| **Background modes** | `.tahoe-bg-light`, `.tahoe-bg-dark` | Solid surface (light = near-white, dark = near-black), full text-color overrides |
| **Widget-specific** | `.tahoe-clock`, `.tahoe-weather`, etc. | Size constraints, typography, spacing |

Text colors adapt to background mode via descendant selectors:
- **Dark/Transparent** (default): white text at varying opacity levels (0.96, 0.88, 0.65, 0.48)
- **Light mode** (`.tahoe-bg-light`): dark text at corresponding opacity levels (0.94, 0.84, 0.58, 0.44)

The `auto` background mode reads `org.gnome.desktop.interface color-scheme`
and resolves to either light or dark at widget construction time (and whenever
the setting changes).

### 7.4 Sizing Grid

Widgets follow a macOS-style grid:

```
Grid unit: ~77.5 px  (derived from 155 / 2)

WIDGET_SMALL   = 155 × 155  (2×2 grid)   — Clock, Calendar 1×1
WIDGET_MEDIUM  = 329 × 155  (4×2 grid)   — World Clock, Calendar 2×1
CALENDAR_MEDIUM = 329 × 220  (4×2.8)     — Calendar Double
```

---

## 8. Settings (GSettings)

### 8.1 Schema Overview

17 keys in `org.gnome.shell.extensions.tahoe-widgets`, organized by category:

| Category | Keys | Types |
|----------|------|-------|
| **Registry** | `active-widgets`, `widget-states` | string[], string (JSON) |
| **Visual** | `blur-radius`, `panel-opacity`, `corner-radius`, `widget-spacing`, `color-scheme`, `background-mode` | int, double, int, int, string, string |
| **Layout** | `snap-to-grid`, `grid-size`, `top-bar-margin`, `dock-margin` | bool, int, int, int |
| **Clock** | `clock-format`, `clock-show-seconds` | string, bool |
| **Weather** | `weather-location`, `weather-unit`, `weather-refresh-minutes` | string, string, int |
| **World Clock** | `world-clock-zones` | string[] |
| **Onboarding** | `first-run` | bool |

### 8.2 Key Design Decisions

- **`widget-states` as JSON blob**: A single GSettings key stores all widget
  positions as `{"id": {"x": n, "y": n, ...}}`. Debounced save (300ms) prevents
  write storms during drag. This avoids schema changes when adding widget types.

- **`active-widgets` as string[]**: List of active widget IDs. The extension
  watches this key for changes and syncs the canvas accordingly. During disable,
  the list is preserved so widgets restore after shell restart or suspend.

- **`background-mode` enum**: `transparent` (glassmorphism), `auto` (follow
  system color-scheme), `light` (solid light), `dark` (solid dark). The `auto`
  value reads `org.gnome.desktop.interface color-scheme` at runtime.

---

## 9. Preferences UI

### 9.1 Pages

```
prefs.js  (Adw.PreferencesWindow, 680×760 default)
├── Appearance    Background Style, Blur, Corner Radius, Spacing, Opacity
├── Layout        Snap to Grid, Grid Size, Top Bar Margin, Dock Margin
├── Clock         Format (12h/24h), Show Seconds toggle
├── Weather       City name, Unit (°C/°F), Refresh interval
├── World Clock   Timezone list (editable text view)
├── Widgets       Enable/disable toggle for each widget type + Reset All
└── About         Version, Source link, License
```

### 9.2 Widget Controls

```
_row()       → Gtk.Adjustment          → Adw.SpinRow / Gtk.Scale
_switchRow() → Adw.SwitchRow            → state toggle
_entryRow()  → Adw.EntryRow             → show-apply-button
_comboRow()  → Gtk.StringList           → Adw.ComboRow
```

All controls connect to GSettings immediately (`notify::value` / `notify::active` /
`notify::selected` / `apply` signals), so changes take effect without restart.

---

## 10. Data Sources

| Widget | Source | Protocol | Refresh |
|--------|--------|----------|---------|
| Weather | Open-Meteo API + Geocoding API | HTTPS | Configurable (5–120 min, default 15) |
| Battery | UPower D-Bus (`org.freedesktop.UPower`) | D-Bus | 30s poll + real-time signals |
| Wi-Fi | NetworkManager D-Bus | D-Bus | 5s poll |
| Bluetooth | `/sys/class/rfkill/*/soft` | Filesystem | 5s poll |
| CPU | `/proc/stat` (delta sampling) | Filesystem | 5s poll (250ms sample interval) |
| Memory | `/proc/meminfo` | Filesystem | 5s poll |
| Location | Geoclue → ip-api.com fallback | D-Bus + HTTPS | Per-request |

---

## 11. Platform Compatibility Notes

- **GNOME 45–50**: Uses ESM `import` throughout. No CommonJS `imports.*`.
- **GNOME 49+**: `GObject.registerClass` required for `PanelMenu.Button` subclass.
- **GNOME 48+**: `global.screen_width/height` deprecated → uses `Main.layoutManager.primaryMonitor`.
- **Clutter implicit grab**: The `captured-event` handler pattern avoids the grab
  issue introduced in GNOME 45 where stage-level motion/release signals aren't
  reliably delivered without an implicit pointer grab.
- **Clutter.BlurEffect**: Wrapped in try/catch for environments where it's unavailable.
- **Layer ordering**: Canvas added to `Main.layoutManager._backgroundGroup` (above
  wallpaper, below application windows). Fallback to `Main.uiGroup` if that's unavailable.

---

## 12. Error Handling Strategy

- All GSettings writes are wrapped in try/catch
- All GLib timeouts have try/catch wrappers to prevent silent failures
- `Promise.allSettled` for multi-source data (QuickStatus)
- `Geoclue` has IP geolocation fallback
- D-Bus calls have timeouts (5000ms)
- Weather API has 15-second HTTP timeout
- Widget instantiation failures remove the widget from GSettings (`_syncWidgets`)
- `enable()` wraps entire init in try/catch with `_safeDisable()` on failure
- Logging via tagged `Logger` with level filtering for all modules

---

## 13. Development Workflow

The `dev.sh` script provides a CLI for common tasks:

```
./dev.sh install       # rsync to extensions dir, compile schemas, clear CSS cache
./dev.sh enable         # gnome-extensions enable
./dev.sh disable        # gnome-extensions disable
./dev.sh reload         # disable + Try ReloadExtension via busctl
./dev.sh restart        # X11: Meta.restart() via gdbus
./dev.sh dev            # install + reload/restart (autodetect display server)
./dev.sh logs           # journalctl filter for tahoe/JS errors
./dev.sh clean          # remove extension from extensions dir
./dev.sh status         # gnome-extensions info
./dev.sh schemas        # compile schemas only
```

**CSS cache note:** GNOME Shell caches CSS. After changing `stylesheet.css`,
run `rm -rf ~/.cache/gnome-shell/` or use the `reload`/`restart` commands
to clear the cache.

---

## 14. File Manifest

```
 31  icons/lucide/*.svg      (31 SVG icons, 7.7 KB total)
  2  fonts/*.ttf             (Inter variable font, ~1.8 MB)
  1  schemas/*.gschema.xml   (GSettings schema, 137 lines)
  1  extension.js             (Entry point, 248 lines)
  1  prefs.js                 (Preferences, 317 lines)
  1  stylesheet.css           (CSS, 363 lines)
  1  dev.sh                   (Developer CLI, 193 lines)
  1  metadata.json            (Metadata, 10 lines)
  1  LICENSE                  (GPL-2.0)
  1  README.md                (Documentation)
  1  design.md                (This file)
 15  src/**/*.js              (Source modules)
────
 57  total files
```
