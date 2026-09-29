// Op whitelist, validation/clamping, and deterministic application.
// Every change the AI proposes is expressed as an op; code decides the actual numbers.

import { clamp, num, str, text, uid, isPlainObject, deepClone } from './util.js';
import { Tx } from './tx.js';
import { findByName, mergeNames, normalizeName } from './dedupe.js';
import { decayTrackers, guessCategory, defaultEffects, ITEM_CATEGORIES, isConsumable, xpForLevel, defaultSlot, ACTIVITIES } from './rules.js';
import { findNode, placeNode, travelCost, guessPin, childTier, TIERS } from './map.js';
import { toParts, isoDate, dateToMinutes, humanDuration } from './time.js';
import { createBattle } from './battle.js';

const ALIASES = {
    add_item: 'item.add', additem: 'item.add', 'inventory.add': 'item.add', remove_item: 'item.remove', 'inventory.remove': 'item.remove',
    advance_time: 'time.advance', 'time.pass': 'time.advance', 'clock.advance': 'time.advance',
    'tracker.change': 'tracker.delta', 'npc.add': 'npc.upsert', 'npc.update': 'npc.upsert', 'npc.create': 'npc.upsert',
    'location.set': 'location.move', 'move': 'location.move', 'travel': 'location.move', 'place.add': 'location.add',
    'quest.create': 'quest.add', 'quest.new': 'quest.add', 'fact.add': 'databank.add', 'memory.add': 'databank.add',
    'money.delta': 'currency.delta', 'gold.delta': 'currency.delta', 'currency.add': 'currency.delta',
    'relationship.delta': 'rel.delta', 'social.delta': 'rel.delta', 'status.apply': 'status.add', 'effect.add': 'status.add',
    'hp.delta': 'bar.delta', 'stat.delta': 'bar.delta', 'faction.standing': 'org.standing', 'org.add': 'org.upsert',
};

/** Ops the AI may emit. UI-only ops (item.equip, activity.do, travel.go…) are not listed. */
export const AI_OPS = new Set([
    'time.advance', 'weather.set', 'item.add', 'item.remove', 'item.use', 'currency.delta',
    'tracker.delta', 'tracker.set', 'bar.delta', 'status.add', 'status.remove',
    'npc.upsert', 'npc.move', 'rel.delta', 'rel.memory', 'org.upsert', 'org.standing', 'org.runin',
    'location.move', 'location.add', 'quest.add', 'quest.update', 'databank.add', 'battle.start', 'event.add',
]);

export const USER_OPS = new Set([...AI_OPS, 'item.equip', 'item.drop', 'item.give', 'activity.do', 'travel.go']);

const WEATHER = ['clear', 'sunny', 'cloudy', 'overcast', 'rain', 'storm', 'snow', 'fog', 'wind', 'heat', 'blizzard', 'drizzle', 'ash', 'aurora'];

const s60 = (v) => str(v, 60);
const s120 = (v) => str(v, 120);
const intIn = (v, lo, hi, d) => {
    const n = Math.round(num(v, d));
    return clamp(n, lo, hi);
};

/**
 * Validate + normalize a single raw op. Returns [op|null, reason].
 * @param {any} raw
 * @param {Set<string>} allowed
 */
export function validateOp(raw, allowed = AI_OPS) {
    if (!isPlainObject(raw)) return [null, 'not an object'];
    let name = String(raw.op ?? raw.type ?? raw.action ?? '').trim().toLowerCase().replace(/\s+/g, '');
    name = ALIASES[name] || ALIASES[name.replace(/\./g, '_')] || name;
    if (!allowed.has(name)) return [null, `op "${name}" not allowed`];
    const o = { op: name };
    switch (name) {
        case 'time.advance': {
            let m = num(raw.minutes ?? raw.value ?? raw.min, NaN);
            if (!Number.isFinite(m) && raw.hours !== undefined) m = num(raw.hours) * 60;
            if (!Number.isFinite(m) || m <= 0) return [null, 'minutes missing'];
            o.minutes = intIn(m, 1, 10080, 0);
            break;
        }
        case 'weather.set': {
            const k = s60(raw.kind ?? raw.weather ?? raw.value).toLowerCase();
            if (!k) return [null, 'kind missing'];
            o.kind = WEATHER.find(w => k.includes(w)) || k.slice(0, 24);
            if (raw.temp !== undefined) o.temp = intIn(raw.temp, -60, 60, 20);
            break;
        }
        case 'item.add': case 'item.remove': case 'item.use': case 'item.equip': case 'item.drop': case 'item.give': {
            o.name = s60(raw.name ?? raw.item);
            if (!o.name) return [null, 'item name missing'];
            o.qty = intIn(raw.qty ?? raw.quantity ?? raw.amount ?? 1, 1, 999, 1);
            if (name === 'item.add') {
                const cat = String(raw.cat ?? raw.category ?? '').toLowerCase();
                o.cat = ITEM_CATEGORIES.includes(cat) ? cat : guessCategory(o.name);
                if (raw.desc ?? raw.description) o.desc = text(raw.desc ?? raw.description, 400);
                if (raw.icon) o.icon = str(raw.icon, 8);
                if (isPlainObject(raw.effects)) o.effects = cleanEffects(raw.effects);
                if (Array.isArray(raw.tags)) o.tags = raw.tags.map(s60).filter(Boolean).slice(0, 5);
            }
            if (name === 'item.equip') o.on = raw.on !== false;
            if (name === 'item.give') o.to = s60(raw.to);
            if (raw.id) o.id = s60(raw.id);
            break;
        }
        case 'currency.delta': {
            const a = num(raw.amount ?? raw.value ?? raw.delta, NaN);
            if (!Number.isFinite(a) || a === 0) return [null, 'amount missing'];
            o.amount = clamp(Math.round(a), -1e6, 1e6);
            break;
        }
        case 'tracker.delta': case 'tracker.set': {
            o.id = s60(raw.id ?? raw.tracker ?? raw.name).toLowerCase();
            if (!o.id) return [null, 'tracker id missing'];
            const v = num(raw.value ?? raw.delta ?? raw.amount, NaN);
            if (!Number.isFinite(v)) return [null, 'value missing'];
            o.value = name === 'tracker.set' ? clamp(v, -1000, 1000) : clamp(v, -100, 100);
            break;
        }
        case 'bar.delta': {
            o.id = s60(raw.id ?? raw.bar ?? raw.stat ?? (raw.op === 'hp.delta' ? 'hp' : '')).toLowerCase();
            if (!o.id) return [null, 'bar id missing'];
            const v = num(raw.value ?? raw.delta ?? raw.amount, NaN);
            if (!Number.isFinite(v) || v === 0) return [null, 'value missing'];
            o.value = clamp(Math.round(v), -9999, 9999);
            break;
        }
        case 'status.add': case 'status.remove': {
            o.name = s60(raw.name ?? raw.status ?? raw.effect);
            if (!o.name) return [null, 'status name missing'];
            if (name === 'status.add') {
                if (raw.desc) o.desc = s120(raw.desc);
                if (raw.minutes !== undefined) o.minutes = intIn(raw.minutes, 1, 100000, 60);
            }
            break;
        }
        case 'npc.upsert': case 'npc.move': case 'rel.delta': case 'rel.memory': {
            o.name = s60(raw.name ?? raw.npc ?? raw.character);
            if (!o.name) return [null, 'npc name missing'];
            if (name === 'npc.upsert') {
                for (const k of ['role', 'title', 'location', 'activity']) if (raw[k] !== undefined) o[k] = s120(raw[k]);
                for (const k of ['appearance', 'personality', 'notes']) if (raw[k] !== undefined) o[k] = text(raw[k], 600);
                if (raw.age !== undefined) o.age = s60(raw.age);
                if (raw.present !== undefined) o.present = !!raw.present;
            }
            if (name === 'npc.move') { o.to = s120(raw.to ?? raw.location); if (!o.to) return [null, 'destination missing']; }
            if (name === 'rel.delta') {
                let any = false;
                for (const k of ['affection', 'trust', 'standing']) {
                    if (raw[k] !== undefined && Number.isFinite(num(raw[k], NaN))) { o[k] = clamp(Math.round(num(raw[k])), -50, 50); any = true; }
                }
                if (!any) return [null, 'no deltas'];
            }
            if (name === 'rel.memory') { o.text = s120(raw.text ?? raw.memory); if (!o.text) return [null, 'text missing']; }
            break;
        }
        case 'org.upsert': case 'org.standing': case 'org.runin': {
            o.org = s60(raw.org ?? raw.name ?? raw.faction);
            if (!o.org) return [null, 'org missing'];
            if (name === 'org.upsert') for (const k of ['type', 'purpose', 'location']) if (raw[k] !== undefined) o[k] = s120(raw[k]);
            if (name === 'org.standing') {
                const d = num(raw.delta ?? raw.value ?? raw.amount, NaN);
                if (!Number.isFinite(d) || d === 0) return [null, 'delta missing'];
                o.delta = clamp(Math.round(d), -50, 50);
            }
            if (name === 'org.runin') { o.text = s120(raw.text ?? raw.event); if (!o.text) return [null, 'text missing']; }
            break;
        }
        case 'location.move': case 'location.add': case 'travel.go': {
            o.to = s60(raw.to ?? raw.name ?? raw.location ?? raw.id);
            if (!o.to) return [null, 'location missing'];
            if (raw.kind) o.kind = s60(raw.kind);
            if (raw.desc) o.desc = s120(raw.desc);
            if (raw.mode) o.mode = s60(raw.mode);
            if (raw.tier && TIERS.includes(raw.tier)) o.tier = raw.tier;
            break;
        }
        case 'quest.add': case 'quest.update': {
            o.title = s120(raw.title ?? raw.name ?? raw.quest);
            if (!o.title) return [null, 'quest title missing'];
            if (raw.desc ?? raw.description) o.desc = text(raw.desc ?? raw.description, 600);
            if (name === 'quest.add' && Array.isArray(raw.objectives)) o.objectives = raw.objectives.map(s120).filter(Boolean).slice(0, 8);
            if (name === 'quest.update') {
                const st = String(raw.status ?? '').toLowerCase();
                if (['active', 'done', 'completed', 'failed'].includes(st)) o.status = st === 'completed' ? 'done' : st;
                if (raw.objective) { o.objective = s120(raw.objective); o.done = raw.done !== false; }
            }
            break;
        }
        case 'databank.add': {
            o.title = s120(raw.title ?? raw.name ?? raw.fact);
            o.text = text(raw.text ?? raw.content ?? raw.fact ?? '', 600);
            if (!o.title && !o.text) return [null, 'empty fact'];
            if (!o.title) o.title = o.text.slice(0, 60);
            o.tags = (Array.isArray(raw.tags) ? raw.tags : []).map(s60).filter(Boolean).slice(0, 6);
            break;
        }
        case 'battle.start': {
            const en = Array.isArray(raw.enemies) ? raw.enemies : [];
            o.enemies = en.slice(0, 6).map((e, i) => ({
                name: s60(isPlainObject(e) ? e.name : e) || `Enemy ${i + 1}`,
                hp: intIn(e?.hp, 1, 999, 30), atk: intIn(e?.atk, 0, 99, 7), def: intIn(e?.def, 0, 99, 3), spd: intIn(e?.spd, 0, 99, 5),
            }));
            if (!o.enemies.length) return [null, 'no enemies'];
            break;
        }
        case 'event.add': {
            o.title = s120(raw.title ?? raw.name);
            if (!o.title) return [null, 'title missing'];
            o.inDays = intIn(raw.inDays ?? raw.days ?? 0, 0, 3650, 0);
            o.type = ['event', 'birthday', 'reminder'].includes(raw.type) ? raw.type : 'event';
            break;
        }
        case 'activity.do': {
            o.id = s60(raw.id ?? raw.activity);
            if (!ACTIVITIES[o.id]) return [null, 'unknown activity'];
            break;
        }
        default: return [null, 'unhandled'];
    }
    return [o, ''];
}

export function validateOps(list, allowed = AI_OPS, max = 40) {
    const ops = [], rejected = [];
    for (const raw of (Array.isArray(list) ? list : []).slice(0, max)) {
        const [op, reason] = validateOp(raw, allowed);
        if (op) ops.push(op); else rejected.push({ raw, reason });
    }
    return { ops, rejected };
}

function cleanEffects(e) {
    const out = {};
    for (const [k, v] of Object.entries(e || {})) {
        const n = num(v, NaN);
        if (Number.isFinite(n)) out[str(k, 24).toLowerCase()] = clamp(Math.round(n), -100, 100);
    }
    return out;
}

// ------------------------------------------------------------------ application

function findItem(state, name, id) {
    if (id && state.inventory[id]) return state.inventory[id];
    const items = Object.values(state.inventory);
    const n = normalizeName(name);
    return items.find(i => normalizeName(i.name) === n) || findByName(items, name, 0.8);
}

function findNpc(state, name) {
    return findByName(Object.values(state.npcs), name, 0.75);
}

function findOrg(state, name) {
    return findByName(Object.values(state.orgs), name, 0.8);
}

function findQuest(state, title) {
    return findByName(Object.values(state.quests).map(q => ({ ...q, name: q.title })), title, 0.7);
}

const fmtDelta = (v) => (v > 0 ? `+${v}` : `${v}`);

/** Apply a numeric effect map ({hunger: 20, hp: 10, energy: -3}) to trackers/bars. */
function applyEffects(tx, state, effects, changes, label = '') {
    for (const [k, v] of Object.entries(effects || {})) {
        if (state.trackers[k]) {
            const t = state.trackers[k];
            const d = tx.add(['trackers', k, 'value'], v, num(t.min, 0), num(t.max, 100));
            if (d) changes.push(`${t.label} ${fmtDelta(Math.round(d))}`);
        } else if (state.player.bars[k]) {
            applyBar(tx, state, k, v, changes);
        }
    }
    void label;
}

function applyBar(tx, state, id, value, changes) {
    const bar = state.player.bars[id];
    if (!bar) return;
    if (id === 'xp') {
        let xp = num(bar.value) + value;
        let level = num(state.player.level, 1);
        let max = num(bar.max, xpForLevel(level));
        let ups = 0;
        while (xp >= max && ups < 50) { xp -= max; level++; ups++; max = xpForLevel(level); }
        xp = Math.max(0, xp);
        tx.set(['player', 'bars', 'xp', 'value'], xp);
        if (ups) {
            tx.set(['player', 'level'], level);
            tx.set(['player', 'bars', 'xp', 'max'], max);
            // Level-up: +10 max HP, refill HP.
            const hp = state.player.bars.hp;
            if (hp) { tx.set(['player', 'bars', 'hp', 'max'], num(hp.max) + 10 * ups); tx.set(['player', 'bars', 'hp', 'value'], num(hp.max) + 10 * ups); }
            changes.push(`Level up! Lv ${level}`);
        }
        changes.push(`XP ${fmtDelta(value)}`);
        return;
    }
    const d = tx.add(['player', 'bars', id, 'value'], value, 0, num(bar.max, 100));
    if (d) changes.push(`${bar.label || id.toUpperCase()} ${fmtDelta(d)}`);
}

function advanceTime(tx, state, minutes, changes) {
    if (minutes <= 0) return;
    const t0 = num(state.clock.t);
    tx.set(['clock', 't'], t0 + minutes);
    const decay = decayTrackers(state.trackers, minutes);
    for (const [id, v] of Object.entries(decay)) tx.set(['trackers', id, 'value'], v);
    // Expire timed status effects.
    for (const [id, s] of Object.entries(state.statuses)) {
        if (s.until !== undefined && s.until !== null && s.until <= t0 + minutes) {
            tx.del(['statuses', id]);
            changes.push(`${s.name} wore off`);
        }
    }
    changes.push(`${humanDuration(minutes)} passed`);
}

function ensureNode(tx, state, name, opts = {}) {
    const found = findNode(state.map, name);
    if (found) {
        if (!found.explored) tx.set(['map', 'nodes', found.id, 'explored'], true);
        return found.id;
    }
    // New place: sibling of the current location (same parent + tier).
    const cur = state.map.nodes[state.map.location];
    const tier = opts.tier || cur?.tier || 'local';
    const parent = opts.tier && cur && opts.tier !== cur.tier
        ? (TIERS.indexOf(opts.tier) > TIERS.indexOf(cur.tier) ? cur.id : (state.map.nodes[cur.parent]?.parent ?? null))
        : (cur?.parent ?? null);
    const id = uid('loc');
    const pos = placeNode(state.map, parent, name);
    tx.set(['map', 'nodes', id], {
        id, name: str(name, 60), tier, parent, x: pos.x, y: pos.y,
        pin: guessPin(opts.kind, name), kind: opts.kind || '', desc: opts.desc || '', explored: true, links: cur ? [cur.id] : [],
    });
    return id;
}

/**
 * Apply validated ops to state.
 * @param {object} state campaign state (mutated)
 * @param {object[]} ops validated ops
 * @param {{source?: 'ai'|'user', characterNames?: string[], seed?: string}} [opts]
 * @returns {{patches: any[], changes: string[], applied: object[], skipped: {op:object, reason:string}[]}}
 */
export function applyOps(state, ops, opts = {}) {
    const tx = new Tx(state);
    const changes = [], applied = [], skipped = [];
    const isAi = (opts.source ?? 'ai') === 'ai';
    const hasTime = ops.some(o => o.op === 'time.advance');

    for (const op of ops) {
        try {
            const r = applyOne(tx, state, op, changes, { ...opts, isAi, hasTime });
            if (r === true || r === undefined) applied.push(op);
            else skipped.push({ op, reason: String(r) });
        } catch (e) {
            skipped.push({ op, reason: e?.message || 'error' });
        }
    }
    return { patches: tx.patches, changes, applied, skipped };
}

function applyOne(tx, state, op, changes, ctx) {
    const parts = () => toParts(state.clock.t, state.calendar.epoch);
    switch (op.op) {
        case 'time.advance':
            advanceTime(tx, state, op.minutes, changes);
            return true;

        case 'weather.set':
            tx.set(['weather', 'kind'], op.kind);
            if (op.temp !== undefined) tx.set(['weather', 'temp'], op.temp);
            changes.push(`Weather: ${op.kind}`);
            return true;

        case 'item.add': {
            const ex = findItem(state, op.name, op.id);
            if (ex) {
                tx.add(['inventory', ex.id, 'qty'], op.qty, 0, 9999);
            } else {
                const id = uid('item');
                tx.set(['inventory', id], {
                    id, name: op.name, qty: op.qty, cat: op.cat || guessCategory(op.name),
                    desc: op.desc || '', icon: op.icon || '', tags: op.tags || [],
                    effects: op.effects || defaultEffects(op.cat, op.name), added: state.clock.t,
                });
            }
            changes.push(`+${op.qty} ${op.name}`);
            return true;
        }

        case 'item.remove': case 'item.drop': case 'item.give': {
            const ex = findItem(state, op.name, op.id);
            if (!ex) return 'not in inventory';
            const left = num(ex.qty, 1) - op.qty;
            if (left <= 0) {
                for (const [slot, iid] of Object.entries(state.equipment)) if (iid === ex.id) tx.del(['equipment', slot]);
                tx.del(['inventory', ex.id]);
            } else {
                tx.set(['inventory', ex.id, 'qty'], left);
            }
            changes.push(`−${Math.min(op.qty, num(ex.qty, 1))} ${ex.name}${op.op === 'item.give' && op.to ? ` → ${op.to}` : ''}`);
            return true;
        }

        case 'item.use': {
            const ex = findItem(state, op.name, op.id);
            if (!ex) return 'not in inventory';
            const effects = Object.keys(ex.effects || {}).length ? ex.effects : defaultEffects(ex.cat, ex.name);
            applyEffects(tx, state, effects, changes);
            if (isConsumable(ex)) {
                const left = num(ex.qty, 1) - 1;
                if (left <= 0) tx.del(['inventory', ex.id]); else tx.set(['inventory', ex.id, 'qty'], left);
                changes.push(`Used ${ex.name}`);
            } else {
                changes.push(`Used ${ex.name}`);
            }
            return true;
        }

        case 'item.equip': {
            const ex = findItem(state, op.name, op.id);
            if (!ex) return 'not in inventory';
            const slot = defaultSlot(ex);
            if (op.on) {
                tx.set(['equipment', slot], ex.id);
                changes.push(`Equipped ${ex.name}`);
            } else {
                for (const [s, iid] of Object.entries(state.equipment)) if (iid === ex.id) tx.del(['equipment', s]);
                changes.push(`Unequipped ${ex.name}`);
            }
            return true;
        }

        case 'currency.delta': {
            const d = tx.add(['player', 'currency'], op.amount, 0, 1e9);
            if (!d) return 'no change';
            changes.push(`${fmtDelta(d)} ${state.player.currencyName || 'currency'}`);
            return true;
        }

        case 'tracker.delta': case 'tracker.set': {
            const t = state.trackers[op.id] || Object.values(state.trackers).find(x => normalizeName(x.label) === normalizeName(op.id));
            const id = state.trackers[op.id] ? op.id : Object.keys(state.trackers).find(k => state.trackers[k] === t);
            if (!t || !id) {
                // Allow bars through tracker ops ("hp" etc.)
                if (state.player.bars[op.id]) { applyBar(tx, state, op.id, op.op === 'tracker.set' ? op.value - num(state.player.bars[op.id].value) : op.value, changes); return true; }
                return 'unknown tracker';
            }
            const lo = num(t.min, 0), hi = num(t.max, 100);
            if (op.op === 'tracker.set') {
                tx.set(['trackers', id, 'value'], clamp(op.value, lo, hi));
                changes.push(`${t.label} = ${clamp(op.value, lo, hi)}`);
            } else {
                const d = tx.add(['trackers', id, 'value'], op.value, lo, hi);
                if (d) changes.push(`${t.label} ${fmtDelta(Math.round(d))}`);
            }
            return true;
        }

        case 'bar.delta':
            if (!state.player.bars[op.id]) return 'unknown bar';
            applyBar(tx, state, op.id, op.value, changes);
            return true;

        case 'status.add': {
            const ex = Object.entries(state.statuses).find(([, s]) => normalizeName(s.name) === normalizeName(op.name));
            const id = ex ? ex[0] : uid('st');
            tx.set(['statuses', id], { name: op.name, desc: op.desc || ex?.[1]?.desc || '', until: op.minutes ? num(state.clock.t) + op.minutes : null });
            changes.push(`Status: ${op.name}`);
            return true;
        }
        case 'status.remove': {
            const ex = Object.entries(state.statuses).find(([, s]) => normalizeName(s.name) === normalizeName(op.name) || findByName([s], op.name, 0.8));
            if (!ex) return 'no such status';
            tx.del(['statuses', ex[0]]);
            changes.push(`${ex[1].name} removed`);
            return true;
        }

        case 'npc.upsert': {
            const ex = findNpc(state, op.name);
            if (ex?.locked && ctx.isAi) return 'npc locked';
            const fields = {};
            for (const k of ['role', 'title', 'age', 'location', 'activity', 'appearance', 'personality', 'notes', 'present']) {
                if (op[k] !== undefined && op[k] !== '') fields[k] = op[k];
            }
            if (fields.location) {
                const node = findNode(state.map, fields.location);
                if (node) fields.locationId = node.id;
            }
            if (ex) {
                const oldName = ex.name;
                const merged = mergeNames(oldName, op.name);
                if (merged !== oldName) {
                    tx.set(['npcs', ex.id, 'name'], merged);
                    tx.set(['npcs', ex.id, 'aliases'], [...new Set([...(ex.aliases || []), oldName])]);
                } else if (normalizeName(op.name) !== normalizeName(ex.name) && !(ex.aliases || []).some(a => normalizeName(a) === normalizeName(op.name))) {
                    tx.set(['npcs', ex.id, 'aliases'], [...(ex.aliases || []), op.name]);
                }
                for (const [k, v] of Object.entries(fields)) tx.set(['npcs', ex.id, k], v);
                if (Object.keys(fields).length) changes.push(`${merged} updated`);
            } else {
                const id = uid('npc');
                const card = (ctx.characterNames || []).find(n => findByName([{ name: n }], op.name, 0.9));
                tx.set(['npcs', id], {
                    id, name: op.name, aliases: [], role: 'NPC', title: '', age: '', location: '', appearance: '', personality: '',
                    orgs: [], rumors: '', secrets: '', schedule: [], notes: '', locked: false, card: card || '',
                    rel: { affection: 30, trust: 30, standing: 50, memories: [] }, met: state.clock.t,
                    ...fields,
                });
                changes.push(`Met ${op.name}`);
            }
            return true;
        }

        case 'npc.move': {
            const ex = findNpc(state, op.name);
            if (!ex) return 'unknown npc';
            if (ex.locked && ctx.isAi) return 'npc locked';
            tx.set(['npcs', ex.id, 'location'], op.to);
            const node = findNode(state.map, op.to);
            tx.set(['npcs', ex.id, 'locationId'], node?.id);
            changes.push(`${ex.name} → ${op.to}`);
            return true;
        }

        case 'rel.delta': case 'rel.memory': {
            let ex = findNpc(state, op.name);
            if (!ex) {
                // Relationship with an unknown person implies we met them.
                applyOne(tx, state, { op: 'npc.upsert', name: op.name }, changes, ctx);
                ex = findNpc(state, op.name);
                if (!ex) return 'unknown npc';
            }
            if (ex.locked && ctx.isAi) return 'npc locked';
            if (!isPlainObject(ex.rel)) tx.set(['npcs', ex.id, 'rel'], { affection: 30, trust: 30, standing: 50, memories: [] });
            if (op.op === 'rel.delta') {
                const bits = [];
                for (const k of ['affection', 'trust', 'standing']) {
                    if (op[k] === undefined) continue;
                    const d = tx.add(['npcs', ex.id, 'rel', k], op[k], 0, 100);
                    if (d) bits.push(`${k} ${fmtDelta(d)}`);
                }
                if (bits.length) changes.push(`${ex.name}: ${bits.join(', ')}`);
            } else {
                const mem = Array.isArray(ex.rel?.memories) ? ex.rel.memories : [];
                tx.set(['npcs', ex.id, 'rel', 'memories'], [...mem, { t: state.clock.t, text: op.text }].slice(-30));
                changes.push(`Memory with ${ex.name}`);
            }
            return true;
        }

        case 'org.upsert': {
            const ex = findOrg(state, op.org);
            if (ex) {
                for (const k of ['type', 'purpose']) if (op[k]) tx.set(['orgs', ex.id, k], op[k]);
                if (op.location) tx.set(['orgs', ex.id, 'mainLocation'], op.location);
                return true;
            }
            const id = uid('org');
            tx.set(['orgs', id], newOrg(id, op.org, { type: op.type, purpose: op.purpose, mainLocation: op.location }));
            changes.push(`Learned of ${op.org}`);
            return true;
        }

        case 'org.standing': case 'org.runin': {
            let ex = findOrg(state, op.org);
            if (!ex) {
                const id = uid('org');
                tx.set(['orgs', id], newOrg(id, op.org));
                ex = state.orgs[id];
            }
            if (op.op === 'org.standing') {
                const d = tx.add(['orgs', ex.id, 'standing'], op.delta, 0, 100);
                if (d) changes.push(`${ex.name} standing ${fmtDelta(d)}`);
            } else {
                tx.set(['orgs', ex.id, 'runins'], [...(ex.runins || []), { t: state.clock.t, text: op.text }].slice(-50));
                changes.push(`Run-in: ${ex.name}`);
            }
            return true;
        }

        case 'location.add': {
            const had = findNode(state.map, op.to);
            ensureNode(tx, state, op.to, { kind: op.kind, desc: op.desc, tier: op.tier });
            if (!had) changes.push(`Discovered ${op.to}`);
            return true;
        }

        case 'location.move': case 'travel.go': {
            const from = state.map.location;
            const id = ensureNode(tx, state, op.to, { kind: op.kind, desc: op.desc, tier: op.tier });
            if (id === from) return 'already here';
            // Deterministic travel: code decides time + energy unless the op list already advances time.
            if (op.op === 'travel.go' || !ctx.hasTime) {
                const cost = travelCost(state.map, from, id, op.mode || 'foot', state.weather.kind);
                if (cost.minutes) advanceTime(tx, state, cost.minutes, changes);
                if (cost.energy && state.trackers.energy) {
                    tx.add(['trackers', 'energy', 'value'], -cost.energy, num(state.trackers.energy.min, 0), num(state.trackers.energy.max, 100));
                    changes.push(`Energy −${cost.energy}`);
                }
                if (cost.fare) tx.add(['player', 'currency'], -cost.fare, 0, 1e9);
            }
            tx.set(['map', 'location'], id);
            const node = state.map.nodes[id];
            // Link the path so it shows under "Paths from here".
            if (from && state.map.nodes[from] && node.parent === state.map.nodes[from].parent) {
                const links = state.map.nodes[from].links || [];
                if (!links.includes(id)) tx.set(['map', 'nodes', from, 'links'], [...links, id]);
            }
            changes.push(`Now at ${node.name}`);
            return true;
        }

        case 'quest.add': {
            const ex = findQuest(state, op.title);
            if (ex) return 'quest exists';
            const id = uid('q');
            const objectives = {};
            (op.objectives || []).forEach((t, i) => { objectives[`o${i}`] = { text: t, done: false }; });
            tx.set(['quests', id], { id, title: op.title, desc: op.desc || '', status: 'active', objectives, created: state.clock.t, giver: '', reward: '' });
            changes.push(`New quest: ${op.title}`);
            return true;
        }

        case 'quest.update': {
            const ex = findQuest(state, op.title);
            if (!ex) return 'unknown quest';
            if (op.status) { tx.set(['quests', ex.id, 'status'], op.status); changes.push(`Quest ${op.status}: ${ex.title}`); }
            if (op.desc) tx.set(['quests', ex.id, 'desc'], op.desc);
            if (op.objective) {
                const objs = ex.objectives || {};
                const hit = Object.entries(objs).find(([, o]) => findByName([{ name: o.text }], op.objective, 0.75) || normalizeName(o.text).includes(normalizeName(op.objective)));
                if (hit) tx.set(['quests', ex.id, 'objectives', hit[0], 'done'], op.done);
                else tx.set(['quests', ex.id, 'objectives', `o${Object.keys(objs).length}`], { text: op.objective, done: op.done });
                changes.push(`Objective ${op.done ? '✓' : '•'} ${op.objective}`);
            }
            return true;
        }

        case 'databank.add': {
            const ex = Object.values(state.databank).find(f => normalizeName(f.title) === normalizeName(op.title));
            if (ex) {
                if (op.text && op.text !== ex.text) tx.set(['databank', ex.id, 'text'], op.text);
                return true;
            }
            const id = uid('fact');
            tx.set(['databank', id], { id, title: op.title, text: op.text, tags: op.tags, t: state.clock.t });
            changes.push(`Learned: ${op.title}`);
            return true;
        }

        case 'battle.start': {
            if (state.battle?.active) return 'battle already active';
            const party = [playerCombatant(state), ...Object.entries(state.party.members).map(([nid, m]) => {
                const npc = state.npcs[nid];
                return npc ? { id: nid, name: npc.name, hp: num(m.hp, 60), maxHp: num(m.maxHp, 60), atk: num(m.atk, 8), def: num(m.def, 3), spd: num(m.spd, 5) } : null;
            }).filter(Boolean)];
            tx.set(['battle'], createBattle({ party, enemies: op.enemies, seed: `${ctx.seed || ''}|${state.clock.t}`, t: state.clock.t }));
            changes.push(`Battle! vs ${op.enemies.map(e => e.name).join(', ')}`);
            return true;
        }

        case 'event.add': {
            const p = parts();
            const day = toParts(dateToMinutes(p.y, p.m, p.d, state.calendar.epoch) + op.inDays * 1440, state.calendar.epoch);
            const id = uid('ev');
            tx.set(['calendar', 'events', id], { id, title: op.title, date: isoDate(day), type: op.type });
            changes.push(`📅 ${op.title}`);
            return true;
        }

        case 'activity.do': {
            const a = ACTIVITIES[op.id];
            advanceTime(tx, state, a.minutes, changes);
            applyEffects(tx, state, a.effects, changes);
            if (a.currency) { tx.add(['player', 'currency'], a.currency, 0, 1e9); changes.push(`+${a.currency} ${state.player.currencyName}`); }
            if (a.xp) applyBar(tx, state, 'xp', a.xp, changes);
            return true;
        }
    }
    return 'unhandled';
}

export function newOrg(id, name, extra = {}) {
    return {
        id, name, type: extra.type || 'organization', mainLocation: extra.mainLocation || '', locationKind: 'local',
        standing: 50, scale: 'local', leaderTitle: '', leaderId: 'hidden', subLeaders: '', purpose: extra.purpose || '',
        members: {}, influence: [], rules: '', runins: [], color: '',
    };
}

export function playerCombatant(state) {
    const b = state.player.bars;
    const lvl = num(state.player.level, 1);
    const eqAtk = Object.values(state.equipment || {}).reduce((s, iid) => s + num(state.inventory[iid]?.stats?.atk, state.inventory[iid]?.cat === 'weapon' ? 4 : 0), 0);
    const eqDef = Object.values(state.equipment || {}).reduce((s, iid) => s + num(state.inventory[iid]?.stats?.def, state.inventory[iid]?.cat === 'armor' ? 3 : 0), 0);
    return {
        id: 'player', name: state.player.name || 'You',
        hp: num(b.hp?.value, 100), maxHp: num(b.hp?.max, 100),
        ap: num(b.ap?.value, 10), maxAp: num(b.ap?.max, 10),
        mp: num(b.mp?.value, 10), maxMp: num(b.mp?.max, 10),
        atk: 8 + lvl * 2 + eqAtk, def: 3 + lvl + eqDef, spd: 5 + lvl, mag: 6 + lvl * 2,
    };
}

/** Summarize a change list into one short toast line. */
export function changeLine(changes, max = 6) {
    if (!changes.length) return '';
    const uniq = [...new Set(changes)];
    return uniq.slice(0, max).join(' · ') + (uniq.length > max ? ` · +${uniq.length - max} more` : '');
}

export { deepClone };
