// Name normalisation + fuzzy matching. "Tobias" and "Tobias Moreno" are one person.

export function normalizeName(s) {
    return String(s ?? '')
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/[“”"'`’]/g, '')
        .replace(/\b(the|mr|mrs|ms|miss|dr|sir|lady|lord|captain|capt|prof|professor)\.?\s+/g, '')
        .replace(/[^a-z0-9\s-]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

export function levenshtein(a, b) {
    a = String(a); b = String(b);
    if (a === b) return 0;
    if (!a.length) return b.length;
    if (!b.length) return a.length;
    let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
        const cur = [i];
        for (let j = 1; j <= b.length; j++) {
            cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        }
        prev = cur;
    }
    return prev[b.length];
}

/**
 * Score how likely two names refer to the same entity (0..1).
 * Rules: exact normalized match = 1; one name's tokens are a prefix-subset of the other
 * (first-name match: "Tobias" vs "Tobias Moreno") = 0.9; small typo distance on full name
 * or first token = 0.8.
 */
export function nameScore(a, b) {
    const na = normalizeName(a), nb = normalizeName(b);
    if (!na || !nb) return 0;
    if (na === nb) return 1;
    const ta = na.split(' '), tb = nb.split(' ');
    const [short, long] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
    // All tokens of the shorter name appear in the longer one, and the first tokens agree
    // (or the short one is just a surname that matches the last token).
    const allIn = short.every(t => long.includes(t));
    if (allIn && (short[0] === long[0] || (short.length === 1 && short[0] === long[long.length - 1] && short[0].length > 3))) return 0.9;
    const dist = levenshtein(na, nb);
    const maxLen = Math.max(na.length, nb.length);
    if (maxLen >= 5 && dist <= (maxLen > 8 ? 2 : 1)) return 0.8;
    if (ta[0].length >= 5 && tb[0].length >= 5 && levenshtein(ta[0], tb[0]) <= 1 && (ta.length === 1 || tb.length === 1)) return 0.75;
    return 0;
}

/**
 * Find best match in a list of {id, name, aliases?}. Returns the entity or null.
 * Ambiguity guard: if a short first name matches two different full names, return null
 * (we would rather create a new record than merge the wrong people).
 */
export function findByName(list, name, threshold = 0.75) {
    let best = null, bestScore = 0, tie = false;
    for (const e of list) {
        const names = [e.name, ...(Array.isArray(e.aliases) ? e.aliases : [])];
        let s = 0;
        for (const n of names) s = Math.max(s, nameScore(n, name));
        if (s > bestScore) { best = e; bestScore = s; tie = false; }
        else if (s === bestScore && s > 0 && s < 1 && best !== e) tie = true;
    }
    if (bestScore >= 1) return best;
    if (tie) return null;
    return bestScore >= threshold ? best : null;
}

/** Prefer the more complete name when merging ("Tobias" + "Tobias Moreno" -> "Tobias Moreno"). */
export function mergeNames(existing, incoming) {
    const a = String(existing ?? '').trim(), b = String(incoming ?? '').trim();
    if (!a) return b;
    if (!b) return a;
    return b.split(/\s+/).length > a.split(/\s+/).length ? b : a;
}
