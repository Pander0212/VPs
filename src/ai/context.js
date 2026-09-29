// Compiles the compact state summary injected before every generation, trimmed to a
// token budget by priority and relevance. Pure: takes state, returns text.

import { toParts, formatDate, formatTime, partOfDay, isoDate, humanDuration } from '../engine/time.js';
import { standingLabel, relationshipLabel, trackerState } from '../engine/rules.js';
import { locationPath, pathsFrom, travelCost } from '../engine/map.js';
import { npcWhereabouts } from '../engine/schedules.js';
import { normalizeName, nameScore } from '../engine/dedupe.js';
import { estimateTokens, num } from '../engine/util.js';

const STOP = new Set('the a an and or of to in on at is was were be been it its this that with for from as by you your i me my he she they them his her their we our not no yes but so if then there here what who how'.split(' '));

export function keywords(textIn, max = 40) {
    const words = normalizeName(textIn).split(' ').filter(w => w.length > 2 && !STOP.has(w));
    return [...new Set(words)].slice(-max);
}

function relevance(textIn, kw) {
    if (!kw.length) return 0;
    const t = normalizeName(textIn);
    let s = 0;
    for (const k of kw) if (t.includes(k)) s++;
    return s;
}

export function npcsHere(state, parts) {
    const here = state.map.nodes[state.map.location];
    const out = [];
    for (const npc of Object.values(state.npcs)) {
        const w = npcWhereabouts(npc, parts);
        const atHere = here && (npc.locationId === here.id || (w.loc && nameScore(w.loc, here.name) >= 0.75) || normalizeName(w.loc).includes(normalizeName(here.name)));
        if (npc.present || atHere) out.push({ npc, where: w });
    }
    return out;
}

/**
 * @param {object} state
 * @param {{budget?: number, recentText?: string, userName?: string}} opts
 */
export function compileContext(state, opts = {}) {
    const budget = Math.max(80, num(opts.budget, 600));
    const kw = keywords(opts.recentText || '');
    const p = toParts(state.clock.t, state.calendar.epoch);
    const cal = state.calendar;
    const here = state.map.nodes[state.map.location];
    const lines = [];
    let used = 0;
    const push = (line) => {
        const cost = estimateTokens(line) + 1;
        if (used + cost > budget) return false;
        lines.push(line);
        used += cost;
        return true;
    };

    // P0 — scene
    push('[Game State — authoritative; keep narration consistent with it]');
    push(`Time: ${formatDate(p, 'long', cal.monthNames)}, ${formatTime(p, cal.h24)} (${partOfDay(p.hh)}). Weather: ${state.weather.kind}${state.weather.temp !== undefined ? `, ${state.weather.temp}°C` : ''}.`);
    if (here) {
        push(`Location: ${locationPath(state.map, here.id)}${here.desc ? ` — ${here.desc}` : ''}`);
        const exits = pathsFrom(state.map, here.id).slice(0, 4).map(n => {
            const c = travelCost(state.map, here.id, n.id, 'foot', state.weather.kind);
            return `${n.explored === false ? 'unexplored place' : n.name} (${humanDuration(c.minutes)})`;
        });
        if (exits.length) push(`Exits: ${exits.join(', ')}`);
    }

    // P0 — player
    const pl = state.player;
    const who = pl.name || opts.userName || 'Player';
    const bars = Object.entries(pl.bars).filter(([, b]) => b.visible !== false).map(([id, b]) => `${b.label || id.toUpperCase()} ${Math.round(b.value)}/${b.max}`).join(', ');
    push(`${who}${pl.cls ? ` (${pl.cls}` + `, Lv ${pl.level})` : ` (Lv ${pl.level})`}: ${bars}. ${pl.currencyName || 'Money'}: ${pl.currency}.`);
    const tr = Object.values(state.trackers).map(t => `${t.label} ${Math.round(t.value)}${trackerState(t) !== 'ok' ? ` (${trackerState(t)})` : ''}`).join(', ');
    if (tr) push(`Needs: ${tr}`);
    const st = Object.values(state.statuses).map(s => s.name + (s.desc ? ` (${s.desc})` : '')).join(', ');
    if (st) push(`Status effects: ${st}`);
    const eq = Object.entries(state.equipment).map(([slot, id]) => state.inventory[id] ? `${state.inventory[id].name}` : null).filter(Boolean);
    if (eq.length) push(`Equipped: ${eq.join(', ')}`);

    // P1 — people here + party
    const present = npcsHere(state, p);
    if (present.length) {
        push('Present:');
        for (const { npc, where } of present.slice(0, 8)) {
            const rel = npc.rel ? `, ${relationshipLabel(npc.rel)}` : '';
            if (!push(`- ${npc.name}${npc.role ? ` (${npc.role})` : ''}${where.activity ? `: ${where.activity}` : ''}${rel}`)) break;
        }
    }
    const party = Object.keys(state.party.members).map(id => state.npcs[id]?.name).filter(Boolean);
    if (party.length) push(`Party: ${party.join(', ')}`);

    // P2 — quests, today's events, orgs
    const quests = Object.values(state.quests).filter(q => q.status === 'active');
    if (quests.length) {
        push('Active quests:');
        for (const q of quests.sort((a, b) => relevance(b.title + b.desc, kw) - relevance(a.title + a.desc, kw)).slice(0, 5)) {
            const open = Object.values(q.objectives || {}).filter(o => !o.done).map(o => o.text).slice(0, 2);
            if (!push(`- ${q.title}${open.length ? ` → ${open.join('; ')}` : ''}`)) break;
        }
    }
    const today = isoDate(p);
    const tomorrow = isoDate(toParts(state.clock.t + 1440, cal.epoch));
    const evs = Object.values(cal.events || {}).filter(e => e.date === today || e.date === tomorrow || (e.type === 'birthday' && (e.date.slice(5) === today.slice(5))));
    for (const e of evs.slice(0, 3)) push(`${e.date === today || e.date.slice(5) === today.slice(5) ? 'Today' : 'Tomorrow'}: ${e.title}${e.type === 'birthday' ? ' (birthday)' : ''}`);

    const presentNames = present.map(x => x.npc.id);
    const orgs = Object.values(state.orgs).map(o => {
        let score = relevance(`${o.name} ${o.purpose}`, kw);
        if (Object.keys(o.members || {}).some(id => presentNames.includes(id))) score += 3;
        if (here && (o.influence || []).includes(here.id)) score += 2;
        return { o, score };
    }).filter(x => x.score > 0 || Object.keys(state.orgs).length <= 3).sort((a, b) => b.score - a.score);
    for (const { o } of orgs.slice(0, 4)) {
        if (!push(`Org: ${o.name} (${o.type}) — your standing ${standingLabel(o.standing)} (${o.standing}/100)`)) break;
    }

    // P3 — databank facts by relevance
    const facts = Object.values(state.databank).map(f => ({ f, s: relevance(`${f.title} ${f.text} ${(f.tags || []).join(' ')}`, kw) }))
        .sort((a, b) => b.s - a.s || num(b.f.t) - num(a.f.t));
    const factLines = [];
    for (const { f, s } of facts) {
        if (s === 0 && factLines.length >= 3) break;
        factLines.push(`- ${f.title}: ${f.text}`.slice(0, 220));
        if (factLines.length >= 8) break;
    }
    if (factLines.length && push('Known facts:')) for (const l of factLines) if (!push(l)) break;

    // P4 — notable inventory
    const inv = Object.values(state.inventory).sort((a, b) => relevance(b.name, kw) - relevance(a.name, kw)).slice(0, 12).map(i => `${i.name}${i.qty > 1 ? ` ×${i.qty}` : ''}`);
    if (inv.length) push(`Inventory: ${inv.join(', ')}`);

    return lines.join('\n');
}

/** Smaller state view for the tracker pass: names the model should reuse. */
export function compileTrackerState(state) {
    const p = toParts(state.clock.t, state.calendar.epoch);
    const here = state.map.nodes[state.map.location];
    const lines = [
        `Time: ${formatDate(p, 'iso')} ${formatTime(p, true)} | Weather: ${state.weather.kind}`,
        `Location: ${here ? locationPath(state.map, here.id) : 'unknown'}`,
        `Money: ${state.player.currency} ${state.player.currencyName}`,
        `Bars: ${Object.entries(state.player.bars).map(([id, b]) => `${id}=${Math.round(b.value)}/${b.max}`).join(' ')}`,
        `Trackers: ${Object.entries(state.trackers).map(([id, t]) => `${id}=${Math.round(t.value)}`).join(' ')}`,
        `Statuses: ${Object.values(state.statuses).map(s => s.name).join(', ') || 'none'}`,
        `Inventory: ${Object.values(state.inventory).map(i => `${i.name}×${i.qty}`).join(', ').slice(0, 600) || 'empty'}`,
        `Known people: ${Object.values(state.npcs).map(n => n.name + (n.locked ? ' [locked]' : '')).join(', ').slice(0, 600) || 'none'}`,
        `Known places: ${Object.values(state.map.nodes).filter(n => n.explored !== false).map(n => n.name).join(', ').slice(0, 500)}`,
        `Orgs: ${Object.values(state.orgs).map(o => o.name).join(', ').slice(0, 300) || 'none'}`,
        `Active quests: ${Object.values(state.quests).filter(q => q.status === 'active').map(q => q.title).join('; ').slice(0, 400) || 'none'}`,
    ];
    return lines.join('\n');
}
