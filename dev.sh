#!/usr/bin/env bash
# =============================================================================
# Tahoe Widgets — Developer helper script
# Usage:
#   ./dev.sh install     — copy to ~/.local/share/gnome-shell/extensions/
#   ./dev.sh enable      — enable the extension
#   ./dev.sh disable     — disable the extension
#   ./dev.sh restart     — restart GNOME Shell (X11 only) or print Wayland tip
#   ./dev.sh logs        — tail extension logs from journalctl
#   ./dev.sh clean       — remove installed copy
#   ./dev.sh compile-schemas — compile GSettings schemas
# =============================================================================
set -euo pipefail

UUID="tahoe-widgets@gnome"
INSTALL_DIR="${HOME}/.local/share/gnome-shell/extensions/${UUID}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

_compile_schemas() {
    echo "▶ Compiling GSettings schemas…"
    glib-compile-schemas "${SCRIPT_DIR}/schemas/"
    echo "  ✓ Done"
}

_install() {
    echo "▶ Installing to ${INSTALL_DIR}…"
    mkdir -p "${INSTALL_DIR}"
    rsync -a --delete \
        --exclude='.git' \
        --exclude='node_modules' \
        --exclude='*.sh' \
        "${SCRIPT_DIR}/" "${INSTALL_DIR}/"
    _compile_schemas_dest
    echo "  ✓ Installed"
}

_compile_schemas_dest() {
    glib-compile-schemas "${INSTALL_DIR}/schemas/"
}

_enable() {
    gnome-extensions enable "${UUID}" && echo "  ✓ Enabled"
}

_disable() {
    gnome-extensions disable "${UUID}" && echo "  ✓ Disabled"
}

_restart() {
    if [ "${XDG_SESSION_TYPE:-}" = "x11" ]; then
        echo "▶ Restarting GNOME Shell (X11)…"
        busctl --user call org.gnome.Shell /org/gnome/Shell \
            org.gnome.Shell Eval s 'Meta.restart("Restarting…", global.context)'
    else
        echo "ℹ Wayland: log out and log back in to restart GNOME Shell."
        echo "  Or use: gnome-extensions disable ${UUID} && gnome-extensions enable ${UUID}"
    fi
}

_logs() {
    echo "▶ Tailing logs (Ctrl-C to stop)…"
    journalctl -f -o cat /usr/bin/gnome-shell 2>/dev/null \
        | grep --line-buffered -i 'TahoeWidgets\|tahoe-widgets\|Extension error'
}

_clean() {
    echo "▶ Removing ${INSTALL_DIR}…"
    rm -rf "${INSTALL_DIR}"
    echo "  ✓ Done"
}

CMD="${1:-help}"
case "${CMD}" in
    install)           _install          ;;
    enable)            _enable           ;;
    disable)           _disable          ;;
    restart)           _restart          ;;
    logs)              _logs             ;;
    clean)             _clean            ;;
    compile-schemas)   _compile_schemas  ;;
    *)
        echo "Usage: $0 {install|enable|disable|restart|logs|clean|compile-schemas}"
        exit 1
        ;;
esac
