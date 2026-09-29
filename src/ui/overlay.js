// Always-on overlay pieces: launcher button, HUD strip. Mounted/unmounted by the master toggle.

import { S, settingsGet, saveSettings, bus } from '../state.js';
import { esc, icon, bar, el, onLongPress } from './dom.js';
import { toParts, formatTime, formatDate, partOfDay } from '../engine/time.js';
import { trackerState } from '../engine/rules.js';
import { openDeck } from './deck.js';
import { openPanel } from './panels.js';
import { choiceDialog } from './sheet.js';
import { queueSize, onQueueChange } from '../ai/queue.js';

export const WEATHER_ICON = {
    clear: '☀️', sunny: '☀️', cloudy: '⛅', overcast: '☁️', rain: '🌧️', drizzle: '🌦️', storm: '⛈️', snow: '❄️', blizzard: '🌨️',
    fog: '🌫️', wind: '💨', heat: '🔥', ash: '🌋', aurora: '🌌',
};
export const weatherIcon = (k) => WEATHER_ICON[k] || WEATHER_ICON[Object.keys(WEATHER_ICON).find(w => String(k).includes(w))] || '🌤️';

let root = null;
const offs = [];
let ro = null;

export function mountOverlay() {
    if (root) return;
    root = el(`<div id="uie-overlay" class="uie-scope">
        <div id="uie-hud" class="uie-hud" role="region" aria-label="Game status"></div>
        <button id="uie-launcher" class="uie-launcher" aria-label="Open UIE Command Deck" title="Command Deck (long-press to move)">
            <span class="uie-launcher-ring"></span>${icon('fa-compass')}<span class="uie-launcher-busy" hidden></span>
        </button>
    </div>`);
    document.body.appendChild(root);
    document.body.classList.add('uie-on');

    const launcher = root.querySelector('#uie-launcher');
    launcher.addEventListener('click', () => openDeck());
    onLongPress(launcher, async () => {
        const corner = await choiceDialog('Move launcher', [
            { label: 'Bottom right', value: 'br', icon: 'fa-arrow-down-long' },
            { label: 'Bottom left', value: 'bl', icon: 'fa-arrow-down-long' },
            { label: 'Top right', value: 'tr', icon: 'fa-arrow-up-long' },
            { label: 'Top left', value: 'tl', icon: 'fa-arrow-up-long' },
        ]);
        if (corner) { settingsGet().launcherCorner = corner; saveSettings(); placeLauncher(); }
    });

    const hud = root.querySelector('#uie-hud');
    hud.addEventListener('click', (e) => {
        const go = e.target.closest('[data-open]');
        if (go) { e.stopPropagation(); openPanel(go.dataset.open); return; }
        if (e.target.closest('[data-hud-toggle]')) {
            const s = settingsGet();
            s.hud.expanded = !s.hud.expanded;
            saveSettings();
        }
    });

    offs.push(bus.on(() => renderHud()));
    offs.push(onQueueChange((n) => {
        const b = root?.querySelector('.uie-launcher-busy');
        if (b) b.hidden = n === 0;
    }));

    // Keep the launcher above ST's send form, whatever its height (no polling).
    const form = document.getElementById('form_sheld') || document.getElementById('send_form');
    if (form && 'ResizeObserver' in window) {
        ro = new ResizeObserver(() => placeLauncher());
        ro.observe(form);
        const sheld = document.getElementById('sheld');
        if (sheld) ro.observe(sheld);
    }
    setTimeout(placeLauncher, 400);
    window.addEventListener('resize', placeLauncher);
    placeLauncher();
    renderHud();
}

export function unmountOverlay() {
    offs.splice(0).forEach(f => f());
    ro?.disconnect(); ro = null;
    window.removeEventListener('resize', placeLauncher);
    root?.remove();
    root = null;
    document.body.classList.remove('uie-on', 'uie-hud-on', 'uie-hud-expanded');
}

export function placeLauncher() {
    if (!root) return;
    const l = root.querySelector('#uie-launcher');
    const corner = settingsGet().launcherCorner || 'br';
    const vh = window.innerHeight;
    const form = document.getElementById('form_sheld') || document.getElementById('send_form');
    let formH = 64;
    if (form) {
        const r = form.getBoundingClientRect();
        if (r.height > 0 && r.bottom > 0) formH = Math.round(r.height + Math.max(0, vh - r.bottom));
    }
    if (!Number.isFinite(formH) || formH > vh * 0.6) formH = 64;
    const hud = root.querySelector('#uie-hud');
    const topBar = document.getElementById('top-bar');
    const topBarH = Math.max(0, Math.min(120, topBar?.getBoundingClientRect().bottom || 40));
    const hudH = hud && !hud.hidden ? Math.min(vh * 0.5, hud.querySelector('.uie-hud-row')?.getBoundingClientRect().height || 0) : 0;
    const bottomPx = `${formH + 12}px`;
    l.dataset.corner = corner;
    l.style.setProperty('--uie-launch-bottom', bottomPx);
    l.style.setProperty('--uie-launch-top', `${Math.round(topBarH + hudH) + 10}px`);
    const rootStyle = document.documentElement.style;
    rootStyle.setProperty('--uie-launch-bottom-px', bottomPx);
    // Align the HUD with ST's chat column (its real width differs from --sheldWidth on phones).
    const sheld = document.getElementById('sheld');
    if (sheld) {
        const r = sheld.getBoundingClientRect();
        if (r.width > 0) {
            rootStyle.setProperty('--uie-col-left', `${Math.max(0, Math.round(r.left))}px`);
            rootStyle.setProperty('--uie-col-width', `${Math.round(Math.min(r.width, window.innerWidth))}px`);
        }
    }
    rootStyle.setProperty('--uie-top', `${Math.round(topBarH)}px`);
    document.body.classList.toggle('uie-launch-left', corner === 'bl');
    document.body.classList.toggle('uie-launch-right', corner === 'br');
}

function renderHud() {
    if (!root) return;
    const hud = root.querySelector('#uie-hud');
    const set = settingsGet();
    const show = set.hud.show !== false;
    hud.hidden = !show;
    document.body.classList.toggle('uie-hud-on', show);
    document.body.classList.toggle('uie-hud-expanded', show && !!set.hud.expanded);
    if (!show) { placeLauncher(); return; }
    const s = S();
    const it = set.hud.items;
    const p = toParts(s.clock.t, s.calendar.epoch);
    const here = s.map.nodes[s.map.location];
    const hp = s.player.bars.hp;
    const statuses = Object.values(s.statuses);
    const warn = Object.values(s.trackers).filter(t => trackerState(t) !== 'ok');

    const chips = [];
    if (it.time) chips.push(`<span class="uie-chip" title="${esc(formatDate(p, 'long', s.calendar.monthNames))}">${icon('fa-clock')} ${esc(formatTime(p, s.calendar.h24))}<small class="uie-hide-xs"> ${esc(formatDate(p, 'dmy').slice(0, 5))}</small></span>`);
    if (it.weather) chips.push(`<span class="uie-chip" title="${esc(s.weather.kind)}">${weatherIcon(s.weather.kind)}<small class="uie-hide-xs"> ${esc(s.weather.kind)}</small></span>`);
    if (it.location) chips.push(`<span class="uie-chip uie-chip-loc" data-open="map">${icon('fa-location-dot')} <span>${esc(here?.name || '—')}</span></span>`);
    if (it.hp && hp) chips.push(`<span class="uie-chip uie-chip-hp">${icon('fa-heart')} ${bar(hp.value, hp.max, hp.color, { small: true, label: 'HP' })}</span>`);
    if (it.currency) chips.push(`<span class="uie-chip" data-open="inventory">${esc(s.player.currencySymbol || '🪙')} ${esc(s.player.currency)}</span>`);
    if (it.status && (statuses.length || warn.length)) chips.push(`<span class="uie-chip uie-chip-warn" title="${esc(statuses.map(x => x.name).concat(warn.map(t => `${t.label} low`)).join(', '))}">${icon('fa-triangle-exclamation')} ${statuses.length + warn.length}</span>`);

    const bars = Object.entries(s.player.bars).filter(([id, b]) => b.visible !== false && it[id] !== false)
        .map(([id, b]) => `<div class="uie-hud-stat"><label>${icon(b.icon || 'fa-circle')} ${esc(b.label || id.toUpperCase())}<b>${Math.round(b.value)}/${b.max}</b></label>${bar(b.value, b.max, b.color, { label: b.label })}</div>`).join('');
    const trackers = it.trackers ? Object.entries(s.trackers).filter(([, t]) => t.visible !== false)
        .map(([, t]) => `<div class="uie-hud-stat uie-${trackerState(t)}"><label>${icon(t.icon || 'fa-circle')} ${esc(t.label)}<b>${Math.round(t.value)}</b></label>${bar(t.value - (t.min || 0), (t.max || 100) - (t.min || 0), t.color, { label: t.label })}</div>`).join('') : '';

    hud.innerHTML = `
        <div class="uie-hud-row" data-hud-toggle role="button" tabindex="0" aria-expanded="${set.hud.expanded ? 'true' : 'false'}" aria-label="Toggle status details">
            ${chips.join('')}
            <span class="uie-hud-caret">${icon(set.hud.expanded ? 'fa-chevron-up' : 'fa-chevron-down')}</span>
        </div>
        ${set.hud.expanded ? `<div class="uie-hud-more">
            <div class="uie-hud-line">${icon('fa-calendar')} ${esc(formatDate(p, 'long', s.calendar.monthNames))} · ${esc(partOfDay(p.hh))} · ${esc(s.weather.kind)}${s.weather.temp !== undefined ? ` ${esc(s.weather.temp)}°` : ''}</div>
            ${it.status ? `<div class="uie-hud-line">${icon('fa-shield-heart')} ${statuses.length ? statuses.map(x => `<span class="uie-tag">${esc(x.name)}</span>`).join(' ') : '<span class="uie-muted">Status: Clear</span>'}</div>` : ''}
            <div class="uie-hud-grid">${bars}${trackers}</div>
            <div class="uie-hud-line uie-muted">Lv ${esc(s.player.level)} ${esc(s.player.name || '')} · tap the bar to collapse</div>
        </div>` : ''}`;
    placeLauncher();
    void queueSize;
}
