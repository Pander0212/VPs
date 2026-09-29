// Event wiring: chat changes, tracker pass, rollback reconciliation, prompt injection,
// macros, slash commands and the optional real-time clock.

import { st } from './st-adapter.js';
import { S, save, loadCampaign, settingsGet, bus, isEphemeral, notifyChanges, mutate } from './state.js';
import { reconcile, fingerprint, fullHash, entriesFor, rollbackEntry } from './engine/ledger.js';
import { compileContext } from './ai/context.js';
import { handleInline, runPass } from './ai/tracker.js';
import { template, recentMessages } from './ai/gen.js';
import { toParts, formatDate, formatTime, realtimeAdvance } from './engine/time.js';
import { locationPath } from './engine/map.js';
import { decayTrackers } from './engine/rules.js';
import { openPanel } from './ui/panels.js';
import { openDeck } from './ui/deck.js';

let bound = false;
let rtTimer = null;
let rtLast = 0;
let rtCarry = 0;

export const enabled = () => settingsGet().enabled !== false;

// ---------------------------------------------------------------- injection

export function refreshInjection() {
    try {
        const set = settingsGet();
        if (!enabled() || isEphemeral()) { st.clearPrompts(); return; }
        if (set.injectEnabled) {
            let text = compileContext(S(), { budget: set.injectBudget, recentText: recentMessages(2), userName: st.userName() });
            // Per-character data stored on the ST card (Characters panel).
            const card = st.readCharField('uie');
            if (card && (card.chatRules || card.drives)) {
                const who = st.charName();
                if (card.drives) text += `\n${who}'s drives: ${String(card.drives).slice(0, 400)}`;
                if (card.chatRules) text += `\n[Rules for ${who}] ${String(card.chatRules).slice(0, 800)}`;
            }
            st.injectPrompt(text, { position: set.injectPosition, depth: set.injectDepth, role: set.injectRole });
        } else {
            st.injectPrompt('', {});
        }
        if (set.trackerMode === 'inline') st.injectInline(template('inline'), { depth: 0, role: 0 });
        else st.injectInline('');
    } catch (e) {
        st.error('injection failed', e);
    }
}

// ---------------------------------------------------------------- reconcile

function doReconcile(reason) {
    if (!enabled() || isEphemeral()) return null;
    const res = reconcile(S(), st.chat(), { source: 'ai', characterNames: st.characters().map(c => c.name) });
    if (res.rolledBack.length || res.replayed.length) {
        save('ops');
        const bits = [];
        if (res.rolledBack.length) bits.push(`rolled back ${res.rolledBack.length} change set${res.rolledBack.length > 1 ? 's' : ''}`);
        if (res.replayed.length) bits.push(`restored ${res.replayed.length} from swipe history`);
        if (res.conflicts) bits.push(`${res.conflicts} manual edit${res.conflicts > 1 ? 's' : ''} kept`);
        if (settingsGet().showChangeToasts) globalThis.toastr?.info?.(`${reason}: ${bits.join(', ')}`, 'UIE', { timeOut: 3000 });
    }
    return res;
}

// ---------------------------------------------------------------- handlers

async function onChatChanged() {
    loadCampaign();
    if (!enabled()) return;
    doReconcile('Chat loaded');
    refreshInjection();
    startRealtime();
}

async function onMessageReceived(idx, type) {
    if (!enabled() || isEphemeral()) return;
    const chat = st.chat();
    idx = typeof idx === 'number' ? idx : chat.length - 1;
    const msg = chat[idx];
    if (!msg || msg.is_user) return;
    doReconcile('Chat changed');
    const set = settingsGet();
    if (type === 'first_message' && !set.trackGreeting) {
        await handleInline(idx, { apply: false });
        refreshInjection();
        return;
    }
    if (set.trackerMode === 'inline') {
        await handleInline(idx, { apply: true });
    } else {
        await handleInline(idx, { apply: false }); // never leak stray tags
        // "Continue" appends to the same message: re-track the whole message.
        if (set.trackerMode === 'pass') await runPass(idx, { force: type === 'continue' });
    }
    refreshInjection();
}

async function onSwipeOrDelete(what) {
    if (!enabled()) return;
    doReconcile(what);
    refreshInjection();
}

async function onEdited(idx) {
    if (!enabled() || isEphemeral()) return;
    const chat = st.chat();
    const msg = chat[idx];
    if (!msg) return;
    const before = entriesFor(S(), idx).length;
    // Rolls back automatically if the edit changed the fingerprint.
    const res = doReconcile('Message edited');
    let changed = (res?.rolledBack || []).some(e => e.idx === idx);
    // Edits deeper in the message keep the fingerprint; compare full hash.
    for (const e of entriesFor(S(), idx)) {
        if (e.full && e.full !== fullHash(msg)) { rollbackEntry(S(), e); changed = true; }
    }
    if (changed || before) save('ops');
    const set = settingsGet();
    if (changed && set.rerunOnEdit && !msg.is_user) {
        if (set.trackerMode === 'pass') await runPass(idx, { force: true });
        else if (set.trackerMode === 'inline') await handleInline(idx, { apply: true });
    }
    refreshInjection();
}

// ---------------------------------------------------------------- real-time clock

export function startRealtime() {
    stopRealtime();
    const s = S();
    if (!enabled() || isEphemeral() || s.calendar.dayMode !== 'realtime') return;
    rtLast = Date.now();
    rtCarry = 0;
    rtTimer = setInterval(() => {
        if (document.hidden) { rtLast = Date.now(); return; }
        const now = Date.now();
        rtCarry += realtimeAdvance(now - rtLast, S().calendar.realMinutesPerDay);
        rtLast = now;
        const whole = Math.floor(rtCarry);
        if (whole >= 1) {
            rtCarry -= whole;
            mutate(st2 => {
                st2.clock.t += whole;
                const d = decayTrackers(st2.trackers, whole);
                for (const [id, v] of Object.entries(d)) st2.trackers[id].value = v;
            }, 'clock');
        }
    }, 20000);
}

export function stopRealtime() {
    if (rtTimer) clearInterval(rtTimer);
    rtTimer = null;
}

// ---------------------------------------------------------------- macros + slash

function registerMacros() {
    const s = () => S();
    const parts = () => toParts(s().clock.t, s().calendar.epoch);
    st.registerMacro('uie_location', () => (enabled() ? locationPath(s().map, s().map.location) : ''), 'UIE: current location path');
    st.registerMacro('uie_time', () => (enabled() ? formatTime(parts(), s().calendar.h24) : ''), 'UIE: current game time');
    st.registerMacro('uie_date', () => (enabled() ? formatDate(parts(), 'long', s().calendar.monthNames) : ''), 'UIE: current game date');
    st.registerMacro('uie_weather', () => (enabled() ? s().weather.kind : ''), 'UIE: current weather');
    st.registerMacro('uie_money', () => (enabled() ? `${s().player.currency} ${s().player.currencyName}` : ''), 'UIE: money');
    st.registerMacro('uie_state', () => (enabled() ? compileContext(s(), { budget: settingsGet().injectBudget }) : ''), 'UIE: full compact state summary');
}

function registerSlash() {
    const cmds = [
        ['uie', () => openDeck(), 'Open the UIE Command Deck'],
        ['uie-map', () => openPanel('map'), 'Open the UIE map'],
        ['uie-inv', () => openPanel('inventory'), 'Open the UIE inventory'],
        ['uie-journal', () => openPanel('journal'), 'Open the UIE journal (quests)'],
        ['uie-diary', () => openPanel('diary'), 'Open the UIE diary'],
        ['uie-npcs', () => openPanel('npclist'), 'Open UIE NPC management'],
        ['uie-calendar', () => openPanel('calendar'), 'Open the UIE calendar'],
        ['uie-orgs', () => openPanel('orgs'), 'Open UIE organizations'],
        ['uie-helper', () => openPanel('helper'), 'Open the UIE helper pet'],
        ['uie-battle', () => openPanel('battle'), 'Open the UIE battle screen'],
        ['uie-phone', () => openPanel('phone'), 'Open the UIE phone'],
        ['uie-settings', () => openPanel('settings'), 'Open UIE settings'],
        ['uie-pass', async () => {
            const chat = st.chat();
            for (let i = chat.length - 1; i >= 0; i--) if (!chat[i].is_user) { await runPass(i, { force: true }); break; }
        }, 'Run the UIE tracker pass on the last AI message'],
    ];
    for (const [name, fn, help] of cmds) st.registerSlash(name, fn, help);
}

// ---------------------------------------------------------------- bind

export function bindEvents() {
    if (bound) return;
    bound = true;
    st.on('CHAT_CHANGED', onChatChanged);
    st.on('MESSAGE_RECEIVED', onMessageReceived);
    st.on('MESSAGE_SWIPED', () => onSwipeOrDelete('Swipe'));
    st.on('MESSAGE_DELETED', () => onSwipeOrDelete('Message deleted'));
    st.on('MESSAGE_SWIPE_DELETED', () => onSwipeOrDelete('Swipe deleted'));
    st.on('MESSAGE_EDITED', onEdited);
    st.on('GENERATION_AFTER_COMMANDS', () => { if (enabled()) refreshInjection(); });
    st.on('GENERATION_STARTED', () => { if (enabled()) refreshInjection(); });
    bus.on(() => scheduleInjection());
    registerMacros();
    registerSlash();
}

let injT = null;
function scheduleInjection() {
    clearTimeout(injT);
    injT = setTimeout(refreshInjection, 150);
}

export { notifyChanges, fingerprint };
