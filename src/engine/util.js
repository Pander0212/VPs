// Pure helpers shared by engine + ai + ui. No DOM, no ST.

export const clamp = (n, lo, hi) => {
    const v = Number(n);
    if (!Number.isFinite(v)) return lo;
    return Math.min(hi, Math.max(lo, v));
};

export const num = (v, fallback = 0) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
};

export const str = (v, max = 400) => {
    if (v === null || v === undefined) return '';
    return String(v).replace(/\s+/g, ' ').trim().slice(0, max);
};

/** Multi-line safe string (keeps newlines). */
export const text = (v, max = 4000) => {
    if (v === null || v === undefined) return '';
    return String(v).replace(/\r\n/g, '\n').trim().slice(0, max);
};

let uidCounter = 0;
export function uid(prefix = 'id') {
    uidCounter = (uidCounter + 1) % 1e6;
    return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}${uidCounter.toString(36)}`;
}

export function deepClone(v) {
    if (v === undefined) return undefined;
    if (typeof structuredClone === 'function') {
        try { return structuredClone(v); } catch { /* fall through */ }
    }
    return JSON.parse(JSON.stringify(v));
}

export function deepEqual(a, b) {
    if (a === b) return true;
    if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') {
        return Number.isNaN(a) && Number.isNaN(b);
    }
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    const ka = Object.keys(a).filter(k => a[k] !== undefined);
    const kb = Object.keys(b).filter(k => b[k] !== undefined);
    if (ka.length !== kb.length) return false;
    for (const k of ka) {
        if (!deepEqual(a[k], b[k])) return false;
    }
    return true;
}

export function isPlainObject(v) {
    return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** Tiny stable string hash (FNV-1a, 32bit) -> base36. */
export function hash(s) {
    let h = 0x811c9dc5;
    const t = String(s ?? '');
    for (let i = 0; i < t.length; i++) {
        h ^= t.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(36);
}

/** Seeded PRNG (mulberry32). */
export function rng(seed) {
    let a = typeof seed === 'number' ? seed >>> 0 : parseInt(hash(seed), 36) >>> 0;
    return () => {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

export const byName = (a, b) => String(a?.name ?? '').localeCompare(String(b?.name ?? ''));

/** Rough token estimate that is good enough for budgeting (no tokenizer needed). */
export const estimateTokens = (s) => Math.ceil(String(s ?? '').length / 3.6);
