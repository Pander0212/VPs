// State extraction ("tracker pass"): inline <uie> tags or a separate quiet pass.

import { st } from '../st-adapter.js';
import { S, save, settingsGet, notifyChanges } from '../state.js';
import { extractOps } from './json.js';
import { genText, genJson, render, recentMessages } from './gen.js';
import { compileTrackerState } from './context.js';
import { validateOps, applyOps } from '../engine/ops.js';
import { record, fingerprint, fullHash, stripTags, rollbackEntry } from '../engine/ledger.js';

const TAG_RE = /<uie>([\s\S]*?)(?:<\/uie>|$)/i;
const running = new Set();

export function trackerNames() {
    return Object.keys(S().trackers).join('|');
}

function commit(idx, msg, rawOps, source) {
    const state = S();
    const { ops, rejected } = validateOps(rawOps);
    if (rejected.length) st.warn(`${source}: rejected ops`, rejected);
    // Re-tracking the same message (forced pass / edit): undo what it did before.
    const key = fingerprint(msg);
    for (const e of state.log.filter(x => x.key === key)) rollbackEntry(state, e, { keepStash: false });
    if (!ops.length) { save('ops'); return { changes: [] }; }
    const res = applyOps(state, ops, { source: 'ai', characterNames: st.characters().map(c => c.name), seed: fingerprint(msg) });
    record(state, { key, idx, ops: res.applied, patches: res.patches, changes: res.changes, full: fullHash(msg) });
    save('ops');
    notifyChanges(res.changes);
    return res;
}

/**
 * Inline mode: pull <uie>{...}</uie> out of the message, strip it from the visible text,
 * re-render, then apply. Also used to clean tags if the model emits them in pass mode.
 * @returns {boolean} whether a tag was found
 */
export async function handleInline(idx, { apply = true } = {}) {
    const chat = st.chat();
    const msg = chat[idx];
    if (!msg || msg.is_user || typeof msg.mes !== 'string' || !/<uie>/i.test(msg.mes)) return false;
    const m = TAG_RE.exec(msg.mes);
    // Remove complete tags and an unterminated trailing tag (model cut off mid-JSON).
    const clean = stripTags(msg.mes).replace(/<uie>[\s\S]*$/i, '').trim();
    msg.mes = clean;
    if (Array.isArray(msg.swipes) && typeof msg.swipe_id === 'number') msg.swipes[msg.swipe_id] = clean;
    st.rerenderMessage(idx);
    await st.saveChat();
    if (apply && m) {
        const ops = extractOps(m[1]);
        if (ops?.length) commit(idx, msg, ops, 'inline');
    }
    return true;
}

/** Separate pass over the last messages. Safe to call repeatedly; skips if already recorded. */
export async function runPass(idx, { force = false } = {}) {
    const chat = st.chat();
    const msg = chat[idx];
    if (!msg || msg.is_user) return null;
    const key = fingerprint(msg);
    if (!force && S().log.some(e => e.key === key)) return null;
    if (running.has(key)) return null;
    running.add(key);
    const chatAtStart = st.chatId();
    try {
        const prompt = render('tracker', {
            state: compileTrackerState(S()),
            messages: recentMessages(Math.max(1, Math.min(3, Number(settingsGet().trackerContext) || 2)), idx),
            trackers: trackerNames(),
        }).replace('{{trackers}}', trackerNames());
        let raw;
        try {
            raw = await genText(prompt, { responseLength: 500, label: 'Tracker pass' });
        } catch (e) {
            st.warn('tracker pass failed', e);
            globalThis.toastr?.warning?.(`Tracker pass failed: ${e?.message || e}`, 'UIE', { timeOut: 3500 });
            return null;
        }
        let ops = extractOps(raw);
        if (ops === undefined) {
            try {
                const fixed = await genJson(`Convert this into valid JSON of the form {"ops":[...]} and output only JSON:\n${String(raw).slice(0, 2500)}`, { label: 'Tracker repair' });
                ops = extractOps(fixed.value);
            } catch (e) {
                st.warn('tracker repair failed', e);
                return null;
            }
        }
        // The chat may have moved on while we waited (swipe, delete, chat switch): discard.
        const now = st.chat()[idx];
        if (st.chatId() !== chatAtStart || !now || fingerprint(now) !== key) {
            st.log('tracker result discarded (message changed)');
            return null;
        }
        return commit(idx, now, ops || [], 'pass');
    } finally {
        running.delete(key);
    }
}
