#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────
# Tahoe Widgets v3 — dev.sh
#
# Quick-start:  ./dev.sh dev    (installs + reloads, picks best method)
# Watch logs:   ./dev.sh logs   (tails gnome-shell errors)
# ─────────────────────────────────────────────────────────────────────
set -euo pipefail

UUID="tahoe-widgets@gnome"
DEST="${HOME}/.local/share/gnome-shell/extensions/${UUID}"
SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ── Helpers ───────────────────────────────────────────────────────────

_is_wayland() { [[ "${XDG_SESSION_TYPE:-}" == "wayland" ]]; }
_is_x11()     { [[ "${XDG_SESSION_TYPE:-}" == "x11" ]]; }
_have_busctl() { command -v busctl &>/dev/null; }

# ── Commands ──────────────────────────────────────────────────────────

install() {
    echo "▶ Installing to ${DEST}…"
    mkdir -p "${DEST}"
    rsync -a --delete \
        --exclude='.git' --exclude='*.sh' --exclude='node_modules' \
        "${SRC}/" "${DEST}/"
    glib-compile-schemas "${DEST}/schemas/"

    # Clear any GNOME Shell theme cache for our CSS
    rm -f "${HOME}/.cache/gnome-shell/theme-files/"*tahoe* 2>/dev/null || true

    echo "  ✓ Installed + schemas compiled"
}

enable()  {
    echo "▶ Enabling…"
    if _have_busctl; then
        busctl --user call org.gnome.Shell \
            /org/gnome/Shell org.gnome.Shell.Extensions \
            EnableExtension s "${UUID}" >/dev/null 2>&1
    else
        gnome-extensions enable "${UUID}"
    fi
    echo "  ✓ Enabled"
}

disable() {
    echo "▶ Disabling…"
    if _have_busctl; then
        busctl --user call org.gnome.Shell \
            /org/gnome/Shell org.gnome.Shell.Extensions \
            DisableExtension s "${UUID}" >/dev/null 2>&1
    else
        gnome-extensions disable "${UUID}" 2>/dev/null || true
    fi
    echo "  ✓ Disabled"
}

reload() {
    disable
    sleep 0.4

    # Use GNOME Shell's native ReloadExtension if available (GNOME 45+)
    if _have_busctl; then
        busctl --user call org.gnome.Shell \
            /org/gnome/Shell org.gnome.Shell.Extensions \
            ReloadExtension s "${UUID}" >/dev/null 2>&1 && {
            echo "  ✓ Reloaded (native D-Bus)"
            _reload_note
            return
        }
    fi

    # Fallback: manual disable → enable
    enable
    echo "  ✓ Reloaded (disable → enable)"
    _reload_note
}

_reload_note() {
    echo ""
    echo "  ── What changed this cycle? ──────────────────────────"
    echo "  CSS / stylesheet →  ✓ reloaded (St.Theme re-reads it)"
    echo "  GSettings schema →  ✓ reloaded (re-compiled)"
    echo "  assets / fonts   →  ✓ reloaded"
    echo "  JS module code   →  ⚠  may NOT reload (see below)"
    echo ""
    echo "  THE GJS CACHE PROBLEM"
    echo "  ─────────────────────"
    echo "  SpiderMonkey caches all ES import results by file URL."
    echo "  Disable/enable does NOT clear the engine cache, so"
    echo "  sub-module changes (src/widgets/*.js etc.) are stale."
    echo ""
    if _is_x11; then
        echo "  Solution:  ./dev.sh restart    (full shell restart)"
    else
        echo "  Solution (Wayland):  log out → log back in"
        echo "    Quick logout:   gnome-session-quit --no-prompt"
        echo "    Or switch to X11 for development"
    fi
    echo ""
}

restart() {
    if _is_x11; then
        echo "▶ Restarting GNOME Shell…"
        busctl --user call org.gnome.Shell /org/gnome/Shell \
            org.gnome.Shell Eval s 'Meta.restart("Restarting…", global.context)'
        echo "  ✓ Shell restarted — all JS modules reloaded"
    else
        echo "✘ Cannot restart shell on Wayland (compositor = shell)"
        echo "  → Log out and back in to reload JS modules"
        echo "  → Quick command: gnome-session-quit --no-prompt"
    fi
}

dev() {
    echo "═ dev cycle ═══════════════════════════════════════════"
    install
    echo ""
    if _is_x11; then
        echo "▶ X11 — full shell restart (reloads everything)"
        restart
    else
        echo "▶ Wayland — best-effort reload"
        reload
    fi
}

logs() {
    echo "▶ Streaming gnome-shell logs (Tahoe + JS errors)"
    echo "  Ctrl-C to stop"
    echo ""
    journalctl -f -o cat /usr/bin/gnome-shell 2>/dev/null \
        | grep --line-buffered -iE 'tahoe|JS ERROR|extension' || \
        journalctl -f -o cat --user -n 0 2>/dev/null \
        | grep --line-buffered -iE 'tahoe|JS ERROR|gnome-shell'
}

clean() {
    echo "▶ Removing ${DEST}…"
    rm -rf "${DEST}"
    echo "  ✓ Done"
}

status() {
    echo "▶ Extension status:"
    gnome-extensions info "${UUID}" 2>/dev/null || echo "  Not found"
}

schemas() {
    glib-compile-schemas "${SRC}/schemas/"
    echo "  ✓ Schemas compiled"
}

# ── Dispatch ──────────────────────────────────────────────────────────

case "${1:-help}" in
    install) install ;;
    enable)  enable  ;;
    disable) disable ;;
    reload)  reload  ;;
    restart) restart ;;
    dev)     dev     ;;
    logs)    logs    ;;
    clean)   clean   ;;
    status)  status  ;;
    schemas) schemas ;;
    *)
        echo "Usage: $0 {install|enable|disable|reload|restart|dev|logs|clean|status|schemas}"
        echo ""
        echo "  Quick start:  ./dev.sh dev    (install + reload, picks best method)"
        echo "  Watch logs:   ./dev.sh logs"
        echo ""
        echo "  dev     — install + reload (X11: shell restart; Wayland: reload)"
        echo "  install — copy files + compile schemas"
        echo "  reload  — disable → enable  (CSS ✓, JS ⚠)"
        echo "  restart — X11 shell restart (full JS reload)  [X11 only]"
        echo ""
        echo "  ══ JS MODULE CACHE ═══════════════════════════════════════"
        echo "  GJS (SpiderMonkey) caches all ES import results by URL."
        echo "  Disable/enable cycles do NOT clear this internal cache."
        echo ""
        if _is_x11; then
            echo "  You are on X11:  ./dev.sh restart      = full reload ✓"
        else
            echo "  You are on Wayland: must log out/in for JS changes"
            echo "  CSS/assets/GSettings → reload works      ✓"
            echo "  JS sub-module code  → needs full restart"
        fi
        ;;
esac
