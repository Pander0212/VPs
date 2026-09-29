// Game clock. The clock is stored as integer minutes since the campaign epoch
// (calendar.epoch = {y,m,d}; minute 0 = 00:00 of that day). Pure functions only.

import { clamp, num } from './util.js';

export const DEFAULT_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const MIN_PER_DAY = 1440;

export function epochMs(epoch) {
    const y = num(epoch?.y, 2026), m = clamp(epoch?.m ?? 7, 1, 12), d = clamp(epoch?.d ?? 1, 1, 31);
    return Date.UTC(y, m - 1, d);
}

/** Break absolute game minutes into calendar parts. */
export function toParts(t, epoch) {
    const minutes = Math.max(0, Math.floor(num(t)));
    const ms = epochMs(epoch) + minutes * 60000;
    const dt = new Date(ms);
    return {
        y: dt.getUTCFullYear(),
        m: dt.getUTCMonth() + 1,
        d: dt.getUTCDate(),
        hh: dt.getUTCHours(),
        mm: dt.getUTCMinutes(),
        dow: dt.getUTCDay(),
        dayIndex: Math.floor(minutes / MIN_PER_DAY),
        minuteOfDay: minutes % MIN_PER_DAY,
    };
}

/** Inverse of toParts for a date (00:00). Returns absolute minutes (can be negative for pre-epoch). */
export function dateToMinutes(y, m, d, epoch) {
    return Math.round((Date.UTC(y, m - 1, d) - epochMs(epoch)) / 60000);
}

export const pad2 = (n) => String(n).padStart(2, '0');
export const isoDate = (p) => `${p.y}-${pad2(p.m)}-${pad2(p.d)}`;

export function daysInMonth(y, m) {
    return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function monthName(m, names) {
    const list = Array.isArray(names) && names.length === 12 && names.every(Boolean) ? names : DEFAULT_MONTHS;
    return list[clamp(m, 1, 12) - 1];
}

export function formatTime(p, h24 = true) {
    if (h24) return `${pad2(p.hh)}:${pad2(p.mm)}`;
    const h = p.hh % 12 || 12;
    return `${h}:${pad2(p.mm)} ${p.hh < 12 ? 'AM' : 'PM'}`;
}

/**
 * @param {object} p parts
 * @param {string} fmt 'long' | 'dmy' | 'mdy' | 'iso'
 */
export function formatDate(p, fmt = 'long', names = null) {
    switch (fmt) {
        case 'dmy': return `${pad2(p.d)}.${pad2(p.m)}.${p.y}`;
        case 'mdy': return `${pad2(p.m)}/${pad2(p.d)}/${p.y}`;
        case 'iso': return isoDate(p);
        default: return `${WEEKDAYS[p.dow].slice(0, 3)}, ${p.d} ${monthName(p.m, names)} ${p.y}`;
    }
}

export function partOfDay(hh) {
    if (hh < 5) return 'night';
    if (hh < 8) return 'dawn';
    if (hh < 12) return 'morning';
    if (hh < 17) return 'afternoon';
    if (hh < 20) return 'evening';
    if (hh < 22) return 'dusk';
    return 'night';
}

/** Parses "HH:MM" -> minute of day, or null. */
export function parseHHMM(s) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(s ?? '').trim());
    if (!m) return null;
    const h = Number(m[1]), mi = Number(m[2]);
    if (h > 24 || mi > 59) return null;
    return Math.min(MIN_PER_DAY, h * 60 + mi);
}

/**
 * Real-time day length: how many game minutes pass for `realMs` milliseconds
 * when one game day lasts `realMinutesPerDay` real minutes.
 */
export function realtimeAdvance(realMs, realMinutesPerDay) {
    const perDay = Math.max(1, num(realMinutesPerDay, 60));
    return (Math.max(0, num(realMs)) / 60000) * (MIN_PER_DAY / perDay);
}

export function humanDuration(minutes) {
    const m = Math.max(0, Math.round(num(minutes)));
    if (m < 60) return `${m} min`;
    const h = Math.floor(m / 60), r = m % 60;
    if (h < 24) return r ? `${h} h ${r} min` : `${h} h`;
    const d = Math.floor(h / 24), rh = h % 24;
    return rh ? `${d} d ${rh} h` : `${d} d`;
}
