// New Game wizard: tabbed campaign setup. Every tab is optional; "AI fill the rest" asks the
// model to complete empty parts. Starting seeds chatMetadata.uie for this chat.

import { S, mutate, isEphemeral, resetCampaign, settingsGet } from '../state.js';
import { st } from '../st-adapter.js';
import { openSheet, formDialog, confirmDialog } from './sheet.js';
import { esc, icon, opt, reportError } from './dom.js';
import { DEFAULT_BARS } from '../engine/schema.js';
import { DEFAULT_TRACKERS, ITEM_CATEGORIES, CATEGORY_META, guessCategory, defaultEffects } from '../engine/rules.js';
import { uid, str, text, deepClone, clamp, num } from '../engine/util.js';
import { guessPin } from '../engine/map.js';
import { genJson, render as renderPrompt, recentMessages } from '../ai/gen.js';

const TABS = [
    ['character', 'Character', '👤'], ['appearance', 'Appearance', '🎨'], ['currency', 'Currency & Groups', '💰'], ['trackers', 'Life Trackers', '💗'],
    ['items', 'Items & Equipment', '🎒'], ['skills', 'Skills', '⚡'], ['quests', 'Quests', '📜'], ['lore', 'Lorebook', '📚'],
    ['assets', 'Assets', '🏛️'], ['npcs', 'NPCs', '🧑‍🤝‍🧑'], ['start', 'Starting Location', '🗺️'],
];
const CLASSES = ['Warrior', 'Mage', 'Rogue', 'Ranger', 'Cleric', 'Paladin', 'Bard', 'Student', 'Detective', 'Pilot', 'Hacker', 'Civilian', 'Custom'];

function draftFromState() {
    const s = S();
    return {
        name: s.player.name || st.userName(), cls: s.player.cls || 'Warrior', profile: s.player.profile || 'hybrid', level: s.player.level || 1, age: s.player.age || '',
        bars: deepClone(s.player.bars || DEFAULT_BARS), appearance: s.player.appearance || '',
        currencyName: s.player.currencyName || 'Gold', currencySymbol: s.player.currencySymbol || '🪙', currency: s.player.currency ?? 100, groups: '',
        trackers: deepClone(s.trackers || DEFAULT_TRACKERS), items: [], skills: [], quests: [], lore: st.meta()?.world_info || '', assets: [], npcs: [],
        start: { world: 'The Known World', region: 'Home Region', local: '', kind: 'town', desc: '' }, opening: '',
    };
}

export function open() {
    if (isEphemeral()) { globalThis.toastr?.warning?.('Open a chat first — each chat is its own campaign.', 'UIE'); return null; }
    const sheet = openSheet({ id: 'newgame', title: 'New Game', icon: 'fa-dice-d20', size: 'wide' });
    const view = { tab: 'character', d: draftFromState(), busy: false };

    const list = (arr, fmt, addLabel, key) => `<div class="uie-wizard-list">${arr.map((x, i) => `<div class="uie-wizard-row"><div class="uie-grow">${fmt(x)}</div><button type="button" class="uie-icon-btn" data-rm="${key}|${i}" aria-label="Remove">${icon('fa-xmark')}</button></div>`).join('') || '<p class="uie-muted">None yet.</p>'}</div><button type="button" class="uie-btn" data-add="${key}" style="margin-top:10px">${icon('fa-plus')} ${addLabel}</button>`;

    const body = () => {
        const d = view.d;
        switch (view.tab) {
            case 'character': return `
                <div class="uie-grid2">
                    <label class="uie-field"><span>Character name</span><input data-k="name" value="${esc(d.name)}" placeholder="Enter character name…"></label>
                    <label class="uie-field"><span>Class</span><select data-k="cls">${CLASSES.map(c => opt(c, c, d.cls === c)).join('')}${CLASSES.includes(d.cls) ? '' : opt(d.cls, d.cls, true)}</select></label>
                </div>
                <label class="uie-field"><span>Resource profile</span><select data-k="profile">${opt('hybrid', 'Hybrid (Both AP and MP)', d.profile === 'hybrid')}${opt('ap', 'AP only (physical)', d.profile === 'ap')}${opt('mp', 'MP only (magic)', d.profile === 'mp')}</select></label>
                <h4>Primary life &amp; status bars</h4>
                <div class="uie-wizard-list">${Object.entries(d.bars).map(([id, b]) => `<div class="uie-wizard-row"><div class="uie-grow"><b>${esc(b.label || id.toUpperCase())}</b><div class="uie-row"><div class="uie-bar" style="width:120px"><div class="uie-bar-fill" style="width:${b.max ? (b.value / b.max) * 100 : 0}%;--c:${esc(b.color)}"></div></div><small class="uie-muted">${esc(b.value)}/${esc(b.max)} · ${b.visible === false ? 'Hidden' : 'Visible'}</small></div></div><button type="button" class="uie-btn uie-btn-sm" data-editbar="${esc(id)}">Edit</button><button type="button" class="uie-btn uie-btn-sm" data-rmbar="${esc(id)}">Remove</button></div>`).join('')}</div>
                <button type="button" class="uie-btn" data-addbar style="margin-top:10px">${icon('fa-plus')} Add bar</button>
                <div class="uie-grid2" style="margin-top:14px">
                    <label class="uie-field"><span>Starting level</span><input type="number" min="1" max="99" data-k="level" value="${esc(d.level)}"></label>
                    <label class="uie-field"><span>Starting age</span><input data-k="age" value="${esc(d.age)}"></label>
                </div>`;
            case 'appearance': return `<label class="uie-field"><span>Appearance &amp; style</span><textarea data-k="appearance" rows="8" placeholder="Hair, eyes, build, clothes, distinguishing marks…">${esc(d.appearance)}</textarea></label>`;
            case 'currency': return `
                <div class="uie-grid2">
                    <label class="uie-field"><span>Currency name</span><input data-k="currencyName" value="${esc(d.currencyName)}"></label>
                    <label class="uie-field"><span>Symbol</span><input data-k="currencySymbol" value="${esc(d.currencySymbol)}" maxlength="3" class="uie-w-emoji"></label>
                    <label class="uie-field"><span>Starting amount</span><input type="number" min="0" data-k="currency" value="${esc(d.currency)}"></label>
                </div>
                <label class="uie-field"><span>Groups / factions you know (one per line; name: standing 0-100)</span><textarea data-k="groups" rows="4" placeholder="Night Market Guild: 60&#10;City Watch: 40">${esc(d.groups)}</textarea></label>`;
            case 'trackers': return `
                <p class="uie-muted">Needs that decay over time. Defaults: Hunger, Energy, Hygiene.</p>
                <div class="uie-wizard-list">${Object.entries(d.trackers).map(([id, t]) => `<div class="uie-wizard-row"><div class="uie-grow"><b>${esc(t.label)}</b><small class="uie-muted"> start ${esc(t.value)} · −${esc(t.decayPerHour)}/h · ${t.visible === false ? 'hidden' : 'visible'}</small></div><button type="button" class="uie-btn uie-btn-sm" data-edittrk="${esc(id)}">Edit</button><button type="button" class="uie-btn uie-btn-sm" data-rmtrk="${esc(id)}">Remove</button></div>`).join('')}</div>
                <button type="button" class="uie-btn" data-addtrk style="margin-top:10px">${icon('fa-plus')} Add tracker</button>`;
            case 'items': return list(d.items, x => `<b>${esc(x.name)}</b> <small class="uie-muted">×${esc(x.qty)} · ${esc(x.cat)}${x.equip ? ' · equipped' : ''}</small>`, 'Add item', 'items');
            case 'skills': return list(d.skills, x => `<b>${esc(x.name)}</b> <small class="uie-muted">${esc(x.desc || '')}</small>`, 'Add skill', 'skills');
            case 'quests': return list(d.quests, x => `<b>${esc(x.title)}</b> <small class="uie-muted">${esc(x.desc || '')}</small>`, 'Add quest', 'quests');
            case 'lore': {
                const books = st.worldNames();
                return `<p class="uie-muted">Link a SillyTavern World Info book to this chat (it becomes the chat's lorebook).</p>
                    <label class="uie-field"><span>Lorebook</span><select data-k="lore">${opt('', '— none —', !d.lore)}${books.map(b => opt(b, b, d.lore === b)).join('')}</select></label>
                    ${books.length ? '' : '<p class="uie-muted">No World Info books found. Create one in ST\'s World Info panel.</p>'}`;
            }
            case 'assets': return list(d.assets, x => `<b>${esc(x.name)}</b> <small class="uie-muted">${esc(x.kind || '')}</small>`, 'Add asset (vehicle, home, shop…)', 'assets');
            case 'npcs': return list(d.npcs, x => `<b>${esc(x.name)}</b> <small class="uie-muted">${esc(x.role || '')}</small>`, 'Add NPC', 'npcs');
            case 'start': return `
                <div class="uie-grid2">
                    <label class="uie-field"><span>World</span><input data-k="start.world" value="${esc(d.start.world)}"></label>
                    <label class="uie-field"><span>Region</span><input data-k="start.region" value="${esc(d.start.region)}"></label>
                    <label class="uie-field"><span>Starting place</span><input data-k="start.local" value="${esc(d.start.local)}" placeholder="Adventurer's Path"></label>
                    <label class="uie-field"><span>Kind</span><input data-k="start.kind" value="${esc(d.start.kind)}" placeholder="town, forest, station…"></label>
                </div>
                <label class="uie-field"><span>Description</span><textarea data-k="start.desc" rows="3">${esc(d.start.desc)}</textarea></label>
                <label class="uie-field"><span>Opening narration (optional, posted to chat)</span><textarea data-k="opening" rows="4">${esc(d.opening)}</textarea></label>`;
        }
        return '';
    };

    const render = () => {
        sheet.body.innerHTML = `
            <nav class="uie-tabs">${TABS.map(([k, l, e]) => `<button class="uie-tab ${view.tab === k ? 'active' : ''}" data-tab="${k}">${e} ${esc(l)}</button>`).join('')}</nav>
            <form class="uie-pad" data-ngform>${body()}</form>
            <div class="uie-sticky-foot">
                <button class="uie-btn" data-ng="fill" ${view.busy ? 'disabled' : ''}>${icon(view.busy ? 'fa-spinner' : 'fa-wand-magic-sparkles', view.busy ? 'fa-spin' : '')} AI fill the rest</button>
                <button class="uie-btn uie-btn-primary" data-ng="start">${icon('fa-play')} Start game</button>
            </div>`;
    };
    render();

    sheet.body.addEventListener('input', (e) => {
        const k = e.target.dataset.k;
        if (!k) return;
        const path = k.split('.');
        let o = view.d;
        for (let i = 0; i < path.length - 1; i++) o = o[path[i]];
        o[path.at(-1)] = e.target.type === 'number' ? Number(e.target.value) : e.target.value;
    });
    sheet.body.addEventListener('change', (e) => { if (e.target.tagName === 'SELECT') e.target.dispatchEvent(new Event('input', { bubbles: true })); });

    sheet.body.addEventListener('click', async (e) => {
        try {
            const d = view.d;
            const t = e.target.closest('[data-tab]');
            if (t) { view.tab = t.dataset.tab; render(); return; }
            const rm = e.target.closest('[data-rm]');
            if (rm) { const [k, i] = rm.dataset.rm.split('|'); d[k].splice(Number(i), 1); render(); return; }
            const rmb = e.target.closest('[data-rmbar]');
            if (rmb) { delete d.bars[rmb.dataset.rmbar]; render(); return; }
            const rmt = e.target.closest('[data-rmtrk]');
            if (rmt) { delete d.trackers[rmt.dataset.rmtrk]; render(); return; }
            const eb = e.target.closest('[data-editbar]') || e.target.closest('[data-addbar]');
            if (eb) {
                const id = eb.dataset.editbar;
                const b = id ? d.bars[id] : { label: '', value: 100, max: 100, color: '#7fb3d5', visible: true };
                const v = await formDialog(id ? `Edit ${b.label}` : 'Add bar', `
                    <div class="uie-grid2"><label class="uie-field"><span>Label</span><input name="label" value="${esc(b.label)}" maxlength="16"></label><label class="uie-field"><span>Color</span><input name="color" type="color" value="${esc(b.color)}"></label>
                    <label class="uie-field"><span>Current</span><input name="value" type="number" value="${esc(b.value)}"></label><label class="uie-field"><span>Max</span><input name="max" type="number" min="1" value="${esc(b.max)}"></label></div>
                    <label class="uie-switch"><input type="checkbox" name="visible" ${b.visible !== false ? 'checked' : ''}><span></span> Visible</label>`);
                if (!v || !String(v.label).trim()) return;
                const key = id || str(v.label, 16).toLowerCase().replace(/[^a-z0-9]+/g, '_');
                d.bars[key] = { ...b, label: str(v.label, 16), color: v.color, max: clamp(num(v.max, 100), 1, 9999), value: clamp(num(v.value, 0), 0, clamp(num(v.max, 100), 1, 9999)), visible: !!v.visible, icon: b.icon || 'fa-circle' };
                render();
                return;
            }
            const et = e.target.closest('[data-edittrk]') || e.target.closest('[data-addtrk]');
            if (et) {
                const id = et.dataset.edittrk;
                const tr = id ? d.trackers[id] : { label: '', value: 80, min: 0, max: 100, decayPerHour: 2, color: '#9ad08b', icon: 'fa-circle', visible: true };
                const v = await formDialog(id ? `Edit ${tr.label}` : 'Add tracker', `
                    <div class="uie-grid2"><label class="uie-field"><span>Label</span><input name="label" value="${esc(tr.label)}" maxlength="20"></label><label class="uie-field"><span>Color</span><input name="color" type="color" value="${esc(tr.color)}"></label>
                    <label class="uie-field"><span>Start value</span><input name="value" type="number" value="${esc(tr.value)}"></label><label class="uie-field"><span>Decay per hour</span><input name="decay" type="number" step="0.5" value="${esc(tr.decayPerHour)}"></label></div>
                    <label class="uie-switch"><input type="checkbox" name="visible" ${tr.visible !== false ? 'checked' : ''}><span></span> Visible in HUD</label>`);
                if (!v || !String(v.label).trim()) return;
                const key = id || str(v.label, 20).toLowerCase().replace(/[^a-z0-9]+/g, '_');
                d.trackers[key] = { ...tr, label: str(v.label, 20), color: v.color, value: clamp(num(v.value, 80), 0, 100), decayPerHour: clamp(num(v.decay, 0), -50, 50), visible: !!v.visible };
                render();
                return;
            }
            const add = e.target.closest('[data-add]')?.dataset.add;
            if (add) {
                const forms = {
                    items: `<label class="uie-field"><span>Name</span><input name="name"></label><div class="uie-grid2"><label class="uie-field"><span>Qty</span><input name="qty" type="number" value="1" min="1"></label><label class="uie-field"><span>Category</span><select name="cat">${opt('', 'Auto')}${ITEM_CATEGORIES.map(c => opt(c, CATEGORY_META[c].label)).join('')}</select></label></div><label class="uie-switch"><input type="checkbox" name="equip"><span></span> Equipped</label>`,
                    skills: '<label class="uie-field"><span>Skill</span><input name="name"></label><label class="uie-field"><span>Description</span><input name="desc"></label>',
                    quests: '<label class="uie-field"><span>Title</span><input name="title"></label><label class="uie-field"><span>Description</span><textarea name="desc" rows="2"></textarea></label>',
                    assets: '<label class="uie-field"><span>Name</span><input name="name" placeholder="Old pickup truck"></label><label class="uie-field"><span>Kind</span><input name="kind" placeholder="vehicle, home, shop, ship…"></label>',
                    npcs: '<label class="uie-field"><span>Name</span><input name="name"></label><label class="uie-field"><span>Role</span><input name="role"></label><label class="uie-field"><span>Personality</span><input name="personality"></label>',
                };
                const v = await formDialog('Add', forms[add], { okLabel: 'Add' });
                if (!v || !(v.name || v.title || '').trim()) return;
                if (add === 'items') v.qty = clamp(num(v.qty, 1), 1, 999);
                d[add].push(v);
                render();
                return;
            }
            const a = e.target.closest('[data-ng]')?.dataset.ng;
            if (a === 'fill') await aiFill();
            if (a === 'start') await start();
        } catch (err) { reportError(err); }
    });

    async function aiFill() {
        view.busy = true; render();
        try {
            const d = view.d;
            const given = { name: d.name, cls: d.cls, appearance: d.appearance, currencyName: d.currencyName, start: d.start, items: d.items, skills: d.skills, quests: d.quests, npcs: d.npcs, character: st.charName() };
            const { value: v } = await genJson(renderPrompt('fill', { extra: JSON.stringify(given), messages: recentMessages(3) || `Character card: ${st.charName()}` }), { label: 'New game fill', responseLength: 900 });
            if (!v || typeof v !== 'object') throw new Error('No data returned.');
            if (!d.name && v.name) d.name = str(v.name, 60);
            if (v.cls && (!d.cls || d.cls === 'Warrior')) d.cls = str(v.cls, 40);
            if (!d.appearance && v.appearance) d.appearance = text(v.appearance, 1200);
            if (v.currencyName && d.currencyName === 'Gold') d.currencyName = str(v.currencyName, 30);
            if (!d.start.local && v.startLocation?.name) Object.assign(d.start, { local: str(v.startLocation.name, 60), kind: str(v.startLocation.kind || d.start.kind, 40), desc: text(v.startLocation.desc || '', 300) });
            if (v.region && d.start.region === 'Home Region') d.start.region = str(v.region, 60);
            if (v.world && d.start.world === 'The Known World') d.start.world = str(v.world, 60);
            for (const key of ['items', 'skills', 'quests', 'npcs']) {
                if (!d[key].length && Array.isArray(v[key])) d[key] = v[key].slice(0, 8).filter(x => x && (x.name || x.title)).map(x => ({ ...x, qty: clamp(num(x.qty, 1), 1, 99) }));
            }
            if (!d.opening && v.opening) d.opening = text(v.opening, 1500);
            globalThis.toastr?.success?.('Filled in the blanks — review and start.', 'UIE');
        } finally { view.busy = false; render(); }
    }

    async function start() {
        const d = view.d;
        const s0 = S();
        const hasData = Object.keys(s0.inventory).length || Object.keys(s0.npcs).length || s0.log.length;
        if (hasData && !await confirmDialog('Start a new game?', 'This replaces the current campaign in this chat (diary entries are kept).', { okLabel: 'Start', danger: true })) return;
        const diary = deepClone(s0.diary);
        resetCampaign();
        mutate(s => {
            s.diary = diary;
            s.newGameDone = true;
            Object.assign(s.player, { name: str(d.name, 60), cls: str(d.cls, 40), profile: d.profile, level: clamp(num(d.level, 1), 1, 99), age: str(d.age, 20), appearance: text(d.appearance, 1500), currencyName: str(d.currencyName, 30) || 'Gold', currencySymbol: str(d.currencySymbol, 3) || '🪙', currency: clamp(num(d.currency, 0), 0, 1e9) });
            s.player.bars = deepClone(d.bars);
            if (d.profile === 'ap' && s.player.bars.mp) s.player.bars.mp.visible = false;
            if (d.profile === 'mp' && s.player.bars.ap) s.player.bars.ap.visible = false;
            s.trackers = deepClone(d.trackers);
            for (const it of d.items) {
                const id = uid('item');
                const cat = ITEM_CATEGORIES.includes(it.cat) ? it.cat : guessCategory(it.name);
                s.inventory[id] = { id, name: str(it.name, 60), qty: clamp(num(it.qty, 1), 1, 999), cat, desc: '', icon: '', tags: [], effects: defaultEffects(cat, it.name), added: s.clock.t };
                if (it.equip) s.equipment[cat === 'weapon' ? 'hand' : cat === 'armor' ? 'body' : cat] = id;
            }
            for (const a of d.assets) { const id = uid('item'); s.inventory[id] = { id, name: str(a.name, 60), qty: 1, cat: 'misc', desc: str(a.kind, 60), icon: '🏛️', tags: ['asset', str(a.kind, 20)], effects: {}, added: s.clock.t }; }
            s.player.skills = Object.fromEntries(d.skills.map(k => [uid('sk'), { name: str(k.name, 60), desc: str(k.desc, 200) }]));
            for (const q of d.quests) { const id = uid('q'); s.quests[id] = { id, title: str(q.title, 120), desc: text(q.desc || '', 600), status: 'active', objectives: {}, created: s.clock.t, giver: '', reward: '' }; }
            for (const n of d.npcs) { const id = uid('npc'); s.npcs[id] = { id, name: str(n.name, 60), aliases: [], role: str(n.role, 120) || 'NPC', title: '', age: '', location: '', appearance: text(n.appearance || '', 600), personality: text(n.personality || '', 600), orgs: [], rumors: '', secrets: '', schedule: [], notes: '', locked: false, card: '', rel: { affection: 30, trust: 30, standing: 50, memories: [] }, met: s.clock.t }; }
            for (const line of String(d.groups || '').split('\n')) {
                const m = /^\s*([^:]+?)\s*(?::\s*(\d+))?\s*$/.exec(line);
                if (!m || !m[1]) continue;
                const id = uid('org');
                s.orgs[id] = { id, name: str(m[1], 60), type: 'organization', mainLocation: '', locationKind: 'local', standing: clamp(num(m[2], 50), 0, 100), scale: 'local', leaderTitle: '', leaderId: 'hidden', subLeaders: '', purpose: '', members: {}, influence: [], rules: '', runins: [] };
            }
            // Map: world > region > starting place
            const w = s.map.nodes.loc_world, r = s.map.nodes.loc_region, l = s.map.nodes.loc_start;
            w.name = str(d.start.world, 60) || w.name;
            r.name = str(d.start.region, 60) || r.name;
            if (d.start.local) { l.name = str(d.start.local, 60); l.kind = str(d.start.kind, 40); l.desc = text(d.start.desc, 300); l.pin = guessPin(d.start.kind, d.start.local); }
        });
        if (d.lore) {
            const meta = st.meta();
            if (meta) { meta.world_info = d.lore; st.saveMeta(); }
        }
        if (d.opening && settingsGet().narratorNotes !== false) await st.narrate(d.opening);
        globalThis.toastr?.success?.('New game started. Have fun!', 'UIE');
        sheet.close();
    }
    return sheet;
}
