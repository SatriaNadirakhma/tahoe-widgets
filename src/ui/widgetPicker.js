import St      from 'gi://St';
import Clutter from 'gi://Clutter';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { Logger } from '../utils/logger.js';
import { getLucideIcon } from '../utils/lucideHelper.js';

export class WidgetPicker {
    constructor(registry, state) {
        this._registry = registry; this._state = state;
        this._log = new Logger('Picker'); this._visible = false;
        this._build();
    }
    _build() {
        const _mon = Main.layoutManager.primaryMonitor;
        this._scrim = new St.Widget({
            reactive: true, x: _mon.x, y: _mon.y,
            width: _mon.width,
            height: _mon.height,
            style: 'background: rgba(0,0,0,0.35);', opacity: 0,
        });
        this._scrim.connect('button-press-event', () => { this.hide(); return Clutter.EVENT_STOP; });
        this._panel = new St.BoxLayout({
            vertical: true, width: 320,
            style_class: 'tahoe-picker-panel',
            style: 'padding: 20px; spacing: 0px;',
        });
        const header = new St.BoxLayout({ vertical: false, style: 'margin-bottom:16px; spacing:8px;' });
        header.add_child(new St.Label({ text: 'Add Widget', style_class: 'tahoe-label-medium',
            x_expand: true, y_align: Clutter.ActorAlign.CENTER }));
        const closeBtn = new St.Button({
            style_class: 'tahoe-btn-icon',
            y_align: Clutter.ActorAlign.CENTER,
        });
        closeBtn.set_child(getLucideIcon('x', 16));
        closeBtn.connect('clicked', () => this.hide());
        header.add_child(closeBtn);
        this._panel.add_child(header);
        this._panel.add_child(new St.Widget({ x_expand: true, height: 1,
            style: 'background: rgba(255,255,255,0.12); margin-bottom:12px;' }));
        const scroll = new St.ScrollView({ x_expand: true, y_expand: true,
            style: 'max-height: 460px;' });
        scroll.set_policy(St.PolicyType.NEVER, St.PolicyType.AUTOMATIC);
        this._list = new St.BoxLayout({ vertical: true, style: 'spacing: 8px;' });
        scroll.set_child(this._list);
        this._panel.add_child(scroll);
        this._panel.add_child(new St.Widget({ x_expand: true, height: 1,
            style: 'background: rgba(255,255,255,0.10); margin-top:12px; margin-bottom:12px;' }));
        const resetBtn = new St.Button({
            style_class: 'tahoe-btn tahoe-btn-danger', x_align: Clutter.ActorAlign.CENTER,
        });
        const resetBox = new St.BoxLayout({ vertical: false, style: 'spacing:6px;', x_align: Clutter.ActorAlign.CENTER });
        resetBox.add_child(getLucideIcon('triangle-alert', 14));
        resetBox.add_child(new St.Label({ text: 'Reset All to Defaults' }));
        resetBtn.set_child(resetBox);
        resetBtn.connect('clicked', () => this._onReset());
        this._panel.add_child(resetBtn);
        this._repositionPanel();
        Main.layoutManager.addChrome(this._scrim, { affectsStruts: false });
        Main.layoutManager.addChrome(this._panel, { affectsStruts: false });
        this._scrim.hide(); this._panel.hide();
    }
    toggle() { this._visible ? this.hide() : this.show(); }
    show() {
        this._populateList(); this._repositionPanel();
        this._scrim.show(); this._panel.show();
        this._panel.set_pivot_point(1, 0.5);
        this._panel.ease({ translation_x: 0, opacity: 255, duration: 220,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD });
        this._scrim.ease({ opacity: 255, duration: 200 });
        this._visible = true;
    }
    hide() {
        this._panel.ease({ translation_x: 340, opacity: 0, duration: 180,
            mode: Clutter.AnimationMode.EASE_IN_QUAD,
            onComplete: () => { this._panel.hide(); this._scrim.hide(); } });
        this._scrim.ease({ opacity: 0, duration: 180 });
        this._visible = false;
    }
    destroy() {
        Main.layoutManager.removeChrome(this._scrim);
        Main.layoutManager.removeChrome(this._panel);
        this._scrim.destroy(); this._panel.destroy();
    }
    _repositionPanel() {
        const m = Main.layoutManager.primaryMonitor;
        this._panel.set_position(m.x + m.width - 340, m.y + (this._state.topBarMargin ?? 40) + 8);
        this._panel.height = m.height - (this._state.topBarMargin ?? 40) - 24;
        this._panel.translation_x = 340;
    }
    _populateList() {
        this._list.remove_all_children();
        const catalog = this._registry.getCatalog();
        if (!catalog.length) {
            this._list.add_child(new St.Label({ text: 'No widgets available',
                style_class: 'tahoe-label-small tahoe-muted' }));
            return;
        }
        catalog.forEach(desc => this._list.add_child(this._makeCard(desc, this._registry.isActive(desc.id))));
    }
    _makeCard(desc, isActive) {
        const card = new St.BoxLayout({
            vertical: false,
            style_class: 'tahoe-picker-card',
            reactive: true,
        });
        if (isActive) card.add_style_class_name('active');
        const catIcon = getLucideIcon(desc.icon ?? 'cloud', 28);
        catIcon.add_style_class_name('tahoe-picker-icon');
        card.add_child(catIcon);
        const textCol = new St.BoxLayout({ vertical: true, x_expand: true,
            y_align: Clutter.ActorAlign.CENTER, style: 'spacing:2px;' });
        textCol.add_child(new St.Label({ text: desc.label ?? desc.id, style_class: 'tahoe-label' }));
        textCol.add_child(new St.Label({ text: desc.description ?? '',
            style_class: 'tahoe-label-small tahoe-muted' }));
        card.add_child(textCol);
        const btn = new St.Button({ label: isActive ? 'Remove' : 'Add',
            style_class: `tahoe-btn${isActive ? ' tahoe-btn-danger' : ''}`,
            y_align: Clutter.ActorAlign.CENTER });
        btn.connect('clicked', () => {
            if (this._registry.isActive(desc.id)) this._registry.destroyWidget(desc.id);
            else { try { this._registry.instantiate(desc.id); } catch (e) { this._log.error('Add failed', e.message); } }
            this._populateList();
        });
        card.add_child(btn);
        return card;
    }
    _onReset() {
        this._state.resetAll(); this._registry.destroyAll(); this.hide();
        Main.notify('Tahoe Widgets', 'All widgets removed and settings reset.');
    }
}
