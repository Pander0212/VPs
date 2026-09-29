// Runtime state store: binds the pure schema to ST chat metadata + extension settings.
// Campaign state lives in chatMetadata.uie (per chat). Global prefs live in extensionSettings.uie.

import { st } from './st-adapter.js';
import { migrate, migrateSettings, defaultCampaign } from './engine/schema.js';
import { applyOps, validateOps, USER_OPS, changeLine } from './engine/ops.js';
import { deepClone } from './engine/util.js';

let campaign = defaultCampaign();
let settings = migrateSettings({});
let boundChat = null;      // chat id the campaign belongs to
let ephemeral = true;      // true when no chat is open (nothing is persisted)

const listeners = new Set();

export const bus = {
    on(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    emit(reason = 'change') {
        for (const fn of [...listeners]) {
            try { fn(reason); } catch (e) { st.error('listener failed', e); }
        }
    },
};

export function S() { return campaign; }
export function settingsGet() { return settings; }
export function isEphemeral() { return ephemeral; }
export function boundChatId() { return boundChat; }

let tapHookInstalled = false;
function installTapFlush() {
    if (tapHookInstalled || typeof document === 'undefined') return;
    tapHookInstalled = true;
    document.addEventListener('pointerdown', (e) => st.flushOnTap(e), true);
    document.addEventListener('keydown', (e) => { if (e.key === 'Enter') st.flushOnTap(e); }, true);
    window.addEventListener('pagehide', () => st.flushMeta());
    document.addEventListener('visibilitychange', () => { if (document.hidden) st.flushMeta(); });
}

export function loadSettings() {
    installTapFlush();
    const root = st.settingsRoot();
    settings = migrateSettings(root);
    st.setSettings(settings);
    return settings;
}

export function saveSettings() {
    st.setSettings(settings);
    st.saveSettings();
    bus.emit('settings');
}

/** (Re)load campaign for the current chat. Called on CHAT_CHANGED. */
export function loadCampaign() {
    const meta = st.meta();
    const id = st.chatId();
    if (!meta || !id) {
        campaign = defaultCampaign();
        ephemeral = true;
        boundChat = null;
        bus.emit('load');
        return campaign;
    }
    campaign = migrate(meta.uie);
    // Point metadata at the live object so later saves persist in place.
    meta.uie = campaign;
    ephemeral = false;
    boundChat = id;
    bus.emit('load');
    return campaign;
}

/** Persist the campaign (debounced by ST). */
export function save(reason = 'change') {
    if (!ephemeral) {
        const meta = st.meta();
        // Guard: never write this campaign into another chat's metadata.
        if (meta && st.chatId() === boundChat) {
            meta.uie = campaign;
            st.saveMeta();
        }
    }
    bus.emit(reason);
}

/** Mutate campaign with a function (manual UI edits). */
export function mutate(fn, reason = 'change') {
    try {
        fn(campaign);
    } catch (e) {
        st.error('mutate failed', e);
        globalThis.toastr?.error?.(String(e?.message || e), 'UIE');
    }
    save(reason);
}

/**
 * Apply ops coming from the UI (not logged for rollback — user actions are authoritative).
 * @returns {{changes: string[], skipped: any[]}}
 */
export function userOps(rawOps, { toast = true } = {}) {
    const { ops, rejected } = validateOps(rawOps, USER_OPS);
    const res = applyOps(campaign, ops, { source: 'user', characterNames: st.characters().map(c => c.name) });
    save('ops');
    if (toast && res.changes.length) notifyChanges(res.changes);
    if (rejected.length || res.skipped.length) st.warn('ops skipped', rejected, res.skipped);
    return res;
}

let lastToast = null;
export function notifyChanges(changes, title = 'UIE') {
    if (!settings.showChangeToasts || !changes?.length) return;
    const line = changeLine(changes);
    try {
        // One UIE toast at a time: a new change list replaces the previous one.
        if (lastToast) globalThis.toastr?.clear?.(lastToast);
        lastToast = globalThis.toastr?.info?.(escapeText(line), title, { timeOut: 4500, closeButton: true, preventDuplicates: false, toastClass: 'toast uie-toast' });
    } catch { /* ignore */ }
}

function escapeText(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' }[c]));
}

export function resetCampaign() {
    const fresh = defaultCampaign();
    for (const k of Object.keys(campaign)) delete campaign[k];
    Object.assign(campaign, fresh);
    save('load');
}

export function exportCampaign() {
    return JSON.stringify({ uie: 'campaign', version: campaign.v, exported: new Date().toISOString(), data: campaign }, null, 1);
}

export function importCampaign(text) {
    const parsed = JSON.parse(text);
    const data = parsed?.uie === 'campaign' ? parsed.data : parsed;
    const next = migrate(data);
    for (const k of Object.keys(campaign)) delete campaign[k];
    Object.assign(campaign, next);
    save('load');
}

export function snapshot() {
    return deepClone(campaign);
}
