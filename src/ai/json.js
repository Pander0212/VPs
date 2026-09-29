// Robust JSON extraction from messy model output: code fences, chatter before/after,
// single quotes, trailing commas, unquoted keys, smart quotes, comments, truncated tails.

function stripFences(s) {
    const fence = /```(?:json|javascript|js)?\s*([\s\S]*?)```/i.exec(s);
    return fence ? fence[1] : s;
}

/** Find the first balanced {...} or [...] block, respecting strings. */
export function findBalanced(s, from = 0) {
    const start = s.slice(from).search(/[{[]/);
    if (start < 0) return null;
    let i = from + start;
    const open = s[i];
    const stack = [];
    let inStr = null, esc = false;
    for (let j = i; j < s.length; j++) {
        const c = s[j];
        if (inStr) {
            if (esc) esc = false;
            else if (c === '\\') esc = true;
            else if (c === inStr) inStr = null;
            continue;
        }
        if (c === '"' || c === '\'') { inStr = c; continue; }
        if (c === '{' || c === '[') stack.push(c);
        else if (c === '}' || c === ']') {
            stack.pop();
            if (!stack.length) return s.slice(i, j + 1);
        }
    }
    // Unbalanced (truncated): return the tail and let repair close it.
    void open;
    return s.slice(i);
}

/** Best-effort repair of JSON-ish text. */
export function repairJson(src) {
    let s = String(src ?? '');
    s = s.replace(/[“”„‟″]/g, '"').replace(/[‘’‚‛′]/g, '\'');
    // Remove comments outside strings (rough but safe for model output).
    s = s.replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');

    // Convert single-quoted strings to double-quoted, walking char by char.
    let out = '';
    let inStr = null, esc = false;
    for (let i = 0; i < s.length; i++) {
        const c = s[i];
        if (inStr) {
            if (esc) { esc = false; out += c; continue; }
            if (c === '\\') { esc = true; out += c; continue; }
            if (c === inStr) { inStr = null; out += '"'; continue; }
            if (inStr === '\'' && c === '"') { out += '\\"'; continue; }
            if (c === '\n') { out += '\\n'; continue; }
            out += c;
            continue;
        }
        if (c === '"' || c === '\'') {
            // An apostrophe inside a bare word (don't) is not a string start.
            if (c === '\'' && /[A-Za-z]/.test(s[i - 1] || '') && /[A-Za-z]/.test(s[i + 1] || '')) { out += c; continue; }
            inStr = c; out += '"'; continue;
        }
        out += c;
    }
    if (inStr) out += '"';
    s = out;

    // Quote unquoted keys:  {op: "x"} -> {"op": "x"}
    s = s.replace(/([{,]\s*)([A-Za-z_][A-Za-z0-9_.-]*)(\s*:)/g, '$1"$2"$3');
    // Python-ish literals
    s = s.replace(/:\s*True\b/g, ': true').replace(/:\s*False\b/g, ': false').replace(/:\s*None\b/g, ': null');
    // +5 -> 5
    s = s.replace(/:\s*\+(\d)/g, ': $1');
    // Trailing commas
    s = s.replace(/,\s*([}\]])/g, '$1');
    // Missing commas between objects: } { -> }, {
    s = s.replace(/}\s*{/g, '},{');
    s = s.replace(/"\s*\n\s*"/g, '",\n"');

    // Close truncated brackets.
    const stack = [];
    inStr = false; esc = false;
    for (const c of s) {
        if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
        if (c === '"') inStr = true;
        else if (c === '{' || c === '[') stack.push(c);
        else if (c === '}' || c === ']') stack.pop();
    }
    s = s.replace(/,\s*$/, '');
    while (stack.length) s += stack.pop() === '{' ? '}' : ']';
    return s;
}

/**
 * Extract a JSON value from arbitrary text. Returns undefined when nothing parseable.
 */
export function extractJson(raw) {
    if (raw === null || raw === undefined) return undefined;
    if (typeof raw === 'object') return raw;
    let s = String(raw).trim();
    if (!s) return undefined;
    const tag = /<uie>([\s\S]*?)(?:<\/uie>|$)/i.exec(s);
    if (tag) s = tag[1];
    s = stripFences(s).trim();

    try { return JSON.parse(s); } catch { /* keep going */ }

    const block = findBalanced(s);
    if (!block) return undefined;
    try { return JSON.parse(block); } catch { /* keep going */ }
    try { return JSON.parse(repairJson(block)); } catch { /* keep going */ }
    return undefined;
}

/** Normalize anything that looks like an op list into an array of op objects. */
export function extractOps(raw) {
    const v = extractJson(raw);
    if (v === undefined) return undefined;
    if (Array.isArray(v)) return v;
    if (v && typeof v === 'object') {
        if (Array.isArray(v.ops)) return v.ops;
        if (Array.isArray(v.operations)) return v.operations;
        if (Array.isArray(v.changes)) return v.changes;
        if (v.op) return [v];
        return [];
    }
    return undefined;
}
