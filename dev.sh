#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────
# Tahoe Widgets — dev.sh
# ─────────────────────────────────────────────────────────────────────
set -euo pipefail

UUID="tahoe-widgets@gnome"
DEST="${HOME}/.local/share/gnome-shell/extensions/${UUID}"
SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

install() {
    echo "▶ Installing to ${DEST}…"
    mkdir -p "${DEST}"
    rsync -a --delete \
        --exclude='.git' \
        --exclude='*.sh' \
        --exclude='node_modules' \
        "${SRC}/" "${DEST}/"
    glib-compile-schemas "${DEST}/schemas/"
    echo "  ✓ Installed + schemas compiled"
    echo "  ⚠ Wayland: logout & login dulu sebelum enable"
    echo "  ⚠ X11:     jalankan: ./dev.sh restart"
}

enable() {
    gnome-extensions enable "${UUID}" \
        && echo "  ✓ Enabled: ${UUID}" \
        || echo "  ✗ Gagal — coba logout/login dulu lalu ulangi"
}

disable() {
    gnome-extensions disable "${UUID}" \
        && echo "  ✓ Disabled: ${UUID}" \
        || echo "  ✗ Gagal disable"
}

reload() {
    echo "▶ Reload extension…"
    gnome-extensions disable "${UUID}" 2>/dev/null || true
    sleep 0.8
    gnome-extensions enable  "${UUID}" \
        && echo "  ✓ Reloaded" \
        || echo "  ✗ Gagal reload — coba logout/login"
}

restart() {
    if [[ "${XDG_SESSION_TYPE:-}" == "x11" ]]; then
        echo "▶ Restart GNOME Shell (X11)…"
        busctl --user call org.gnome.Shell /org/gnome/Shell \
            org.gnome.Shell Eval s \
            'Meta.restart("Restarting…", global.context)' \
            && echo "  ✓ Restarting…"
    else
        echo "  ℹ Wayland terdeteksi."
        echo "  → Logout lalu login kembali untuk restart GNOME Shell."
        echo "  → Atau gunakan: ./dev.sh reload (untuk reload extension saja)"
    fi
}

logs() {
    echo "▶ Tailing logs — Ctrl-C untuk stop"
    journalctl -f -o cat /usr/bin/gnome-shell 2>/dev/null \
        | grep --line-buffered -iE 'TahoeWidgets|tahoe-widgets|JS ERROR'
}

status() {
    echo "▶ Status extension:"
    gnome-extensions info "${UUID}" 2>/dev/null \
        || echo "  ✗ Extension tidak ditemukan — sudah install & restart GNOME Shell?"
    echo ""
    echo "▶ Lokasi file:"
    ls "${DEST}" 2>/dev/null || echo "  ✗ Folder tidak ditemukan: ${DEST}"
}

clean() {
    echo "▶ Menghapus ${DEST}…"
    rm -rf "${DEST}"
    echo "  ✓ Selesai"
}

schemas() {
    echo "▶ Compile schemas…"
    glib-compile-schemas "${SRC}/schemas/"
    echo "  ✓ Selesai"
}

help() {
    echo ""
    echo "Tahoe Widgets — dev.sh"
    echo "UUID: ${UUID}"
    echo ""
    echo "Perintah:"
    echo "  install   — copy file ke GNOME extensions folder + compile schemas"
    echo "  enable    — aktifkan extension (perlu restart GNOME Shell dulu)"
    echo "  disable   — nonaktifkan extension"
    echo "  reload    — disable lalu enable ulang"
    echo "  restart   — restart GNOME Shell (X11 only)"
    echo "  logs      — lihat log error realtime"
    echo "  status    — cek status extension & lokasi file"
    echo "  clean     — hapus folder extension dari sistem"
    echo "  schemas   — compile schemas saja"
    echo ""
    echo "Alur normal (Wayland):"
    echo "  1. ./dev.sh install"
    echo "  2. Logout → Login"
    echo "  3. ./dev.sh enable"
    echo ""
    echo "Alur normal (X11):"
    echo "  1. ./dev.sh install"
    echo "  2. ./dev.sh restart"
    echo "  3. ./dev.sh enable"
    echo ""
}

case "${1:-help}" in
    install) install ;;
    enable)  enable  ;;
    disable) disable ;;
    reload)  reload  ;;
    restart) restart ;;
    logs)    logs    ;;
    status)  status  ;;
    clean)   clean   ;;
    schemas) schemas ;;
    help|*)  help    ;;
esac