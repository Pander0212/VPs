// Settings: compact drawer in ST's Extensions panel + full settings sheet
// (tracker, injection, HUD, theme, prompt templates, backup/export/import, reset).

import { st } from '../st-adapter.js';
import { settingsGet, saveSettings, S, exportCampaign, importCampaign, resetCampaign, isEphemeral, bus } from '../state.js';
import { DEFAULT_PROMPTS } from '../ai/prompts.js';
import { compileContext } from '../ai/context.js';
import { esc, icon, opt, download, pickFile, reportError, el } from './dom.js';
import { openSheet, confirmDialog } from './sheet.js';
import { estimateTokens } from '../engine/util.js';
import { openDeck } from './deck.js';

let setEnabledRef = null;

const PROMPT_LABELS = {
    tracker: 'Tracker pass (separate call)', inline: 'Inline tag instruction', helper: 'Helper Pet', mapExpand: 'Map: Ask AI to expand',
    npcGen: 'NPC generator', phone: 'Phone texting', phoneSummary: 'Phone summary', fill: 'New Game: AI fill', orgGen: 'Organization generator',
};

// ---------------------------------------------------------------- drawer

export function mountDrawer({ setEnabled }) {
    setEnabledRef = setEnabled;
    const host = document.getElementById('extensions_settings2') || document.getElementById('extensions_settings');
    if (!host || document.getElementById('uie-drawer')) return;
    const node = el(`
    <div id="uie-drawer" class="uie-drawer">
        <div class="inline-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b>${icon('fa-compass')} Universal Immersion Engine</b>
                <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content">
                <div class="uie-drawer-body"></div>
            </div>
        </div>
    </div>`);
    host.appendChild(node);
    renderDrawer();
    bus.on((r) => { if (r === 'settings') renderDrawer(); });
}

function renderDrawer() {
    const body = document.querySelector('#uie-drawer .uie-drawer-body');
    if (!body) return;
    const s = settingsGet();
    body.innerHTML = `
        <label class="checkbox_label uie-row"><input type="checkbox" data-k="enabled" ${s.enabled ? 'checked' : ''}> <b>Enable UIE</b></label>
        <small class="uie-drawer-hint">Turning this off removes every UIE button, overlay, prompt injection and handler. SillyTavern keeps working normally.</small>
        <div class="uie-drawer-btns">
            <button class="menu_button" data-a="deck">${icon('fa-compass')} Command Deck</button>
            <button class="menu_button" data-a="full">${icon('fa-sliders')} All settings</button>
        </div>
        <label>State tracking
            <select class="text_pole" data-k="trackerMode">
                ${opt('pass', 'Separate pass after each reply (accurate, +1 API call)', s.trackerMode === 'pass')}
                ${opt('inline', 'Inline tags in the reply (cheap)', s.trackerMode === 'inline')}
                ${opt('off', 'Off (manual only, saves quota)', s.trackerMode === 'off')}
            </select>
        </label>
        <label>Theme
            <select class="text_pole" data-k="theme">
                ${opt('glass', 'Dark glass (gold)', s.theme === 'glass')}
                ${opt('parchment', 'Parchment everywhere', s.theme === 'parchment')}
                ${opt('midnight', 'Midnight (teal)', s.theme === 'midnight')}
            </select>
        </label>
        <div class="uie-drawer-btns">
            <button class="menu_button" data-a="export">${icon('fa-download')} Export campaign</button>
            <button class="menu_button" data-a="import">${icon('fa-upload')} Import</button>
        </div>`;
    body.onchange = (e) => {
        const k = e.target.dataset.k;
        if (!k) return;
        if (k === 'enabled') { setEnabledRef?.(e.target.checked); return; }
        settingsGet()[k] = e.target.value;
        saveSettings();
    };
    body.onclick = (e) => {
        const a = e.target.closest('[data-a]')?.dataset.a;
        if (!a) return;
        if (!settingsGet().enabled && a !== 'export') { globalThis.toastr?.info?.('Enable UIE first.', 'UIE'); return; }
        if (a === 'deck') openDeck();
        if (a === 'full') open();
        if (a === 'export') doExport();
        if (a === 'import') doImport();
    };
}

// ---------------------------------------------------------------- backup helpers

export function doExport() {
    const name = `uie-campaign-${(st.chatId() || 'nochat').toString().replace(/[^\w-]+/g, '_').slice(0, 40)}-${new Date().toISOString().slice(0, 10)}.json`;
    download(name, exportCampaign());
}

export async function doImport() {
    if (isEphemeral()) { globalThis.toastr?.warning?.('Open a chat first — campaigns are saved per chat.', 'UIE'); return; }
    const f = await pickFile('application/json,.json');
    if (!f) return;
    try {
        const txt = await f.text();
        if (!await confirmDialog('Import campaign', 'This replaces the campaign in the current chat. Continue?', { okLabel: 'Import', danger: true })) return;
        importCampaign(txt);
        globalThis.toastr?.success?.('Campaign imported.', 'UIE');
    } catch (e) {
        reportError(new Error(`Import failed: ${e?.message || e}`));
    }
}

// ---------------------------------------------------------------- full sheet

const TABS = [
    ['general', 'General', 'fa-gear'],
    ['ai', 'AI & Tracking', 'fa-brain'],
    ['hud', 'HUD', 'fa-gauge'],
    ['prompts', 'Prompts', 'fa-pen-nib'],
    ['backup', 'Backup', 'fa-floppy-disk'],
];

export function open(params = {}) {
    const sheet = openSheet({ id: 'settings', title: 'Settings', icon: 'fa-sliders' });
    let tab = params.tab || 'general';
    const render = () => {
        const s = settingsGet();
        sheet.body.innerHTML = `
            <nav class="uie-tabs" role="tablist">${TABS.map(([id, label, ic]) => `<button role="tab" class="uie-tab ${tab === id ? 'active' : ''}" data-tab="${id}" aria-selected="${tab === id}">${icon(ic)} ${esc(label)}</button>`).join('')}</nav>
            <div class="uie-pad">${renderTab(tab, s)}</div>`;
    };
    render();
    sheet.body.addEventListener('click', async (e) => {
        const t = e.target.closest('[data-tab]');
        if (t) { tab = t.dataset.tab; render(); return; }
        const a = e.target.closest('[data-a]')?.dataset.a;
        if (!a) return;
        try {
            await action(a, e.target.closest('[data-a]'), render);
        } catch (err) { reportError(err); }
    });
    sheet.body.addEventListener('change', (e) => {
        const k = e.target.dataset.k;
        if (!k) return;
        const s = settingsGet();
        let v = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
        if (e.target.type === 'number' || e.target.dataset.num) v = Number(v);
        if (k === 'enabled') { setEnabledRef?.(v); return; }
        const path = k.split('.');
        let o = s;
        for (let i = 0; i < path.length - 1; i++) o = o[path[i]] = o[path[i]] || {};
        o[path.at(-1)] = v;
        saveSettings();
        if (k.startsWith('inject') || k === 'trackerMode') render();
    });
    sheet.body.addEventListener('input', (e) => {
        const p = e.target.dataset.prompt;
        if (!p) return;
        settingsGet().prompts[p] = e.target.value;
        saveSettings();
    });
    return sheet;
}

function renderTab(tab, s) {
    switch (tab) {
        case 'general': return `
            <div class="uie-card">
                <label class="uie-switch"><input type="checkbox" data-k="enabled" ${s.enabled ? 'checked' : ''}><span></span> Enable Universal Immersion Engine</label>
                <label class="uie-field"><span>Theme</span><select data-k="theme">${opt('glass', 'Dark glass (gold)', s.theme === 'glass')}${opt('parchment', 'Parchment', s.theme === 'parchment')}${opt('midnight', 'Midnight (teal)', s.theme === 'midnight')}</select></label>
                <label class="uie-field"><span>Launcher position</span><select data-k="launcherCorner">${opt('br', 'Bottom right', s.launcherCorner === 'br')}${opt('bl', 'Bottom left', s.launcherCorner === 'bl')}${opt('tr', 'Top right', s.launcherCorner === 'tr')}${opt('tl', 'Top left', s.launcherCorner === 'tl')}</select><small>Tip: long-press the launcher to move it.</small></label>
                <label class="uie-switch"><input type="checkbox" data-k="showChangeToasts" ${s.showChangeToasts ? 'checked' : ''}><span></span> Show a toast listing state changes</label>
                <label class="uie-switch"><input type="checkbox" data-k="helperPet.show" ${s.helperPet.show ? 'checked' : ''}><span></span> Show Helper Pet</label>
                <label class="uie-field"><span>Helper Pet look &amp; name</span><div class="uie-row"><input data-k="helperPet.emoji" value="${esc(s.helperPet.emoji)}" maxlength="4" class="uie-w-emoji"><input data-k="helperPet.name" value="${esc(s.helperPet.name)}" maxlength="24"></div></label>
                <label class="uie-switch"><input type="checkbox" data-k="atmosphere" ${s.atmosphere ? 'checked' : ''}><span></span> Atmosphere overlay (weather &amp; time-of-day tint)</label>
                <label class="uie-switch"><input type="checkbox" data-k="vnMode" ${s.vnMode ? 'checked' : ''}><span></span> Visual-novel stage for the last AI message</label>
                <label class="uie-switch"><input type="checkbox" data-k="narratorNotes" ${s.narratorNotes ? 'checked' : ''}><span></span> Post a narrator note when travelling / doing activities</label>
            </div>
            <div class="uie-card uie-danger-zone">
                <h4>${icon('fa-rotate-left')} Reset campaign for this chat</h4>
                <p class="uie-muted">Deletes inventory, map, NPCs, quests, diary… for the current chat only. Export first if unsure.</p>
                <button class="uie-btn uie-btn-danger" data-a="reset">${icon('fa-trash')} Reset this chat's campaign</button>
            </div>`;
        case 'ai': {
            const preview = compileContext(S(), { budget: s.injectBudget, userName: st.userName() });
            return `
            <div class="uie-card">
                <h4>${icon('fa-magnifying-glass-chart')} State extraction</h4>
                <label class="uie-field"><span>Mode</span><select data-k="trackerMode">
                    ${opt('pass', 'Separate pass after each AI reply (default)', s.trackerMode === 'pass')}
                    ${opt('inline', 'Inline <uie> tags inside the reply (no extra call)', s.trackerMode === 'inline')}
                    ${opt('off', 'Off — manual only (saves API quota)', s.trackerMode === 'off')}</select></label>
                <label class="uie-field"><span>Messages sent to the tracker pass</span><select data-k="trackerContext" data-num="1">${[1, 2, 3].map(n => opt(n, `${n}`, Number(s.trackerContext) === n)).join('')}</select></label>
                <label class="uie-field"><span>AI call timeout (seconds)</span><input type="number" min="10" max="300" data-k="trackerTimeoutSec" value="${esc(s.trackerTimeoutSec)}"></label>
                <label class="uie-switch"><input type="checkbox" data-k="rerunOnEdit" ${s.rerunOnEdit ? 'checked' : ''}><span></span> Roll back and re-track when a message is edited</label>
                <label class="uie-switch"><input type="checkbox" data-k="trackGreeting" ${s.trackGreeting ? 'checked' : ''}><span></span> Also track the character's greeting</label>
                <button class="uie-btn" data-a="pass">${icon('fa-play')} Run tracker on last AI message now</button>
            </div>
            <div class="uie-card">
                <h4>${icon('fa-syringe')} Context injection</h4>
                <label class="uie-switch"><input type="checkbox" data-k="injectEnabled" ${s.injectEnabled ? 'checked' : ''}><span></span> Inject the game state before every generation</label>
                <div class="uie-grid2">
                    <label class="uie-field"><span>Position</span><select data-k="injectPosition" data-num="1">${opt(1, 'In chat @ depth', Number(s.injectPosition) === 1)}${opt(0, 'After story string', Number(s.injectPosition) === 0)}${opt(2, 'Before story string', Number(s.injectPosition) === 2)}</select></label>
                    <label class="uie-field"><span>Depth</span><input type="number" min="0" max="50" data-k="injectDepth" value="${esc(s.injectDepth)}"></label>
                    <label class="uie-field"><span>Role</span><select data-k="injectRole" data-num="1">${opt(0, 'System', Number(s.injectRole) === 0)}${opt(1, 'User', Number(s.injectRole) === 1)}${opt(2, 'Assistant', Number(s.injectRole) === 2)}</select></label>
                    <label class="uie-field"><span>Token budget</span><input type="number" min="80" max="4000" step="20" data-k="injectBudget" value="${esc(s.injectBudget)}"></label>
                </div>
                <details class="uie-details"><summary>Preview (≈${estimateTokens(preview)} tokens)</summary><pre class="uie-pre">${esc(preview)}</pre></details>
                <p class="uie-muted">Macros: <code>{{uie_location}}</code> <code>{{uie_time}}</code> <code>{{uie_date}}</code> <code>{{uie_weather}}</code> <code>{{uie_money}}</code> <code>{{uie_state}}</code></p>
            </div>`;
        }
        case 'hud': return `
            <div class="uie-card">
                <label class="uie-switch"><input type="checkbox" data-k="hud.show" ${s.hud.show ? 'checked' : ''}><span></span> Show the HUD strip</label>
                <label class="uie-switch"><input type="checkbox" data-k="hud.expanded" ${s.hud.expanded ? 'checked' : ''}><span></span> Start expanded</label>
                <h4>Items</h4>
                <div class="uie-grid2">${Object.entries({ time: 'Date / time', weather: 'Weather', status: 'Status effects', location: 'Location', currency: 'Currency', hp: 'HP', ap: 'AP', mp: 'MP', xp: 'XP', trackers: 'Life trackers' })
                    .map(([k, l]) => `<label class="uie-switch"><input type="checkbox" data-k="hud.items.${k}" ${s.hud.items[k] ? 'checked' : ''}><span></span> ${esc(l)}</label>`).join('')}</div>
            </div>`;
        case 'prompts': return `
            <p class="uie-muted">Edit the templates UIE sends to your model. Placeholders like <code>{{state}}</code> and <code>{{messages}}</code> are filled automatically.</p>
            ${Object.keys(DEFAULT_PROMPTS).map(k => `
                <div class="uie-card">
                    <div class="uie-row uie-between"><h4>${esc(PROMPT_LABELS[k] || k)}</h4><button class="uie-btn uie-btn-sm" data-a="resetPrompt" data-p="${k}">${icon('fa-rotate-left')} Reset</button></div>
                    <textarea class="uie-prompt" rows="6" data-prompt="${k}">${esc(s.prompts[k] || DEFAULT_PROMPTS[k])}</textarea>
                </div>`).join('')}`;
        case 'backup': return `
            <div class="uie-card">
                <h4>${icon('fa-floppy-disk')} Back up this chat's campaign</h4>
                <p class="uie-muted">Campaign data is saved inside the chat file automatically. Export a JSON copy to keep it safe or move it to another chat or device.</p>
                <div class="uie-row uie-wrap">
                    <button class="uie-btn uie-btn-primary" data-a="export">${icon('fa-download')} Export JSON</button>
                    <button class="uie-btn" data-a="import">${icon('fa-upload')} Import JSON</button>
                    <button class="uie-btn" data-a="copy">${icon('fa-copy')} Copy to clipboard</button>
                </div>
                <p class="uie-muted">Size: ${Math.round(exportCampaign().length / 1024)} KB · ${S().log.length} tracked change sets</p>
            </div>
            <div class="uie-card">
                <h4>${icon('fa-gear')} Settings backup</h4>
                <button class="uie-btn" data-a="exportSettings">${icon('fa-download')} Export settings &amp; prompts</button>
            </div>`;
    }
    return '';
}

async function action(a, btn, render) {
    switch (a) {
        case 'reset':
            if (isEphemeral()) { globalThis.toastr?.warning?.('No chat open.', 'UIE'); return; }
            if (await confirmDialog('Reset campaign?', 'All UIE data for this chat will be deleted. This cannot be undone.', { okLabel: 'Reset', danger: true })) {
                resetCampaign();
                globalThis.toastr?.success?.('Campaign reset.', 'UIE');
            }
            return;
        case 'resetPrompt':
            delete settingsGet().prompts[btn.dataset.p];
            saveSettings();
            render();
            return;
        case 'export': doExport(); return;
        case 'import': await doImport(); render(); return;
        case 'copy':
            await navigator.clipboard.writeText(exportCampaign());
            globalThis.toastr?.success?.('Copied.', 'UIE');
            return;
        case 'exportSettings':
            download('uie-settings.json', JSON.stringify(settingsGet(), null, 1));
            return;
        case 'pass': {
            const { runPass } = await import('../ai/tracker.js');
            const chat = st.chat();
            for (let i = chat.length - 1; i >= 0; i--) {
                if (!chat[i].is_user) { const r = await runPass(i, { force: true }); if (!r?.changes?.length) globalThis.toastr?.info?.('No changes found.', 'UIE'); break; }
            }
        }
    }
}
