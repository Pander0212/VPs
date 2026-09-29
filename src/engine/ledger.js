// Per-message diff ledger. Each AI message that changed state gets an entry keyed by a
// fingerprint of that exact message swipe. Reconcile compares the ledger with the chat as
// it is *now* and rolls back entries whose message/swipe vanished (swipe, delete, edit),
// then replays stashed ops for swipes that came back. This is event-agnostic, so it keeps
// working when ST changes which events fire in which order.

import { hash, uid } from './util.js';
import { undoPatches } from './tx.js';
import { applyOps } from './ops.js';

export const LOG_CAP = 300;
export const STASH_CAP = 80;

const TAG_RE = /<uie>[\s\S]*?<\/uie>/gi;

export function stripTags(s) {
    return String(s ?? '').replace(TAG_RE, '').trim();
}

/** Stable fingerprint for one message swipe. */
export function fingerprint(msg) {
    if (!msg) return '';
    const body = stripTags(msg.mes).replace(/\s+/g, ' ').slice(0, 300);
    return hash(`${msg.send_date ?? ''}|${msg.is_user ? 'u' : 'a'}|${body}`);
}

export function fullHash(msg) {
    return hash(stripTags(msg?.mes ?? ''));
}

export function record(state, { key, idx, ops, patches, changes, full }) {
    const entry = { id: uid('d'), key, idx, ops, patches, changes, full: full || '', at: Date.now() };
    state.log.push(entry);
    delete state.stash[key];
    if (state.log.length > LOG_CAP) state.log.splice(0, state.log.length - LOG_CAP);
    return entry;
}

function stash(state, key, ops) {
    if (!key || !ops?.length) return;
    delete state.stash[key];
    state.stash[key] = ops;
    const keys = Object.keys(state.stash);
    if (keys.length > STASH_CAP) for (const k of keys.slice(0, keys.length - STASH_CAP)) delete state.stash[k];
}

/** Roll back a single entry (by entry object). */
export function rollbackEntry(state, entry, { keepStash = true } = {}) {
    const i = state.log.indexOf(entry);
    if (i < 0) return 0;
    const conflicts = undoPatches(state, entry.patches || []);
    state.log.splice(i, 1);
    if (keepStash) stash(state, entry.key, entry.ops);
    return conflicts;
}

/**
 * Reconcile ledger with the current chat.
 * @param {object} state campaign state (mutated)
 * @param {{mes:string, send_date?:string, is_user?:boolean}[]} chat
 * @param {object} [opts] passed to applyOps on replay
 * @returns {{rolledBack: object[], replayed: object[], conflicts: number}}
 */
export function reconcile(state, chat, opts = {}) {
    const keys = new Map(); // key -> chat index
    (chat || []).forEach((m, i) => { const k = fingerprint(m); if (k) keys.set(k, i); });

    const rolledBack = [];
    let conflicts = 0;
    for (let i = state.log.length - 1; i >= 0; i--) {
        const e = state.log[i];
        if (!keys.has(e.key)) {
            conflicts += rollbackEntry(state, e);
            rolledBack.push(e);
        } else {
            e.idx = keys.get(e.key);
        }
    }

    const replayed = [];
    const logged = new Set(state.log.map(e => e.key));
    // Only replay swipes that are in the chat tail; replaying deep history out of order would
    // reorder time. The last 3 messages cover swipe-back on the latest reply.
    const tailStart = Math.max(0, (chat?.length || 0) - 3);
    for (let i = tailStart; i < (chat?.length || 0); i++) {
        const k = fingerprint(chat[i]);
        if (!k || logged.has(k) || !state.stash[k]) continue;
        const ops = state.stash[k];
        const res = applyOps(state, ops, opts);
        replayed.push(record(state, { key: k, idx: i, ops, patches: res.patches, changes: res.changes, full: fullHash(chat[i]) }));
    }
    return { rolledBack, replayed, conflicts };
}

/** Entries for a chat index (used by MESSAGE_EDITED). */
export function entriesFor(state, idx) {
    return state.log.filter(e => e.idx === idx);
}
