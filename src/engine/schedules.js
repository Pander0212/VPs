// NPC routines. A schedule is a list of blocks: { from: 'HH:MM', to: 'HH:MM', days?: [0-6], loc, activity }.
// Blocks that wrap midnight (22:00 -> 06:00) are supported. The first matching block wins.

import { parseHHMM } from './time.js';

export function activeBlock(schedule, minuteOfDay, dow) {
    if (!Array.isArray(schedule)) return null;
    for (const b of schedule) {
        if (!b) continue;
        if (Array.isArray(b.days) && b.days.length && !b.days.includes(dow)) continue;
        const from = parseHHMM(b.from), to = parseHHMM(b.to);
        if (from === null || to === null) continue;
        const hit = from <= to ? (minuteOfDay >= from && minuteOfDay < to) : (minuteOfDay >= from || minuteOfDay < to);
        if (hit) return b;
    }
    return null;
}

/**
 * Where is this NPC now? Schedule beats the stored location; the stored location is the fallback.
 * @returns {{loc: string, activity: string, fromSchedule: boolean}}
 */
export function npcWhereabouts(npc, parts) {
    const b = activeBlock(npc?.schedule, parts.minuteOfDay, parts.dow);
    if (b) return { loc: b.loc || npc.location || '', activity: b.activity || '', fromSchedule: true };
    return { loc: npc?.location || '', activity: npc?.activity || '', fromSchedule: false };
}

/** Parse a free-text schedule like "08:00-17:00 Bakery: baking bread" (one per line). */
export function parseScheduleText(txt) {
    const out = [];
    for (const line of String(txt ?? '').split(/\n+/)) {
        const m = /^\s*(\d{1,2}:\d{2})\s*[-–]\s*(\d{1,2}:\d{2})\s*(?:\[([0-6,\s]+)\])?\s*([^:]*?)(?::\s*(.*))?\s*$/.exec(line);
        if (!m) continue;
        const days = m[3] ? m[3].split(',').map(s => Number(s.trim())).filter(n => n >= 0 && n <= 6) : undefined;
        out.push({ from: m[1], to: m[2], ...(days?.length ? { days } : {}), loc: (m[4] || '').trim(), activity: (m[5] || '').trim() });
    }
    return out;
}

export function scheduleToText(schedule) {
    if (!Array.isArray(schedule)) return '';
    return schedule.map(b => `${b.from}-${b.to}${b.days?.length ? ` [${b.days.join(',')}]` : ''} ${b.loc || ''}${b.activity ? `: ${b.activity}` : ''}`.trim()).join('\n');
}
