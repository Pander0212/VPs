// Persona Studio: extends (never replaces) SillyTavern personas. Data is stored per ST persona
// avatar id in extensionSettings.uie.personas, so it follows the persona across chats.
// Tabs: Identity, Expressions, Lineage (family tree), Engine (stat/tracker overrides).

import { S, settingsGet, saveSettings, mutate } from '../state.js';
import { st } from '../st-adapter.js';
import { openSheet, formDialog, confirmDialog, promptDialog } from './sheet.js';
import { esc, icon, opt, compressImage, pickFile, reportError } from './dom.js';
import { str } from '../engine/util.js';
import { DEFAULT_BARS } from '../engine/schema.js';

export const RELATIONS = ['Parent', 'Child', 'Sibling', 'Spouse/Partner', 'Grandparent', 'Grandchild', 'Aunt', 'Uncle', 'Cousin', 'Guardian', 'Step-family', 'Childhood Friend', 'Other'];
const GENERATION = { Grandparent: 0, Parent: 1, Aunt: 1, Uncle: 1, Guardian: 1, 'Step-family': 1, Sibling: 2, 'Spouse/Partner': 2, Cousin: 2, 'Childhood Friend': 2, Other: 2, Child: 3, Grandchild: 4 };
const GEN_LABEL = ['Grandparents', 'Parents & elders', 'Your generation', 'Children', 'Grandchildren'];
const AGE_STAGES = ['Child', 'Teen', 'Young Adult', 'Adult', 'Middle-aged', 'Elder', 'Ageless'];

function personaData(id) {
    const all = settingsGet().personas;
    if (!all[id]) all[id] = { title: '', age: '', ageStage: 'Adult', phone: '', portrait: '', expressions: [], lineage: [], engine: {} };
    return all[id];
}

export function open() {
    const sheet = openSheet({ id: 'persona', title: 'Persona Studio', icon: 'fa-masks-theater', size: 'wide' });
    const { names } = st.personas();
    const ids = Object.keys(names);
    const active = st.activePersonaId();
    const view = { id: active || ids[0] || '__user', tab: 'identity' };

    const render = () => {
        const { names: nm, descriptions } = st.personas();
        const d = personaData(view.id);
        const name = nm[view.id] || st.userName();
        const portrait = d.portrait || st.personaAvatarUrl(view.id);
        const list = ids.length ? ids : ['__user'];
        sheet.body.innerHTML = `
            <div class="uie-org-layout">
                <div class="uie-card" style="margin:0">
                    <h4>Personas</h4>
                    <div style="display:grid;gap:8px">${list.map(id => `<button class="uie-tile ${id === view.id ? 'active' : ''}" data-pid="${esc(id)}"><span class="uie-grow"><b>${esc(nm[id] || st.userName())}</b><br><small class="uie-muted">${esc(settingsGet().personas[id]?.title || '(no title)')}${id === active ? ' · active' : ''}</small></span></button>`).join('')}</div>
                    <p class="uie-muted" style="font-size:.8rem;margin-top:10px">${icon('fa-circle-info')} Create or rename personas in SillyTavern's Persona Management; UIE adds the RPG layer on top.</p>
                </div>
                <div>
                    <div class="uie-persona-top">
                        <div class="uie-portrait">${portrait ? `<img src="${esc(portrait)}" alt="">` : icon('fa-user')}</div>
                        <div class="uie-grow">
                            <h3 style="margin:0 0 4px;font:700 1.3rem var(--uie-font-head)">${esc(name)}</h3>
                            <div class="uie-muted">${esc(d.title || 'No title')}${d.age ? ` · ${esc(d.age)}` : ''}</div>
                            <div class="uie-row uie-wrap" style="margin-top:8px">
                                <button class="uie-btn uie-btn-sm" data-p="pickimg">${icon('fa-image')} Pick local image</button>
                                ${d.portrait ? `<button class="uie-btn uie-btn-sm" data-p="clearimg">Clear</button>` : ''}
                                ${st.sdAvailable() ? `<button class="uie-btn uie-btn-sm" data-p="genimg">${icon('fa-wand-magic-sparkles')} Portrait</button>` : ''}
                            </div>
                        </div>
                    </div>
                    <nav class="uie-tabs" style="position:static">${[['identity', 'Identity'], ['expressions', 'Expressions'], ['lineage', 'Lineage'], ['engine', 'Engine']].map(([k, l]) => `<button class="uie-tab ${view.tab === k ? 'active' : ''}" data-tab="${k}">${l}</button>`).join('')}</nav>
                    <div class="uie-pad">${tab(view.tab, d, name, descriptions?.[view.id]?.description || '')}</div>
                </div>
            </div>`;
    };
    render();

    sheet.body.addEventListener('click', async (e) => {
        try {
            const pid = e.target.closest('[data-pid]');
            if (pid) { view.id = pid.dataset.pid; render(); return; }
            const t = e.target.closest('[data-tab]');
            if (t) { view.tab = t.dataset.tab; render(); return; }
            const rm = e.target.closest('[data-rmkin]');
            if (rm) { personaData(view.id).lineage.splice(Number(rm.dataset.rmkin), 1); saveSettings(); render(); return; }
            const rx = e.target.closest('[data-rmexp]');
            if (rx) { personaData(view.id).expressions.splice(Number(rx.dataset.rmexp), 1); saveSettings(); render(); return; }
            const a = e.target.closest('[data-p]')?.dataset.p;
            if (!a) return;
            const d = personaData(view.id);
            switch (a) {
                case 'pickimg': {
                    const f = await pickFile('image/*');
                    if (!f) return;
                    d.portrait = await compressImage(f, { maxSide: 420, maxBytes: 120 * 1024 });
                    saveSettings(); render();
                    break;
                }
                case 'clearimg': d.portrait = ''; saveSettings(); render(); break;
                case 'genimg': {
                    globalThis.toastr?.info?.('Generating portrait…', 'UIE');
                    const url = await st.generateImage(`portrait of ${st.personas().names[view.id] || st.userName()}, ${d.title}, ${S().player.appearance || ''}`);
                    if (url) { d.portrait = url; saveSettings(); render(); }
                    break;
                }
                case 'saveid': {
                    const f = sheet.body.querySelector('[data-idform]');
                    d.title = str(f.querySelector('[name=title]').value, 80);
                    d.age = str(f.querySelector('[name=age]').value, 20);
                    d.ageStage = f.querySelector('[name=ageStage]').value;
                    d.phone = str(f.querySelector('[name=phone]').value, 30) || d.phone;
                    saveSettings();
                    if (view.id === st.activePersonaId()) mutate(s => { s.player.title = d.title; if (d.age) s.player.age = d.age; s.phone.number = d.phone; });
                    globalThis.toastr?.success?.('Persona saved.', 'UIE');
                    render();
                    break;
                }
                case 'autophone': d.phone = `555-${String(Math.floor(1000 + Math.random() * 9000))}`; saveSettings(); render(); break;
                case 'addexp': {
                    const label = await promptDialog('New expression', { label: 'Name (e.g. happy, angry, flustered)' });
                    if (!label?.trim()) return;
                    const f = await pickFile('image/*');
                    if (!f) return;
                    d.expressions.push({ name: str(label, 30), src: await compressImage(f, { maxSide: 320, maxBytes: 80 * 1024 }) });
                    d.expressions = d.expressions.slice(-12);
                    saveSettings(); render();
                    break;
                }
                case 'addkin': await addLineage(d); render(); break;
                case 'saveengine': {
                    const f = sheet.body.querySelector('[data-engform]');
                    const eng = { bars: {}, currency: Number(f.querySelector('[name=currency]').value) || 0 };
                    for (const k of Object.keys(DEFAULT_BARS)) eng.bars[k] = Math.max(1, Number(f.querySelector(`[name=max_${k}]`).value) || DEFAULT_BARS[k].max);
                    eng.trackersOff = [...f.querySelectorAll('[name^=trk_]')].filter(i => !i.checked).map(i => i.name.slice(4));
                    d.engine = eng;
                    saveSettings();
                    globalThis.toastr?.success?.('Engine overrides saved.', 'UIE');
                    break;
                }
                case 'applyengine': {
                    const eng = d.engine || {};
                    if (!await confirmDialog('Apply to this campaign', 'Set this chat\'s bar maxima and visible trackers from the persona overrides?', { okLabel: 'Apply' })) return;
                    mutate(s => {
                        for (const [k, max] of Object.entries(eng.bars || {})) if (s.player.bars[k]) { s.player.bars[k].max = max; s.player.bars[k].value = Math.min(s.player.bars[k].value, max); }
                        for (const [k, t] of Object.entries(s.trackers)) t.visible = !(eng.trackersOff || []).includes(k);
                        if (eng.currency) s.player.currency = eng.currency;
                        s.player.name = st.personas().names[view.id] || s.player.name;
                        s.player.title = d.title || s.player.title;
                    });
                    break;
                }
            }
        } catch (err) { reportError(err); }
    });
    return sheet;
}

function tab(t, d, name, desc) {
    switch (t) {
        case 'expressions': return `
            <p class="uie-muted">Small expression portraits for your persona (compressed, stored in extension settings).</p>
            <div class="uie-inv-grid" style="padding:0">${(d.expressions || []).map((x, i) => `<div class="uie-icard" style="cursor:default"><div class="uie-icard-art" style="height:110px"><img src="${esc(x.src)}" alt="" style="max-height:104px;border-radius:8px"></div><div class="uie-icard-body uie-row uie-between"><div class="uie-icard-name">${esc(x.name)}</div><button class="uie-icon-btn" style="width:34px;height:34px" data-rmexp="${i}" aria-label="Remove">${icon('fa-xmark')}</button></div></div>`).join('')}</div>
            <button class="uie-btn" data-p="addexp" style="margin-top:12px">${icon('fa-plus')} Add expression</button>`;
        case 'lineage': {
            const gens = [[], [], [], [], []];
            (d.lineage || []).forEach((k, i) => gens[GENERATION[k.rel] ?? 2].push({ ...k, i }));
            return `
            <div class="uie-tree">${gens.map((g, gi) => g.length || gi === 2 ? `<div class="uie-tree-gen"><h5>${GEN_LABEL[gi]}</h5><div class="uie-tree-row">${gi === 2 ? `<span class="uie-kin" style="border-color:var(--accent)">${icon('fa-star')} <b>${esc(name)}</b> <small>(you)</small></span>` : ''}${g.map(k => `<span class="uie-kin">${icon(k.npcId ? 'fa-user-check' : 'fa-user')} <b>${esc(k.name)}</b> <small>${esc(k.rel)}</small><button class="uie-icon-btn" style="width:30px;height:30px;border:0" data-rmkin="${k.i}" aria-label="Remove">${icon('fa-xmark')}</button></span>`).join('')}</div></div>` : '').join('')}</div>
            <button class="uie-btn uie-btn-primary" data-p="addkin" style="margin-top:14px">${icon('fa-people-roof')} Add Lineage Member</button>`;
        }
        case 'engine': {
            const eng = d.engine || {};
            return `<form data-engform>
                <p class="uie-muted">Per-persona stat and tracker overrides. Apply them to the current campaign whenever you play this persona.</p>
                <div class="uie-grid2">${Object.entries(DEFAULT_BARS).map(([k, b]) => `<label class="uie-field"><span>Max ${esc(b.label)}</span><input type="number" min="1" max="9999" name="max_${k}" value="${esc(eng.bars?.[k] ?? S().player.bars[k]?.max ?? b.max)}"></label>`).join('')}
                <label class="uie-field"><span>Starting currency</span><input type="number" min="0" name="currency" value="${esc(eng.currency ?? S().player.currency)}"></label></div>
                <h4>Visible life trackers</h4>
                ${Object.entries(S().trackers).map(([k, t]) => `<label class="uie-switch"><input type="checkbox" name="trk_${esc(k)}" ${(eng.trackersOff || []).includes(k) ? '' : 'checked'}><span></span> ${esc(t.label)}</label>`).join('')}
                <div class="uie-row uie-wrap" style="margin-top:10px"><button class="uie-btn" data-p="saveengine">${icon('fa-floppy-disk')} Save overrides</button><button class="uie-btn uie-btn-primary" data-p="applyengine">${icon('fa-check')} Apply to this campaign</button></div>
            </form>`;
        }
        default: return `<form data-idform>
            <label class="uie-field"><span>Persona name</span><input value="${esc(name)}" disabled><small>Rename it in SillyTavern's Persona Management.</small></label>
            <label class="uie-field"><span>Persona title (optional)</span><input name="title" value="${esc(d.title)}" placeholder="Human Paladin"></label>
            <div class="uie-grid2">
                <label class="uie-field"><span>Age</span><input name="age" value="${esc(d.age)}"></label>
                <label class="uie-field"><span>Age stage</span><select name="ageStage">${AGE_STAGES.map(a => opt(a, a, d.ageStage === a)).join('')}</select></label>
            </div>
            <label class="uie-field"><span>Phone number</span><div class="uie-row"><input name="phone" value="${esc(d.phone)}" placeholder="auto"><button type="button" class="uie-btn uie-btn-sm" data-p="autophone">Auto</button></div></label>
            ${desc ? `<details class="uie-details"><summary>ST persona description</summary><p class="uie-muted" style="white-space:pre-wrap">${esc(desc.slice(0, 1200))}</p></details>` : ''}
            <button class="uie-btn uie-btn-primary" data-p="saveid">${icon('fa-floppy-disk')} Save identity</button>
        </form>`;
    }
}

async function addLineage(d) {
    const s = S();
    const people = [...Object.values(s.npcs).map(n => ({ v: `npc:${n.id}`, l: n.name })), ...st.characters().map(c => ({ v: `char:${c.name}`, l: `${c.name} (card)` }))];
    const v = await formDialog('Add Lineage Member', `
        <p class="uie-muted">Choose an existing character or enter a new name, then define who that person is to the active persona.</p>
        <label class="uie-field"><span>Existing character</span><select name="existing">${opt('', 'Type or pick a family member', true)}${people.map(p => opt(p.v, p.l)).join('')}</select></label>
        <label class="uie-field"><span>Or new member name</span><input name="name" placeholder="Name"></label>
        <label class="uie-field"><span>Relationship to persona</span><select name="rel">${RELATIONS.map(r => opt(r, r, r === 'Parent')).join('')}</select></label>`, { okLabel: 'Add Member' });
    if (!v) return;
    let name = str(v.name, 60), npcId = '';
    if (v.existing?.startsWith('npc:')) { npcId = v.existing.slice(4); name = s.npcs[npcId]?.name || name; }
    if (v.existing?.startsWith('char:')) name = v.existing.slice(5);
    if (!name) { globalThis.toastr?.warning?.('Pick someone or type a name.', 'UIE'); return; }
    d.lineage = [...(d.lineage || []), { name, npcId, rel: RELATIONS.includes(v.rel) ? v.rel : 'Other' }];
    saveSettings();
}
