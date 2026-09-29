// Map: tier tabs, procedural SVG terrain (no image assets), typed pins, touch pan/pinch-zoom,
// side panel / bottom sheet with travel info, Move To Area, Open Area, paths, AI expand, landmarks.

import { S, bus, userOps, mutate, settingsGet } from '../state.js';
import { st } from '../st-adapter.js';
import { openSheet, formDialog, confirmDialog } from './sheet.js';
import { esc, icon, opt, reportError } from './dom.js';
import { TIERS, TIER_LABEL, PIN_TYPES, TRAVEL_MODES, children, ancestors, ancestorAtTier, travelCost, modesFor, pathsFrom, placeNode, guessPin, childTier, locationPath } from '../engine/map.js';
import { standingLabel } from '../engine/rules.js';
import { humanDuration } from '../engine/time.js';
import { rng, hash, uid, str } from '../engine/util.js';
import { genJson, render as renderPrompt, recentMessages } from '../ai/gen.js';

const PIN_GLYPH = { you: '★', target: '◎', station: '⚓', vehicle: '⛵', danger: '!', service: '✚', interior: '⌂', place: '◆', unknown: '?' };
const STYLES = { fantasy: 'Fantasy', modern: 'Modern City', scifi: 'Sci-fi' };

const PALETTE = {
    fantasy: { base: '#c9c29a', base2: '#a9b27c', water: '#6fa3b8', forest: '#5f7d45', mount: '#8a7b62', road: '#6b5134', grid: 'none', label: '#20170c', labelBg: 'rgba(250,244,226,.92)' },
    modern: { base: '#2a3440', base2: '#34414f', water: '#2c5b78', forest: '#3d5a45', mount: '#3a4553', road: '#c7cdd6', grid: 'rgba(255,255,255,.06)', label: '#f4f1ea', labelBg: 'rgba(15,20,28,.88)' },
    scifi: { base: '#070b18', base2: '#0c1530', water: '#123a5c', forest: '#1c2a55', mount: '#1a1f3b', road: '#3fd1c0', grid: 'rgba(63,209,192,.12)', label: '#e8fbff', labelBg: 'rgba(5,10,24,.9)' },
};

// ---------------------------------------------------------------- terrain

function terrain(style, seed) {
    const p = PALETTE[style] || PALETTE.fantasy;
    const r0 = rng(hash(seed + style));
    const r = () => r0() * 1.6 - 0.3; // spread features over -300..1300 so tall phone views are filled
    let out = `<rect x="-2000" y="-2000" width="5000" height="5000" fill="${p.base}"/>`;
    // Soft land patches
    for (let i = 0; i < 14; i++) {
        const x = r() * 1000, y = r() * 1000, rx = 120 + r() * 220, ry = 90 + r() * 180;
        out += `<ellipse cx="${x.toFixed(0)}" cy="${y.toFixed(0)}" rx="${rx.toFixed(0)}" ry="${ry.toFixed(0)}" fill="${p.base2}" opacity=".55"/>`;
    }
    // River
    let d = `M ${(-50).toFixed(0)} ${(200 + r() * 600).toFixed(0)}`;
    for (let x = 100; x <= 1100; x += 150) d += ` Q ${x - 75} ${(r() * 1000).toFixed(0)} ${x} ${(250 + r() * 500).toFixed(0)}`;
    out += `<path d="${d}" fill="none" stroke="${p.water}" stroke-width="${style === 'modern' ? 28 : 18}" stroke-linecap="round" opacity=".85"/>`;
    // Lake
    out += `<ellipse cx="${(150 + r() * 700).toFixed(0)}" cy="${(150 + r() * 700).toFixed(0)}" rx="${(50 + r() * 70).toFixed(0)}" ry="${(35 + r() * 45).toFixed(0)}" fill="${p.water}" opacity=".9"/>`;
    if (style === 'fantasy') {
        for (let i = 0; i < 70; i++) {
            const x = r() * 1000, y = r() * 1000, s = 10 + r() * 16;
            out += `<circle cx="${x.toFixed(0)}" cy="${y.toFixed(0)}" r="${s.toFixed(0)}" fill="${p.forest}" opacity=".75"/>`;
        }
        for (let i = 0; i < 18; i++) {
            const x = r() * 1000, y = r() * 1000, s = 22 + r0() * 26;
            out += `<path d="M ${(x - s).toFixed(0)} ${(y + s * .6).toFixed(0)} L ${x.toFixed(0)} ${(y - s).toFixed(0)} L ${(x + s).toFixed(0)} ${(y + s * .6).toFixed(0)} Z" fill="${p.mount}" opacity=".85"/><path d="M ${(x - s * .3).toFixed(0)} ${(y - s * .45).toFixed(0)} L ${x.toFixed(0)} ${(y - s).toFixed(0)} L ${(x + s * .3).toFixed(0)} ${(y - s * .45).toFixed(0)} Z" fill="#f2efe6" opacity=".8"/>`;
        }
    } else if (style === 'modern') {
        for (let i = 0; i < 120; i++) {
            const x = Math.floor(r() * 20) * 50 + 6, y = Math.floor(r() * 20) * 50 + 6, w = 18 + r() * 24, h = 18 + r() * 24;
            out += `<rect x="${x}" y="${y}" width="${w.toFixed(0)}" height="${h.toFixed(0)}" rx="3" fill="#4a5868" opacity="${(.45 + r() * .4).toFixed(2)}"/>`;
        }
        for (let i = 0; i < 12; i++) out += `<circle cx="${(r() * 1000).toFixed(0)}" cy="${(r() * 1000).toFixed(0)}" r="${(14 + r() * 20).toFixed(0)}" fill="${p.forest}" opacity=".8"/>`;
    } else {
        for (let i = 0; i < 26; i++) {
            const x = r() * 1000, y = r() * 1000, s = 16 + r() * 22;
            const pts = Array.from({ length: 6 }, (_, k) => `${(x + s * Math.cos(k * Math.PI / 3)).toFixed(0)},${(y + s * Math.sin(k * Math.PI / 3)).toFixed(0)}`).join(' ');
            out += `<polygon points="${pts}" fill="none" stroke="${p.road}" stroke-width="1.2" opacity=".35"/>`;
        }
        for (let i = 0; i < 80; i++) out += `<circle cx="${(r() * 1000).toFixed(0)}" cy="${(r() * 1000).toFixed(0)}" r="${(r0() * 1.8 + .4).toFixed(1)}" fill="#fff" opacity="${(.2 + r() * .6).toFixed(2)}"/>`;
    }
    if (p.grid !== 'none') {
        for (let g = -500; g <= 1500; g += 50) out += `<path d="M ${g} -2000 V 3000 M -2000 ${g} H 3000" stroke="${p.grid}" stroke-width="${style === 'modern' ? 6 : 1}"/>`;
    }
    return out;
}

let pinScale = 1;

function pinSvg(node, kind, selected, isYou, style) {
    const p = PALETTE[style] || PALETTE.fantasy;
    const x = node.x * 10, y = node.y * 10;
    const col = PIN_TYPES[kind]?.color || '#b9a57a';
    const unknown = node.explored === false;
    const name = unknown ? 'Unknown Nearby' : node.name;
    const type = unknown ? 'UNKNOWN' : `${(node.pin || 'place').toUpperCase()}${node.kind ? ` · ${node.kind}` : ''}`;
    const w = Math.max(90, Math.min(210, Math.max(name.length * 7.6, type.length * 5.6) + 22));
    return `<g class="uie-pin ${selected ? 'sel' : ''}" data-node="${esc(node.id)}" transform="translate(${x.toFixed(1)} ${y.toFixed(1)})" role="button" aria-label="${esc(name)}"><g class="uie-pin-s" transform="scale(${pinScale.toFixed(3)})">
        <circle r="34" fill="transparent"/>
        ${isYou ? `<circle r="30" fill="none" stroke="#fff" stroke-width="2" opacity=".7"><animate attributeName="r" values="18;34;18" dur="2.4s" repeatCount="indefinite"/><animate attributeName="opacity" values=".8;0;.8" dur="2.4s" repeatCount="indefinite"/></circle>` : ''}
        <g class="uie-pin-head">
            <path d="M0 0 C -6 -12 -18 -18 -18 -32 A 18 18 0 1 1 18 -32 C 18 -18 6 -12 0 0 Z" fill="#141820" stroke="${col}" stroke-width="${selected ? 4 : 3}"/>
            <circle cx="0" cy="-32" r="11" fill="${col}" opacity="${unknown ? .5 : .95}"/>
            <text x="0" y="-27.5" text-anchor="middle" font-size="13" font-weight="800" fill="#141820">${esc(isYou ? PIN_GLYPH.you : PIN_GLYPH[kind] || '◆')}</text>
        </g>
        <g transform="translate(0 8)">
            <rect x="${(-w / 2).toFixed(0)}" y="0" width="${w.toFixed(0)}" height="${isYou ? 42 : 32}" rx="7" fill="${p.labelBg}" stroke="${selected ? col : 'rgba(0,0,0,.25)'}"/>
            ${isYou ? `<rect x="-16" y="-9" width="32" height="14" rx="4" fill="#fff"/><text x="0" y="1.5" text-anchor="middle" font-size="9" font-weight="900" fill="#111">YOU</text>` : ''}
            <text x="0" y="${isYou ? 20 : 14}" text-anchor="middle" font-size="12" font-weight="700" fill="${unknown ? '#9aa' : p.label}">${esc(name.length > 28 ? `${name.slice(0, 27)}…` : name)}</text>
            <text x="0" y="${isYou ? 34 : 26}" text-anchor="middle" font-size="8.5" font-weight="700" letter-spacing=".6" fill="${p.label}" opacity=".7">${esc(isYou ? 'YOU ARE HERE' : type.slice(0, 34))}</text>
        </g>
    </g></g>`;
}

// ---------------------------------------------------------------- panel

export function open(params = {}) {
    const sheet = openSheet({ id: 'map', title: 'Map', icon: 'fa-map-location-dot', className: 'uie-map', size: 'wide' });
    const s0 = S();
    const here0 = s0.map.nodes[s0.map.location];
    const view = {
        tier: params.tier || (here0?.tier === 'world' ? 'world' : here0?.tier || 'local'),
        focus: {},          // tier -> parent id override
        sel: null,
        mode: 'foot',
        vb: null,
    };
    // Fit the 1000x1000 map into the stage's aspect ratio (portrait phones get a tall view).
    const fitVb = () => {
        const svg = sheet.body.querySelector('svg');
        const r = svg?.getBoundingClientRect();
        const aspect = r && r.width > 0 && r.height > 0 ? r.height / r.width : 1;
        // Frame the visible pins (plus room for labels), never tighter than 420 units.
        const nodes = children(S().map, parentFor(view.tier), view.tier);
        let minX = 100, maxX = 900, minY = 100, maxY = 900;
        if (nodes.length) {
            minX = Math.min(...nodes.map(n => n.x * 10)) - 150; maxX = Math.max(...nodes.map(n => n.x * 10)) + 150;
            minY = Math.min(...nodes.map(n => n.y * 10)) - 160; maxY = Math.max(...nodes.map(n => n.y * 10)) + 140;
        }
        let w = Math.max(420, maxX - minX), h = Math.max(420, maxY - minY);
        if (h / w < aspect) h = w * aspect; else w = h / aspect;
        const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
        view.vb = { x: cx - w / 2, y: cy - h / 2, w, h };
    };
    // Pins keep a constant on-screen size whatever the zoom: scale = map units per CSS pixel.
    const updatePinScale = () => {
        const svg = sheet.body.querySelector('svg');
        const r = svg?.getBoundingClientRect();
        if (!r || !r.width || !view.vb) return;
        pinScale = Math.max(0.35, Math.min(4, Math.max(view.vb.w / r.width, view.vb.h / r.height) * 0.95));
        svg.querySelectorAll('.uie-pin-s').forEach(g => g.setAttribute('transform', `scale(${pinScale.toFixed(3)})`));
    };

    const parentFor = (tier) => {
        if (tier === 'world') return null;
        if (view.focus[tier] !== undefined) return view.focus[tier];
        const s = S();
        const up = TIERS[TIERS.indexOf(tier) - 1];
        return ancestorAtTier(s.map, s.map.location, up)?.id ?? (children(S().map, null, up)[0]?.id || null);
    };

    const layout = () => {
        sheet.body.innerHTML = `
            <div class="uie-map-bar"><div class="uie-map-top" role="tablist">${TIERS.map(t => `<button class="uie-tab ${view.tier === t ? 'active' : ''}" data-tier="${t}" role="tab">${esc(TIER_LABEL[t])}</button>`).join('')}</div>
            <div class="uie-map-tools">
                <select data-style aria-label="Map style">${Object.entries(STYLES).map(([k, v]) => opt(k, v, S().map.style === k)).join('')}</select>
                <button class="uie-btn uie-btn-sm" data-m="expand">${icon('fa-wand-magic-sparkles')} Ask AI To Expand</button>
                <button class="uie-btn uie-btn-sm" data-m="landmark">${icon('fa-location-pin')} Place a Landmark</button>
                <button class="uie-btn uie-btn-sm" data-m="here">${icon('fa-crosshairs')} Where am I</button>
            </div></div>
            <div class="uie-map-wrap">
                <div class="uie-map-stage">
                    <svg viewBox="0 0 1000 1000" preserveAspectRatio="xMidYMid meet" aria-label="Map"></svg>
                    <div class="uie-map-crumbs"></div>
                    <details class="uie-legend" ${matchMedia('(min-width: 700px) and (min-height: 620px)').matches ? 'open' : ''}><summary>Color legend</summary><ul>${['you', 'target', 'station', 'vehicle', 'danger', 'service', 'interior'].map(k => `<li><i style="--c:${PIN_TYPES[k].color}"></i>${esc(PIN_TYPES[k].label)}</li>`).join('')}</ul></details>
                    <div class="uie-map-zoom"><button class="uie-icon-btn" data-z="in" aria-label="Zoom in">${icon('fa-plus')}</button><button class="uie-icon-btn" data-z="out" aria-label="Zoom out">${icon('fa-minus')}</button><button class="uie-icon-btn" data-z="fit" aria-label="Fit">${icon('fa-expand')}</button></div>
                </div>
                <aside class="uie-map-side" aria-live="polite"></aside>
            </div>`;
        bindStage();
        fitVb();
        draw();
        // Refit once the sheet has real dimensions, and again on rotation / resize.
        const stage = sheet.body.querySelector('.uie-map-stage');
        let lastW = 0, lastH = 0;
        if ('ResizeObserver' in window) {
            const ro = new ResizeObserver(() => {
                const r = stage.getBoundingClientRect();
                if (!r.width || (Math.abs(r.width - lastW) < 2 && Math.abs(r.height - lastH) < 2)) return;
                lastW = r.width; lastH = r.height;
                fitVb();
                draw();
            });
            ro.observe(stage);
            sheet.onCleanup(() => ro.disconnect());
        }
    };

    const draw = () => {
        const s = S();
        const svg = sheet.body.querySelector('svg');
        if (!svg) return;
        const parent = parentFor(view.tier);
        const nodes = children(s.map, parent, view.tier);
        const youAnc = ancestorAtTier(s.map, s.map.location, view.tier);
        const style = s.map.style || 'fantasy';
        // roads between linked + nearest pairs
        let roads = '';
        const seen = new Set();
        for (const n of nodes) {
            for (const m of pathsFrom(s.map, n.id).slice(0, 2)) {
                if (m.parent !== n.parent) continue;
                const k = [n.id, m.id].sort().join('|');
                if (seen.has(k)) continue;
                seen.add(k);
                const dash = n.explored === false || m.explored === false ? 'stroke-dasharray="10 9"' : '';
                roads += `<path d="M ${n.x * 10} ${n.y * 10} Q ${((n.x + m.x) * 5 + (n.y - m.y) * 1.5).toFixed(0)} ${((n.y + m.y) * 5 + (m.x - n.x) * 1.5).toFixed(0)} ${m.x * 10} ${m.y * 10}" fill="none" stroke="${PALETTE[style].road}" stroke-width="5" stroke-linecap="round" opacity=".55" ${dash}/>`;
            }
        }
        const pins = nodes.sort((a, b) => a.y - b.y).map(n => {
            const isYou = youAnc?.id === n.id;
            const kind = isYou ? 'you' : s.map.target === n.id ? 'target' : n.explored === false ? 'unknown' : (n.pin || 'place');
            return pinSvg(n, kind, view.sel === n.id, isYou, style);
        }).join('');
        if (!view.vb) fitVb();
        svg.setAttribute('viewBox', `${view.vb.x} ${view.vb.y} ${view.vb.w} ${view.vb.h}`);
        const r0 = svg.getBoundingClientRect();
        if (r0.width) pinScale = Math.max(0.35, Math.min(4, Math.max(view.vb.w / r0.width, view.vb.h / r0.height) * 0.95));
        svg.innerHTML = `<g>${terrain(style, parent || 'root')}</g><g>${roads}</g><g>${pins}</g>${nodes.length ? '' : `<text x="500" y="480" text-anchor="middle" font-size="28" fill="${PALETTE[style].label}" opacity=".8">Nothing mapped here yet</text><text x="500" y="520" text-anchor="middle" font-size="18" fill="${PALETTE[style].label}" opacity=".6">Use “Ask AI To Expand” or “Place a Landmark”</text>`}`;

        const crumbs = sheet.body.querySelector('.uie-map-crumbs');
        const chain = parent ? ancestors(s.map, parent) : [];
        crumbs.innerHTML = chain.map(n => `<button data-crumb="${esc(n.id)}">${esc(n.name)}</button>`).join('');
        sheet.setTitle(`${TIER_LABEL[view.tier]} · ${parent ? s.map.nodes[parent]?.name || '' : 'World'}`);
        sheet.body.querySelectorAll('[data-tier]').forEach(b => b.classList.toggle('active', b.dataset.tier === view.tier));
        drawSide();
    };

    const drawSide = () => {
        const side = sheet.body.querySelector('.uie-map-side');
        const s = S();
        const node = s.map.nodes[view.sel];
        if (!node) { side.classList.remove('show'); side.innerHTML = ''; return; }
        side.classList.add('show');
        const unknown = node.explored === false;
        const here = s.map.location;
        const isHere = ancestors(s.map, here).some(a => a.id === node.id);
        const modes = modesFor(node);
        if (!modes.includes(view.mode)) view.mode = modes[0];
        const cost = travelCost(s.map, here, node.id, view.mode, s.weather.kind);
        const orgs = Object.values(s.orgs).filter(o => (o.influence || []).includes(node.id));
        const standing = orgs.length ? `${standingLabel(orgs[0].standing)} standing (${orgs[0].name})` : 'Neutral standing';
        const kids = children(s.map, node.id).length;
        const paths = pathsFrom(s.map, node.id).slice(0, 5);
        const energy = s.trackers.energy?.value;
        side.innerHTML = `
            <div class="uie-row uie-between"><h5>Destination</h5><button class="uie-icon-btn uie-side-close" data-m="unsel" aria-label="Close">${icon('fa-xmark')}</button></div>
            <h3>${esc(unknown ? 'Unknown Nearby' : node.name)}</h3>
            <div class="uie-muted">${esc(unknown ? 'Unexplored. Go there to find out.' : node.desc || (isHere ? `You are here: ${locationPath(s.map, here)}` : 'No description yet.'))}</div>
            <p class="uie-big">${esc(unknown ? 'Customs unknown' : node.customs || 'Local customs apply')}</p>
            <h5>Reputation</h5><p class="uie-big">${esc(standing)}</p>
            <h5>Travel access</h5>
            ${isHere ? `<p class="uie-big">${icon('fa-location-dot')} You are here</p>` : `
                <select data-mode aria-label="Travel mode">${modes.map(m => opt(m, TRAVEL_MODES[m].label, view.mode === m)).join('')}</select>
                <p>About ${esc(humanDuration(cost.minutes))} away / ${esc(cost.energy)} energy${cost.fare ? ` / ${esc(cost.fare)} ${esc(s.player.currencyName)}` : ''}${energy !== undefined && energy < cost.energy ? ` <span class="uie-tag bad">too tired</span>` : ''}</p>
                <button class="uie-btn uie-btn-primary" data-m="move">${icon('fa-person-walking-arrow-right')} Move To Area</button>`}
            ${TIERS.indexOf(node.tier) < TIERS.length - 1 ? `<button class="uie-btn" data-m="openarea">${icon('fa-magnifying-glass-plus')} Open Area${kids ? ` (${kids})` : ''}</button>` : ''}
            <button class="uie-btn" data-m="target">${icon('fa-bullseye')} ${s.map.target === node.id ? 'Clear target' : 'Set as target'}</button>
            <div class="uie-row"><button class="uie-btn" data-m="edit">${icon('fa-pen')} Edit</button><button class="uie-btn" data-m="del">${icon('fa-trash')}</button></div>
            ${st.sdAvailable() && !unknown ? `<button class="uie-btn" data-m="scene">${icon('fa-image')} Scene image</button>` : ''}
            ${node.img ? `<img src="${esc(node.img)}" alt="" style="width:100%;border-radius:12px;margin-top:10px">` : ''}
            <div class="uie-paths"><h5>Paths from here</h5>${paths.length ? paths.map(p => {
                const c = travelCost(s.map, node.id, p.id, 'foot', s.weather.kind);
                return `<button class="uie-btn uie-btn-sm" data-go="${esc(p.id)}"><span>${esc(p.explored === false ? 'Unknown Nearby' : p.name)}</span><small>${esc(humanDuration(c.minutes))}</small></button>`;
            }).join('') : '<p class="uie-muted">No known paths.</p>'}</div>`;
    };

    // ---------------------------------------------------------------- pan / zoom

    const bindStage = () => {
        const stage = sheet.body.querySelector('.uie-map-stage');
        const svg = stage.querySelector('svg');
        const pts = new Map();
        let start = null, moved = false;
        const toSvg = (dx, dy) => {
            const r = svg.getBoundingClientRect();
            const scale = Math.max(view.vb.w / r.width, view.vb.h / r.height);
            return [dx * scale, dy * scale];
        };
        const applyVb = () => { svg.setAttribute('viewBox', `${view.vb.x} ${view.vb.y} ${view.vb.w} ${view.vb.h}`); updatePinScale(); };
        const zoomAt = (factor, cx = 0.5, cy = 0.5) => {
            const w = Math.min(3000, Math.max(160, view.vb.w * factor));
            const h = w * (view.vb.h / view.vb.w);
            view.vb.x += (view.vb.w - w) * cx;
            view.vb.y += (view.vb.h - h) * cy;
            view.vb.w = w; view.vb.h = h;
            applyVb();
        };
        svg.addEventListener('pointerdown', (e) => {
            svg.setPointerCapture?.(e.pointerId);
            pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
            moved = false;
            start = { vb: { ...view.vb }, pts: new Map([...pts].map(([k, v]) => [k, { ...v }])) };
        });
        svg.addEventListener('pointermove', (e) => {
            if (!pts.has(e.pointerId) || !start) return;
            pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
            const arr = [...pts.values()], st0 = [...start.pts.values()];
            if (arr.length === 1 && st0.length === 1) {
                const dx = arr[0].x - st0[0].x, dy = arr[0].y - st0[0].y;
                if (Math.hypot(dx, dy) > 6) moved = true;
                if (!moved) return;
                const [sx, sy] = toSvg(dx, dy);
                view.vb.x = start.vb.x - sx; view.vb.y = start.vb.y - sy;
                applyVb();
            } else if (arr.length >= 2 && st0.length >= 2) {
                moved = true;
                const d0 = Math.hypot(st0[0].x - st0[1].x, st0[0].y - st0[1].y) || 1;
                const d1 = Math.hypot(arr[0].x - arr[1].x, arr[0].y - arr[1].y) || 1;
                const r = svg.getBoundingClientRect();
                const mx = ((arr[0].x + arr[1].x) / 2 - r.left) / r.width, my = ((arr[0].y + arr[1].y) / 2 - r.top) / r.height;
                view.vb = { ...start.vb };
                zoomAt(d0 / d1, mx, my);
            }
        });
        const end = (e) => {
            const wasTap = !moved && pts.size === 1;
            pts.delete(e.pointerId);
            if (pts.size === 0) start = null;
            else start = { vb: { ...view.vb }, pts: new Map([...pts].map(([k, v]) => [k, { ...v }])) };
            if (wasTap && e.type === 'pointerup') {
                const pin = document.elementFromPoint(e.clientX, e.clientY)?.closest?.('[data-node]');
                if (pin) { view.sel = pin.dataset.node; draw(); }
                else if (view.sel) { view.sel = null; draw(); }
            }
        };
        svg.addEventListener('pointerup', end);
        svg.addEventListener('pointercancel', end);
        svg.addEventListener('wheel', (e) => {
            e.preventDefault();
            const r = svg.getBoundingClientRect();
            zoomAt(e.deltaY > 0 ? 1.12 : 1 / 1.12, (e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
        }, { passive: false });
        stage.querySelector('.uie-map-zoom').addEventListener('click', (e) => {
            const z = e.target.closest('[data-z]')?.dataset.z;
            if (z === 'in') zoomAt(1 / 1.3);
            if (z === 'out') zoomAt(1.3);
            if (z === 'fit') { fitVb(); applyVb(); }
        });
    };

    // ---------------------------------------------------------------- actions

    const addPlaces = (places, parent, tier, explored) => {
        mutate(s => {
            for (const p of places.slice(0, 8)) {
                const name = str(p.name, 60);
                if (!name) continue;
                if (Object.values(s.map.nodes).some(n => n.parent === parent && n.name.toLowerCase() === name.toLowerCase())) continue;
                const id = uid('loc');
                const pos = placeNode(s.map, parent, name);
                s.map.nodes[id] = { id, name, tier, parent, x: pos.x, y: pos.y, pin: p.danger ? 'danger' : guessPin(p.kind, name), kind: str(p.kind, 40), desc: str(p.desc, 300), customs: str(p.customs, 160), explored, links: [] };
            }
        });
    };

    sheet.body.addEventListener('click', async (e) => {
        try {
            const tierBtn = e.target.closest('[data-tier]');
            if (tierBtn) { view.tier = tierBtn.dataset.tier; view.sel = null; fitVb(); draw(); return; }
            const crumb = e.target.closest('[data-crumb]');
            if (crumb) {
                const n = S().map.nodes[crumb.dataset.crumb];
                if (n) { view.tier = n.tier; view.focus[n.tier] = n.parent ?? null; view.sel = n.id; fitVb(); draw(); }
                return;
            }
            const go = e.target.closest('[data-go]');
            if (go) { view.sel = go.dataset.go; draw(); return; }
            const m = e.target.closest('[data-m]')?.dataset.m;
            if (!m) return;
            const s = S();
            const node = s.map.nodes[view.sel];
            switch (m) {
                case 'unsel': view.sel = null; draw(); break;
                case 'here': {
                    const here = s.map.nodes[s.map.location];
                    view.tier = here.tier; view.focus[here.tier] = here.parent ?? null; view.sel = here.id; fitVb(); draw();
                    break;
                }
                case 'move': {
                    if (!node) return;
                    const cost = travelCost(s.map, s.map.location, node.id, view.mode, s.weather.kind);
                    if (s.trackers.energy && s.trackers.energy.value < cost.energy && !await confirmDialog('Exhausted', `You only have ${Math.round(s.trackers.energy.value)} energy and this trip costs ${cost.energy}. Go anyway?`, { okLabel: 'Go anyway' })) return;
                    const wasUnknown = node.explored === false;
                    userOps([{ op: 'travel.go', to: node.id, mode: view.mode }]);
                    if (wasUnknown) mutate(st2 => { st2.map.nodes[node.id].explored = true; });
                    if (settingsGet().narratorNotes) st.narrate(`*${st.userName()} travels to ${node.name} by ${TRAVEL_MODES[view.mode].label.toLowerCase()} (${humanDuration(cost.minutes)}).*`);
                    draw();
                    break;
                }
                case 'openarea': {
                    if (!node) return;
                    const t = childTier(node.tier);
                    view.tier = t; view.focus[t] = node.id; view.sel = null; fitVb(); draw();
                    break;
                }
                case 'target': mutate(st2 => { st2.map.target = st2.map.target === node.id ? null : node.id; }); draw(); break;
                case 'edit': await editNode(node); draw(); break;
                case 'del': {
                    if (!node) return;
                    if (node.id === s.map.location || ancestors(s.map, s.map.location).some(a => a.id === node.id)) { globalThis.toastr?.warning?.('You cannot delete where you are standing.', 'UIE'); return; }
                    if (children(s.map, node.id).length) { globalThis.toastr?.warning?.('Delete the places inside it first.', 'UIE'); return; }
                    if (!await confirmDialog('Delete place', `Remove ${node.name} from the map?`, { okLabel: 'Delete', danger: true })) return;
                    mutate(st2 => { delete st2.map.nodes[node.id]; Object.values(st2.map.nodes).forEach(n => { n.links = (n.links || []).filter(l => l !== node.id); }); });
                    view.sel = null; draw();
                    break;
                }
                case 'scene': {
                    globalThis.toastr?.info?.('Generating scene…', 'UIE');
                    const url = await st.generateImage(`scenery, ${node.name}, ${node.kind || ''}, ${node.desc || ''}, ${STYLES[s.map.style]} setting, wide shot`);
                    if (url) mutate(st2 => { st2.map.nodes[node.id].img = url; });
                    break;
                }
                case 'landmark': {
                    const parent = parentFor(view.tier);
                    const v = await formDialog('Place a Landmark', landmarkForm({}), { okLabel: 'Place' });
                    if (!v?.name?.trim()) return;
                    const cx = Math.min(95, Math.max(5, (view.vb.x + view.vb.w / 2) / 10)), cy = Math.min(95, Math.max(5, (view.vb.y + view.vb.h / 2) / 10));
                    let id;
                    mutate(st2 => {
                        id = uid('loc');
                        const pos = Object.values(st2.map.nodes).some(n => n.parent === parent && Math.hypot(n.x - cx, n.y - cy) < 8) ? placeNode(st2.map, parent, v.name) : { x: Math.round(cx), y: Math.round(cy) };
                        st2.map.nodes[id] = { id, name: str(v.name, 60), tier: view.tier, parent, x: pos.x, y: pos.y, pin: v.pin || 'place', kind: str(v.kind, 40), desc: str(v.desc, 300), customs: str(v.customs, 160), explored: true, links: [] };
                    });
                    view.sel = id; draw();
                    break;
                }
                case 'expand': {
                    const parent = parentFor(view.tier);
                    const place = parent ? s.map.nodes[parent]?.name : 'the world';
                    const btn = e.target.closest('[data-m]');
                    btn.disabled = true;
                    btn.innerHTML = `${icon('fa-spinner', 'fa-spin')} Expanding…`;
                    try {
                        const { value } = await genJson(renderPrompt('mapExpand', {
                            count: 4, place, tier: TIER_LABEL[view.tier], style: STYLES[s.map.style],
                            existing: children(s.map, parent).map(n => n.name).join(', ') || 'none', messages: recentMessages(2),
                        }), { label: 'Map expand' });
                        const places = Array.isArray(value?.places) ? value.places : Array.isArray(value) ? value : [];
                        if (!places.length) throw new Error('The model returned no places.');
                        addPlaces(places, parent, view.tier, false);
                        globalThis.toastr?.success?.(`${places.length} new places nearby`, 'UIE');
                    } finally { fitVb(); draw(); layoutToolsReset(); }
                    break;
                }
            }
        } catch (err) { reportError(err); }
    });
    const layoutToolsReset = () => {
        const b = sheet.body.querySelector('[data-m=expand]');
        if (b) { b.disabled = false; b.innerHTML = `${icon('fa-wand-magic-sparkles')} Ask AI To Expand`; }
    };
    sheet.body.addEventListener('change', (e) => {
        if (e.target.matches('[data-style]')) { mutate(s => { s.map.style = e.target.value; }); draw(); }
        if (e.target.matches('[data-mode]')) { view.mode = e.target.value; drawSide(); }
    });
    sheet.onCleanup(bus.on((r) => { if (r !== 'helper') draw(); }));
    layout();
    if (params.select) { view.sel = params.select; draw(); }
    return sheet;
}

function landmarkForm(n) {
    return `
        <label class="uie-field"><span>Name</span><input name="name" value="${esc(n.name || '')}" maxlength="60" required></label>
        <div class="uie-grid2">
            <label class="uie-field"><span>Pin type</span><select name="pin">${Object.entries(PIN_TYPES).filter(([k]) => !['you', 'target', 'unknown'].includes(k)).map(([k, v]) => opt(k, v.label, (n.pin || 'place') === k)).join('')}</select></label>
            <label class="uie-field"><span>Kind</span><input name="kind" value="${esc(n.kind || '')}" placeholder="market, wilds/forest, gate…"></label>
        </div>
        <label class="uie-field"><span>Description</span><textarea name="desc" rows="2">${esc(n.desc || '')}</textarea></label>
        <label class="uie-field"><span>Local customs</span><input name="customs" value="${esc(n.customs || '')}"></label>`;
}

async function editNode(node) {
    if (!node) return;
    const v = await formDialog(`Edit ${node.name}`, landmarkForm(node) + `<label class="uie-switch"><input type="checkbox" name="explored" ${node.explored !== false ? 'checked' : ''}><span></span> Explored</label>`);
    if (!v) return;
    mutate(s => {
        const n = s.map.nodes[node.id];
        Object.assign(n, { name: str(v.name, 60) || n.name, pin: v.pin, kind: str(v.kind, 40), desc: str(v.desc, 300), customs: str(v.customs, 160), explored: !!v.explored });
    });
}
