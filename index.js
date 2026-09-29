// Universal Immersion Engine — SillyTavern extension entry point.
// Boot order: wait for APP_READY -> load settings -> mount settings drawer + wand entry ->
// bind events -> (if enabled) mount overlay UI and load the campaign for the open chat.

import { st, LOG } from './src/st-adapter.js';
import { loadSettings, settingsGet, saveSettings, loadCampaign, bus } from './src/state.js';
import { bindEvents, refreshInjection, startRealtime, stopRealtime } from './src/core.js';
import { mountOverlay, unmountOverlay } from './src/ui/overlay.js';
import { closeAllSheets } from './src/ui/sheet.js';
import { openDeck } from './src/ui/deck.js';
import { mountDrawer } from './src/ui/settings.js';
import { mountPet, unmountPet } from './src/ui/pet.js';
import { mountAtmosphere, unmountAtmosphere } from './src/ui/atmosphere.js';
import { mountVn, unmountVn } from './src/ui/vn.js';

let booted = false;
let uiMounted = false;

function applyTheme() {
    const s = settingsGet();
    document.documentElement.dataset.uieTheme = s.theme || 'glass';
    document.documentElement.dataset.uieAccent = s.accent || 'gold';
}

export function setEnabled(on) {
    const s = settingsGet();
    s.enabled = !!on;
    saveSettings();
    syncEnabled();
}

export function syncEnabled() {
    const s = settingsGet();
    try {
        if (s.enabled) {
            applyTheme();
            if (!uiMounted) {
                mountOverlay();
                uiMounted = true;
            }
            loadCampaign();
            s.helperPet?.show ? mountPet() : unmountPet();
            s.atmosphere ? mountAtmosphere() : unmountAtmosphere();
            s.vnMode ? mountVn() : unmountVn();
            refreshInjection();
            startRealtime();
        } else {
            closeAllSheets();
            unmountOverlay();
            unmountPet();
            unmountAtmosphere();
            unmountVn();
            stopRealtime();
            st.clearPrompts();
            uiMounted = false;
        }
        document.querySelectorAll('.uie-wand-item').forEach(n => n.classList.toggle('uie-disabled', !s.enabled));
    } catch (e) {
        st.error('toggle failed', e);
        globalThis.toastr?.error?.(`UIE failed to ${s.enabled ? 'start' : 'stop'}: ${e?.message || e}`, 'UIE');
    }
}

function addWandEntry() {
    const menu = document.getElementById('extensionsMenu');
    if (!menu || menu.querySelector('.uie-wand-item')) return;
    const item = document.createElement('div');
    item.className = 'list-group-item flex-container flexGap5 interactable uie-wand-item';
    item.tabIndex = 0;
    item.innerHTML = '<div class="fa-solid fa-compass extensionsMenuExtensionButton"></div><span>Immersion Engine</span>';
    const go = () => {
        if (!settingsGet().enabled) setEnabled(true);
        openDeck();
    };
    item.addEventListener('click', go);
    item.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
    menu.appendChild(item);
}

// Small debug/automation handle (used by the e2e tests; handy for power users in the console).
function exposeDebug() {
    import('./src/state.js').then((state) => import('./src/ai/tracker.js').then((tracker) => import('./src/ui/panels.js').then((panels) => {
        globalThis.UIE = Object.freeze({ st, state, tracker, openPanel: panels.openPanel, openDeck, setEnabled, version: '1.0.0' });
    }))).catch(() => { /* ignore */ });
}

async function boot() {
    if (booted) return;
    booted = true;
    try {
        loadSettings();
        applyTheme();
        mountDrawer({ setEnabled });
        addWandEntry();
        bindEvents();
        bus.on((reason) => {
            if (reason !== 'settings') return;
            applyTheme();
            const s = settingsGet();
            if (!s.enabled) return;
            s.helperPet?.show ? mountPet() : unmountPet();
            s.atmosphere ? mountAtmosphere() : unmountAtmosphere();
            s.vnMode ? mountVn() : unmountVn();
        });
        syncEnabled();
        exposeDebug();
        st.log('ready');
    } catch (e) {
        console.error(LOG, 'boot failed', e);
        globalThis.toastr?.error?.(`Universal Immersion Engine failed to start: ${e?.message || e}`, 'UIE');
    }
}

// APP_READY is an auto-firing event: late subscribers are called immediately.
try {
    const ctx = globalThis.SillyTavern?.getContext?.();
    if (ctx?.eventSource && ctx?.eventTypes?.APP_READY) {
        ctx.eventSource.on(ctx.eventTypes.APP_READY, boot);
    } else {
        jQuery(() => setTimeout(boot, 500));
    }
} catch (e) {
    console.error(LOG, 'init failed', e);
}
