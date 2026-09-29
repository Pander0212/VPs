// Atmosphere: a light CSS-only tint + particle overlay behind the chat that follows the
// game's weather and time of day. Plus a small panel to change weather manually.

import { S, bus, settingsGet, saveSettings, userOps } from '../state.js';
import { el, esc, icon } from './dom.js';
import { openSheet } from './sheet.js';
import { toParts, partOfDay } from '../engine/time.js';
import { WEATHER_ICON } from './overlay.js';

let node = null;
let off = null;

function kindOf(w) {
    const k = String(w || '');
    if (/storm|thunder/.test(k)) return 'storm';
    if (/rain|drizzle/.test(k)) return 'rain';
    if (/snow|blizzard/.test(k)) return 'snow';
    if (/fog|mist/.test(k)) return 'fog';
    if (/ash/.test(k)) return 'ash';
    return 'clear';
}

function render() {
    if (!node) return;
    const s = S();
    const p = toParts(s.clock.t, s.calendar.epoch);
    const tod = partOfDay(p.hh);
    const kind = kindOf(s.weather.kind);
    if (node.dataset.tod === tod && node.dataset.kind === kind) return;
    node.dataset.tod = tod;
    node.dataset.kind = kind;
    const n = kind === 'clear' || kind === 'fog' ? 0 : kind === 'storm' ? 36 : 26;
    node.querySelector('.uie-atmo-particles').innerHTML = Array.from({ length: n }, (_, i) =>
        `<i style="--x:${(i * 37) % 100}%;--d:${(0.6 + ((i * 13) % 10) / 10).toFixed(2)}s;--delay:-${((i * 7) % 20) / 10}s;--s:${0.6 + ((i * 11) % 6) / 10}"></i>`).join('');
}

export function mountAtmosphere() {
    if (node) { render(); return; }
    node = el('<div id="uie-atmo" aria-hidden="true"><div class="uie-atmo-tint"></div><div class="uie-atmo-particles"></div></div>');
    document.body.appendChild(node);
    off = bus.on(() => render());
    render();
}

export function unmountAtmosphere() {
    off?.();
    off = null;
    node?.remove();
    node = null;
}

const WEATHERS = ['clear', 'cloudy', 'overcast', 'rain', 'storm', 'snow', 'fog', 'wind', 'heat'];

export function open() {
    const sheet = openSheet({ id: 'atmosphere', title: 'Atmosphere', icon: 'fa-cloud-sun-rain', size: 'half' });
    const draw = () => {
        const s = S();
        const set = settingsGet();
        sheet.body.innerHTML = `<div class="uie-pad">
            <label class="uie-switch"><input type="checkbox" data-atmo ${set.atmosphere ? 'checked' : ''}><span></span> Show atmosphere overlay</label>
            <h4>Weather</h4>
            <div class="uie-weather-grid">${WEATHERS.map(w => `<button class="uie-tile uie-tile-sm ${s.weather.kind === w ? 'active' : ''}" data-w="${w}"><span class="uie-emoji">${WEATHER_ICON[w] || '🌤️'}</span><span>${esc(w)}</span></button>`).join('')}</div>
            <label class="uie-field"><span>Temperature (°C)</span><input type="number" min="-60" max="60" data-temp value="${esc(s.weather.temp ?? 20)}"></label>
            <p class="uie-muted">${icon('fa-circle-info')} The tracker pass also changes the weather when the story does.</p>
        </div>`;
    };
    draw();
    sheet.body.addEventListener('click', (e) => {
        const w = e.target.closest('[data-w]');
        if (w) { userOps([{ op: 'weather.set', kind: w.dataset.w }]); draw(); }
    });
    sheet.body.addEventListener('change', (e) => {
        if (e.target.matches('[data-atmo]')) { settingsGet().atmosphere = e.target.checked; saveSettings(); }
        if (e.target.matches('[data-temp]')) userOps([{ op: 'weather.set', kind: S().weather.kind, temp: Number(e.target.value) }], { toast: false });
    });
    return sheet;
}
