// Map graph + travel rules (pure). Nodes live in state.map.nodes keyed by id:
// { id, name, tier, parent, x, y, pin, kind, desc, customs, explored, links: [] }
// Tier order: world > region > local > nearby > area. A node's parent is one tier up.
// x/y are 0..100 coordinates inside the parent's canvas.

import { clamp, num, rng, hash } from './util.js';
import { findByName } from './dedupe.js';

export const TIERS = ['world', 'region', 'local', 'nearby', 'area'];
export const TIER_LABEL = { world: 'World', region: 'Region', local: 'Local', nearby: 'Nearby', area: 'Area' };

// Minutes of walking per 1 unit of canvas distance, per tier.
export const TIER_SCALE = { world: 90, region: 18, local: 1.2, nearby: 0.35, area: 0.08 };

export const PIN_TYPES = {
    you: { label: 'You', color: '#ffffff' },
    target: { label: 'Target', color: '#3fd1c0' },
    station: { label: 'Station / Dock', color: '#e3b55a' },
    vehicle: { label: 'Vehicle / Ship', color: '#5d9cf0' },
    danger: { label: 'Danger', color: '#ef5f5f' },
    service: { label: 'Service', color: '#57c784' },
    interior: { label: 'Interior', color: '#e8e2d4' },
    place: { label: 'Place', color: '#b9a57a' },
    unknown: { label: 'Unknown', color: '#8a8f99' },
};

export const TRAVEL_MODES = {
    foot: { label: 'Foot Road', icon: 'fa-person-walking', speed: 1, energyPerMin: 0.4 },
    trail: { label: 'Wild Trail', icon: 'fa-person-hiking', speed: 1.35, energyPerMin: 0.55 },
    mount: { label: 'Mount', icon: 'fa-horse', speed: 0.45, energyPerMin: 0.15 },
    vehicle: { label: 'Vehicle', icon: 'fa-car', speed: 0.25, energyPerMin: 0.05 },
    transit: { label: 'Public Transit', icon: 'fa-bus', speed: 0.35, energyPerMin: 0.05, fare: 2 },
    boat: { label: 'Boat', icon: 'fa-ship', speed: 0.6, energyPerMin: 0.08, fare: 5 },
    flight: { label: 'Flight', icon: 'fa-plane', speed: 0.08, energyPerMin: 0.02, fare: 25 },
    portal: { label: 'Gate', icon: 'fa-circle-nodes', speed: 0.02, energyPerMin: 0.5, fare: 10 },
};

export function tierIndex(tier) {
    const i = TIERS.indexOf(tier);
    return i < 0 ? 2 : i;
}

export function childTier(tier) {
    return TIERS[Math.min(TIERS.length - 1, tierIndex(tier) + 1)];
}

export function nodeList(map) {
    return Object.values(map?.nodes || {});
}

export function children(map, parentId, tier = null) {
    return nodeList(map).filter(n => (n.parent || null) === (parentId || null) && (!tier || n.tier === tier));
}

export function ancestors(map, id) {
    const out = [];
    let cur = map?.nodes?.[id];
    let guard = 0;
    while (cur && guard++ < 10) {
        out.unshift(cur);
        cur = cur.parent ? map.nodes[cur.parent] : null;
    }
    return out; // root..self
}

/** Ancestor of `id` (or itself) at the given tier, or null. */
export function ancestorAtTier(map, id, tier) {
    return ancestors(map, id).find(n => n.tier === tier) || null;
}

export function locationPath(map, id) {
    return ancestors(map, id).map(n => n.name).join(' › ');
}

export function distance(a, b) {
    return Math.hypot(num(a?.x) - num(b?.x), num(a?.y) - num(b?.y));
}

/**
 * Travel cost between two sibling nodes (same parent), or between arbitrary nodes by
 * climbing to their common ancestor. Returns {minutes, energy, fare, mode}.
 */
export function travelCost(map, fromId, toId, modeKey = 'foot', weather = 'clear') {
    const mode = TRAVEL_MODES[modeKey] || TRAVEL_MODES.foot;
    const nodes = map?.nodes || {};
    const from = nodes[fromId], to = nodes[toId];
    if (!from || !to || fromId === toId) return { minutes: 0, energy: 0, fare: 0, mode: modeKey };

    // Walk both chains to the common ancestor and sum sibling-level distances at each tier.
    const aChain = ancestors(map, fromId), bChain = ancestors(map, toId);
    let i = 0;
    while (i < aChain.length && i < bChain.length && aChain[i].id === bChain[i].id) i++;
    let minutes = 0;
    const a = aChain[i], b = bChain[i];
    if (a && b) {
        minutes += distance(a, b) * (TIER_SCALE[a.tier] ?? 1);
    }
    // Extra "last mile" inside each branch: getting from deep node to its branch root.
    for (let k = i + 1; k < aChain.length; k++) minutes += 25 * (TIER_SCALE[aChain[k].tier] ?? 1);
    for (let k = i + 1; k < bChain.length; k++) minutes += 25 * (TIER_SCALE[bChain[k].tier] ?? 1);

    const weatherMult = /storm|snow|blizzard/.test(weather) ? 1.4 : /rain|fog/.test(weather) ? 1.15 : 1;
    minutes = Math.max(1, Math.round(minutes * mode.speed * weatherMult));
    const energy = Math.max(0, Math.round(minutes * mode.energyPerMin));
    const fare = mode.fare ? Math.round(mode.fare + minutes * 0.05) : 0;
    return { minutes, energy, fare, mode: modeKey };
}

/** Modes available from a node (default foot + whatever the node/edge advertises). */
export function modesFor(node) {
    const list = ['foot'];
    const kind = String(node?.kind || '').toLowerCase();
    if (/wild|forest|mountain|marsh|trail/.test(kind)) list.push('trail');
    if (node?.pin === 'station' || /station|dock|port|terminal/.test(kind)) list.push('transit', 'boat');
    if (node?.pin === 'vehicle') list.push('vehicle');
    if (/gate|portal/.test(kind)) list.push('portal');
    return [...new Set(list)];
}

/** Find a place by (fuzzy) name. */
export function findNode(map, name) {
    if (!name) return null;
    const direct = map?.nodes?.[name];
    if (direct) return direct;
    return findByName(nodeList(map), name, 0.8);
}

/**
 * Pick a free spot for a new child pin (deterministic by seed), avoiding existing siblings.
 */
export function placeNode(map, parentId, seed) {
    const sibs = children(map, parentId);
    const r = rng(hash(`${parentId}|${seed}|${sibs.length}`));
    let best = { x: 50, y: 50 }, bestD = -1;
    for (let tries = 0; tries < 24; tries++) {
        const p = { x: 10 + r() * 80, y: 12 + r() * 76 };
        const d = sibs.length ? Math.min(...sibs.map(s => distance(s, p))) : 100;
        if (d > bestD) { bestD = d; best = p; }
        if (d > 18) break;
    }
    return { x: Math.round(best.x * 10) / 10, y: Math.round(best.y * 10) / 10 };
}

/** Sibling nodes reachable from here: explicit links first, else nearest three siblings. */
export function pathsFrom(map, id) {
    const node = map?.nodes?.[id];
    if (!node) return [];
    const sibs = children(map, node.parent || null).filter(n => n.id !== id);
    const linked = (node.links || []).map(l => map.nodes[l]).filter(Boolean);
    const near = sibs.sort((a, b) => distance(node, a) - distance(node, b)).slice(0, 3);
    const out = [...linked];
    for (const n of near) if (!out.includes(n)) out.push(n);
    return out;
}

export function clampCoord(v) {
    return clamp(v, 2, 98);
}

/** Pin type from free-text kind (used by AI expand + location.move). */
export function guessPin(kind = '', name = '') {
    const s = `${kind} ${name}`.toLowerCase();
    if (/danger|monster|ruin|lair|den|cave|haunt|battle|bandit|hostile/.test(s)) return 'danger';
    if (/station|dock|port|harbor|harbour|terminal|airport|gate|stop/.test(s)) return 'station';
    if (/ship|car|vehicle|train|carriage|boat/.test(s)) return 'vehicle';
    if (/shop|store|inn|tavern|clinic|hospital|market|bank|smith|cafe|café|restaurant|bar|guild|temple/.test(s)) return 'service';
    if (/room|hall|interior|house|home|apartment|office|studio|chamber|basement|kitchen|bedroom/.test(s)) return 'interior';
    return 'place';
}
