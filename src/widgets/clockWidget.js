/**
 * ClockWidget v3.1 — Font dari folder proyek
 *
 * Perubahan dari v3.0:
 *  - Font Inter untuk PangoCairo diambil langsung dari folder fonts/
 *    di dalam direktori ekstensi, via getFontDescription() helper.
 *  - Fallback ke 'Cantarell' jika file tidak ditemukan.
 *  - extensionPath harus di-pass lewat options (lihat contoh di bawah).
 *
 * Contoh pemanggilan dari widget registry / extension.js:
 *
 *   import { ClockWidget } from './widgets/clockWidget.js';
 *
 *   const clock = new ClockWidget({
 *       id:            'clock-1',
 *       state:         appState,
 *       registry:      widgetRegistry,
 *       extensionPath: extension.path,   // <── tambahkan ini
 *   });
 */

import St         from 'gi://St';
import Clutter    from 'gi://Clutter';
import Pango      from 'gi://Pango';
import PangoCairo from 'gi://PangoCairo';
import Gio        from 'gi://Gio';
import { BaseWidget, WIDGET_SMALL } from './baseWidget.js';

const LINE_CAP_ROUND = 1;

export class ClockWidget extends BaseWidget {

    constructor(options) {
        super(options);
        // extensionPath dipakai untuk mencari file font di folder fonts/
        this._extensionPath = options.extensionPath ?? null;
    }

    build() {
        this.actor.add_style_class_name('tahoe-clock');

        // Fixed 2×2 grid size — content fills it edge-to-edge
        this.actor.set_size(WIDGET_SMALL.width, WIDGET_SMALL.height);
        this._content.style = 'spacing:0; padding:0;';

        this._dial = new St.DrawingArea({
            reactive: false,
            x_expand: true,
            y_expand: true,
            style: 'padding:0; margin:0;',
        });
        this._dial.connect('repaint', area => this._drawClock(area));
        this._content.add_child(this._dial);

        this._tick();
        this._timerId = this.startTimer(1000, () => this._tick(), false);
    }

    _tick() {
        this._dial.queue_repaint();
    }

    /* ── Font helper ──────────────────────────────────────────────── */

    /**
     * Kembalikan Pango.FontDescription yang menggunakan Inter dari
     * folder fonts/ ekstensi jika tersedia, atau fallback ke Cantarell.
     *
     * Catatan: PangoCairo menggunakan font yang sudah terdaftar di
     * fontconfig/St theme — bukan load file langsung. Karena fontLoader.js
     * sudah mendaftarkan @font-face ke St.Theme saat enable(), Pango
     * di dalam Cairo context yang sama akan mengenali "Inter".
     *
     * _getFontDesc() hanya memvalidasi bahwa font file ada, lalu
     * mengembalikan descriptor string yang tepat. Jika tidak ada,
     * fallback ke Cantarell agar tidak error.
     *
     * @param {string} spec  — misal: 'Semi-Bold 9', 'Light 13'
     * @returns {Pango.FontDescription}
     */
    _getFontDesc(spec) {
        // Cek apakah Inter sudah tersedia (ada file-nya di folder proyek)
        if (this._extensionPath) {
            const probe = Gio.File.new_for_path(
                `${this._extensionPath}/fonts/Inter-Regular.ttf`
            );
            if (probe.query_exists(null)) {
                return Pango.FontDescription.from_string(`Inter ${spec}`);
            }
            this._log.warn('Inter tidak ditemukan di fonts/ — fallback ke Cantarell');
        }
        return Pango.FontDescription.from_string(`Cantarell ${spec}`);
    }

    /* ── Cairo analog clock ───────────────────────────────────────── */

    _drawClock(area) {
        const w = area.get_width();
        const h = area.get_height();
        if (w <= 0 || h <= 0) return;

        const cr  = area.get_context();
        const size = Math.min(w, h);
        const cx   = w / 2;
        const cy   = h / 2;
        const faceR = size / 2 - 8;

        const now = new Date();
        const sec = now.getSeconds();
        const min = now.getMinutes() + sec / 60;
        const hr  = (now.getHours() % 12) + now.getMinutes() / 60;

        // ── Clock face (white filled circle) ──────────────────────
        cr.arc(cx, cy, faceR, 0, 2 * Math.PI);
        cr.setSourceRGBA(1, 1, 1, 0.88);
        cr.fill();

        // ── Numbers 1–12 ──────────────────────────────────────────
        const numR = faceR - 14;
        try {
            const layout = PangoCairo.create_layout(cr);

            // Gunakan Inter dari folder proyek (atau Cantarell sebagai fallback)
            layout.set_font_description(this._getFontDesc('Semi-Bold 9'));

            cr.setSourceRGBA(0.15, 0.15, 0.15, 0.88);

            for (let i = 1; i <= 12; i++) {
                const angle = (i / 12) * 2 * Math.PI - Math.PI / 2;
                const nx = cx + Math.cos(angle) * numR;
                const ny = cy + Math.sin(angle) * numR;

                layout.set_text(String(i), -1);
                const [, ink] = layout.get_pixel_extents();
                cr.moveTo(
                    nx - (ink.width  / 2 + ink.x),
                    ny - (ink.height / 2 + ink.y)
                );
                PangoCairo.show_layout(cr, layout);
            }
        } catch {
            // Fallback: hour tick marks jika PangoCairo tidak tersedia
            cr.setLineCap(LINE_CAP_ROUND);
            for (let i = 0; i < 12; i++) {
                const angle = (i / 12) * 2 * Math.PI - Math.PI / 2;
                const x1 = cx + Math.cos(angle) * faceR;
                const y1 = cy + Math.sin(angle) * faceR;
                const x2 = cx + Math.cos(angle) * (faceR - 9);
                const y2 = cy + Math.sin(angle) * (faceR - 9);
                cr.setSourceRGBA(0.15, 0.15, 0.15, 0.7);
                cr.setLineWidth(2.5);
                cr.moveTo(x1, y1);
                cr.lineTo(x2, y2);
                cr.stroke();
            }
        }

        // ── Minute tick marks (small) ─────────────────────────────
        cr.setLineCap(LINE_CAP_ROUND);
        for (let i = 0; i < 60; i++) {
            if (i % 5 === 0) continue; // skip — hour position
            const angle = (i / 60) * 2 * Math.PI - Math.PI / 2;
            const x1 = cx + Math.cos(angle) * faceR;
            const y1 = cy + Math.sin(angle) * faceR;
            const x2 = cx + Math.cos(angle) * (faceR - 4);
            const y2 = cy + Math.sin(angle) * (faceR - 4);
            cr.setSourceRGBA(0.15, 0.15, 0.15, 0.25);
            cr.setLineWidth(1);
            cr.moveTo(x1, y1);
            cr.lineTo(x2, y2);
            cr.stroke();
        }

        // ── Hour hand ─────────────────────────────────────────────
        const hrAngle = (hr / 12) * 2 * Math.PI - Math.PI / 2;
        const hrLen   = faceR * 0.50;
        cr.setLineCap(LINE_CAP_ROUND);
        cr.setLineWidth(3);
        cr.setSourceRGBA(0.15, 0.15, 0.15, 0.95);
        cr.moveTo(cx, cy);
        cr.lineTo(cx + Math.cos(hrAngle) * hrLen,
                  cy + Math.sin(hrAngle) * hrLen);
        cr.stroke();

        // ── Minute hand ───────────────────────────────────────────
        const minAngle = (min / 60) * 2 * Math.PI - Math.PI / 2;
        const minLen   = faceR * 0.73;
        cr.setLineWidth(3);
        cr.setSourceRGBA(0.15, 0.15, 0.15, 0.95);
        cr.moveTo(cx, cy);
        cr.lineTo(cx + Math.cos(minAngle) * minLen,
                  cy + Math.sin(minAngle) * minLen);
        cr.stroke();

        // ── Second hand (orange, with short tail) ─────────────────
        const secAngle = (sec / 60) * 2 * Math.PI - Math.PI / 2;
        const secLen   = faceR * 0.78;
        const secTail  = faceR * 0.18;
        cr.setLineWidth(1);
        cr.setSourceRGBA(1, 0.502, 0, 0.95);
        cr.moveTo(cx - Math.cos(secAngle) * secTail,
                  cy - Math.sin(secAngle) * secTail);
        cr.lineTo(cx + Math.cos(secAngle) * secLen,
                  cy + Math.sin(secAngle) * secLen);
        cr.stroke();

        // ── Center dot ────────────────────────────────────────────
        cr.arc(cx, cy, 4.5, 0, 2 * Math.PI);
        cr.setSourceRGBA(0.15, 0.15, 0.15, 1);
        cr.fill();
        cr.arc(cx, cy, 2.5, 0, 2 * Math.PI);
        cr.setSourceRGBA(1, 0.502, 0, 1);
        cr.fill();

        cr.$dispose();
    }

    /* ── Lifecycle ────────────────────────────────────────────────── */

    destroy() {
        this.stopTimer(this._timerId);
        super.destroy();
    }
}