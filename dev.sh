#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────
# Tahoe Widgets v3 — dev.sh
# ─────────────────────────────────────────────────────────────────────
set -euo pipefail

UUID="tahoe-widgets@gnome"
DEST="${HOME}/.local/share/gnome-shell/extensions/${UUID}"
SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

install() {
    echo "▶ Installing to ${DEST}…"
    mkdir -p "${DEST}"
    rsync -a --delete \
        --exclude='.git' --exclude='*.sh' --exclude='node_modules' \
        "${SRC}/" "${DEST}/"
    glib-compile-schemas "${DEST}/schemas/"
    echo "  ✓ Installed + schemas compiled"
}

enable()  { gnome-extensions enable  "${UUID}" && echo "  ✓ Enabled";  }
disable() { gnome-extensions disable "${UUID}" && echo "  ✓ Disabled"; }

reload() {
    disable 2>/dev/null || true
    sleep 0.5
    enable
    echo "  ✓ Reloaded"
}

restart() {
    if [[ "${XDG_SESSION_TYPE:-}" == "x11" ]]; then
        busctl --user call org.gnome.Shell /org/gnome/Shell \
            org.gnome.Shell Eval s 'Meta.restart("Restarting…", global.context)'
    else
        echo "ℹ Wayland: log out and back in, or use: ./dev.sh reload"
    fi
}

logs() {
    echo "▶ Tailing logs — Ctrl-C to stop"
    journalctl -f -o cat /usr/bin/gnome-shell 2>/dev/null \
        | grep --line-buffered -i 'TahoeWidgets\|tahoe-widgets\|JS ERROR'
}

clean() {
    echo "▶ Removing ${DEST}…"
    rm -rf "${DEST}"
    echo "  ✓ Done"
}

status() {
    gnome-extensions info "${UUID}" 2>/dev/null || echo "Extension not found"
}

schemas() {
    glib-compile-schemas "${SRC}/schemas/"
    echo "  ✓ Schemas compiled"
}

case "${1:-help}" in
    install) install ;;
    enable)  enable  ;;
    disable) disable ;;
    reload)  reload  ;;
    restart) restart ;;
    logs)    logs    ;;
    clean)   clean   ;;
    status)  status  ;;
    schemas) schemas ;;
    *)
        echo "Usage: $0 {install|enable|disable|reload|restart|logs|clean|status|schemas}"
        ;;
esac
