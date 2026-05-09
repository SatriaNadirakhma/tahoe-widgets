import St      from 'gi://St';
import Clutter from 'gi://Clutter';
import { BaseWidget } from './baseWidget.js';

const DAYS   = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const MONTHS = ['January','February','March','April','May','June',
                'July','August','September','October','November','December'];

// Cairo LineCap.ROUND = 1  (avoid named import for GNOME version compatibility)
const LINE_CAP_ROUND = 1;

export class ClockWidget extends BaseWidget {

    build() {
        this.actor.add_style_class_name('tahoe-clock');

        /* ── Overlay: dial (bottom) + labels (top) ─────────────────── */
        const overlay = new Clutter.Actor({
            layout_manager: new Clutter.BinLayout(),
            x_expand: true,
            y_expand: true,
        });

        /* ── Tick-mark dial (St.DrawingArea) ───────────────────────── */
        this._dial = new St.DrawingArea({
            reactive: false,
            x_expand: true,
            y_expand: true,
            // Floor size so tick ring always looks circular
            style: 'min-width: 160px; min-height: 160px;',
        });
        this._dial.connect('repaint', area => this._drawDial(area));
        overlay.add_child(this._dial);   // z-order: below labels

        /* ── Labels stack (centred on top of dial) ─────────────────── */
        const labels = new St.BoxLayout({
            vertical: true,
            x_align:  Clutter.ActorAlign.CENTER,
            y_align:  Clutter.ActorAlign.CENTER,
            x_expand: true,
            y_expand: true,
            // Inset so text doesn't overlap the tick ring
            style:    'padding: 20px;',
        });

        this._timeRow = new St.BoxLayout({
            vertical: false,
            style:    'spacing:3px;',
            x_align:  Clutter.ActorAlign.CENTER,
        });
        this._timeLabel = new St.Label({
            text:        '--:--',
            style_class: 'tahoe-clock-time',
            y_align:     Clutter.ActorAlign.CENTER,
        });
        this._ampmLabel = new St.Label({
            text:        '',
            style_class: 'tahoe-clock-ampm',
            y_align:     Clutter.ActorAlign.CENTER,
        });
        this._timeRow.add_child(this._timeLabel);
        this._timeRow.add_child(this._ampmLabel);

        this._dateLabel = new St.Label({
            text:        '',
            style_class: 'tahoe-clock-date',
            x_align:     Clutter.ActorAlign.CENTER,
        });

        labels.add_child(this._timeRow);
        labels.add_child(this._dateLabel);
        overlay.add_child(labels);       // z-order: above dial

        this._content.add_child(overlay);

        /* ── Initial state ──────────────────────────────────────────── */
        this._currentSecond = 0;

        this._tick();
        this._timerId = this.startTimer(1000, () => this._tick(), false);
        this._unsubs.push(
            this._state.subscribe('settings:clock-format',       () => this._tick()),
            this._state.subscribe('settings:clock-show-seconds', () => this._tick()),
        );
    }

    /* ── Update every second ──────────────────────────────────────────── */

    _tick() {
        const now   = new Date();
        const is12h = this._state.clockFormat === '12h';
        const secs  = this._state.clockSeconds;
        let hours   = now.getHours(), ampm = '';

        if (is12h) {
            ampm  = hours >= 12 ? 'PM' : 'AM';
            hours = hours % 12 || 12;
        }

        const hStr = is12h ? String(hours) : String(hours).padStart(2, '0');
        const mStr = String(now.getMinutes()).padStart(2, '0');
        const sStr = secs ? `:${String(now.getSeconds()).padStart(2, '0')}` : '';

        this._timeLabel.set_text(`${hStr}:${mStr}${sStr}`);
        this._ampmLabel.set_text(is12h ? ampm : '');
        this._dateLabel.set_text(
            `${DAYS[now.getDay()]}, ${MONTHS[now.getMonth()]} ${now.getDate()}`
        );

        this._currentSecond = now.getSeconds();
        this._dial.queue_repaint();   // redraw dial ring for new second
    }

    /* ── Cairo dial drawing ───────────────────────────────────────────── */

    _drawDial(area) {
        const cr  = area.get_context();
        const w   = area.get_width();
        const h   = area.get_height();
        const cx  = w / 2;
        const cy  = h / 2;

        // Outer radius: stay within the widget boundary with a small margin
        const r   = Math.min(w, h) / 2 - 5;
        const sec = this._currentSecond;

        cr.setLineCap(LINE_CAP_ROUND);

        for (let i = 0; i < 60; i++) {
            // 12 o'clock = top → angle offset -π/2
            const angle  = (i / 60) * 2 * Math.PI - Math.PI / 2;
            const isHour = (i % 5 === 0);

            // Hour marks are longer and thicker (like the reference screenshot)
            const tickLen = isHour ? 9 : 5;
            const lineW   = isHour ? 2.2 : 1.4;

            // Per-second sweep animation:
            //   current second  → full brightness  (visual "tick" pop)
            //   elapsed seconds → medium            (progress arc)
            //   future seconds  → dim               (unlit)
            let alpha;
            if (i === sec)    alpha = 1.0;
            else if (i < sec) alpha = 0.55;
            else              alpha = 0.18;

            const x1 = cx + Math.cos(angle) * r;
            const y1 = cy + Math.sin(angle) * r;
            const x2 = cx + Math.cos(angle) * (r - tickLen);
            const y2 = cy + Math.sin(angle) * (r - tickLen);

            cr.setSourceRGBA(1, 1, 1, alpha);
            cr.setLineWidth(lineW);
            cr.moveTo(x1, y1);
            cr.lineTo(x2, y2);
            cr.stroke();
        }

        // Small filled dot at the active-second position — extra accent
        const dotAngle = (sec / 60) * 2 * Math.PI - Math.PI / 2;
        const dotR     = r - 2.5;
        cr.arc(
            cx + Math.cos(dotAngle) * dotR,
            cy + Math.sin(dotAngle) * dotR,
            2.5, 0, 2 * Math.PI
        );
        cr.setSourceRGBA(1, 1, 1, 0.95);
        cr.fill();

        cr.$dispose();
    }

    /* ── Lifecycle ────────────────────────────────────────────────────── */

    destroy() {
        this.stopTimer(this._timerId);
        super.destroy();
    }
}