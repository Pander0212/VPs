// NPC Management (parchment): card list, edit form, lock/unlock, import from ST character
// cards, AI generation, duplicate merge ("Tobias" + "Tobias Moreno").

import { S, bus, mutate } from '../state.js';
import { st } from '../st-adapter.js';
import { openSheet, confirmDialog, choiceDialog, promptDialog } from './sheet.js';
import { esc, icon, opt, reportError, formData } from './dom.js';
import { findByName, nameScore, mergeNames, normalizeName } from '../engine/dedupe.js';
import { parseScheduleText, scheduleToText, npcWhereabouts } from '../engine/schedules.js';
import { toParts } from '../engine/time.js';
import { uid, str, text } from '../engine/util.js';
import { relationshipLabel } from '../engine/rules.js';
import { genJson, render as renderPrompt } from '../ai/gen.js';
import { compileContext } from '../ai/context.js';

export function initials(name) {
    return String(name || '?').split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
}
export function avatarColor(name) {
    let h = 0;
    for (const c of String(name)) h = (h * 31 + c.charCodeAt(0)) % 360;
    return `hsl(${h} 45% 38%)`;
}
export function npcAvatar(npc, cls = 'uie-avatar-lg') {
    const char = npc.card ? st.characters().find(c => c.name === npc.card) : null;
    const url = npc.img || (char ? st.avatarUrl(char) : '');
    return url ? `<img class="${cls}" src="${esc(url)}" alt="" loading="lazy">` : `<span class="${cls}" style="--av:${avatarColor(npc.name)}">${esc(initials(npc.name))}</span>`;
}

export function open(params = {}) {
    const sheet = openSheet({
        id: 'npcs', title: 'Game NPCs', icon: 'fa-users', theme: 'parchment',
        actions: `<button class="uie-btn uie-btn-sm" data-n="add">${icon('fa-user-plus')} <span class="uie-hide-xs">Add New NPC</span></button>`,
    });
    const view = { q: '' };
    const render = () => {
        const s = S();
        const p = toParts(s.clock.t, s.calendar.epoch);
        const q = normalizeName(view.q);
        const list = Object.values(s.npcs).filter(n => !q || normalizeName(`${n.name} ${(n.aliases || []).join(' ')} ${n.role} ${n.title}`).includes(q)).sort((a, b) => a.name.localeCompare(b.name));
        sheet.body.innerHTML = `
            <div class="uie-toolbar">
                <input type="search" class="uie-search" data-nq placeholder="Search NPCs…" value="${esc(view.q)}" aria-label="Search NPCs">
                <button class="uie-btn uie-btn-sm" data-n="import">${icon('fa-id-card')} From card</button>
                <button class="uie-btn uie-btn-sm" data-n="gen">${icon('fa-wand-magic-sparkles')} AI Gen</button>
                <button class="uie-btn uie-btn-sm" data-n="dupes">${icon('fa-object-group')} Merge dupes</button>
            </div>
            ${list.length ? `<div class="uie-list uie-list-2">${list.map(n => {
                const w = npcWhereabouts(n, p);
                return `<div class="uie-npc-card">
                    <div class="uie-npc-top">${npcAvatar(n)}<div class="uie-grow"><h4>${esc(n.name)}</h4><div class="uie-sub">${esc(n.title || n.role || 'NPC')}</div></div></div>
                    <div class="uie-sub">${icon('fa-location-dot')} ${esc(w.loc || 'Unknown location')}${w.activity ? ` · ${esc(w.activity)}` : ''}</div>
                    ${n.rel ? `<div class="uie-sub">${icon('fa-heart')} ${esc(relationshipLabel(n.rel))}</div>` : ''}
                    <span class="uie-lock ${n.locked ? 'on' : ''}">${icon(n.locked ? 'fa-lock' : 'fa-lock-open')} ${n.locked ? 'Locked' : 'Unlocked'}</span>
                    <div class="uie-item-actions">
                        <button class="uie-btn uie-btn-sm" data-edit="${esc(n.id)}">${icon('fa-pen')} Edit</button>
                        <button class="uie-btn uie-btn-sm" data-lock="${esc(n.id)}">${icon(n.locked ? 'fa-lock-open' : 'fa-lock')} ${n.locked ? 'Unlock' : 'Lock'}</button>
                    </div>
                </div>`;
            }).join('')}</div>` : `<div class="uie-empty">${icon('fa-user-group')}No NPCs yet.<br><small>People the story introduces are added automatically. A locked NPC is never changed by the AI.</small></div>`}`;
    };
    render();
    sheet.onCleanup(bus.on(() => { if (!document.activeElement?.matches?.('[data-nq]')) render(); }));
    sheet.el.addEventListener('click', async (e) => {
        try {
            const ed = e.target.closest('[data-edit]');
            if (ed) { editNpc(ed.dataset.edit); return; }
            const lk = e.target.closest('[data-lock]');
            if (lk) { mutate(s => { const n = s.npcs[lk.dataset.lock]; n.locked = !n.locked; }); return; }
            const a = e.target.closest('[data-n]')?.dataset.n;
            if (a === 'add') editNpc(null);
            if (a === 'import') await importFromCard();
            if (a === 'gen') await aiGenerate();
            if (a === 'dupes') await mergeDupes();
        } catch (err) { reportError(err); }
    });
    let t;
    sheet.body.addEventListener('input', (e) => {
        if (!e.target.matches('[data-nq]')) return;
        clearTimeout(t);
        t = setTimeout(() => { view.q = e.target.value; render(); const i = sheet.body.querySelector('[data-nq]'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }, 200);
    });
    if (params.add) setTimeout(() => editNpc(null), 50);
    if (params.edit) setTimeout(() => editNpc(params.edit), 50);
    return sheet;
}

function locationOptions(sel) {
    const nodes = Object.values(S().map.nodes).filter(n => n.explored !== false).sort((a, b) => a.name.localeCompare(b.name));
    const has = nodes.some(n => n.name === sel);
    return `${opt('', '— none —', !sel)}${!has && sel ? opt(sel, sel, true) : ''}${nodes.map(n => opt(n.name, n.name, n.name === sel)).join('')}`;
}

export function editNpc(id, preset = null) {
    const s0 = S();
    const npc = id ? s0.npcs[id] : null;
    const n = npc || { name: '', role: 'NPC', title: '', age: '', location: '', appearance: '', personality: '', orgs: [], rumors: '', secrets: '', schedule: [], notes: '', ...(preset || {}) };
    const sheet = openSheet({ id: `npc-edit-${id || 'new'}`, title: npc ? `Edit: ${npc.name}` : 'NPC Management', icon: 'fa-user-pen', theme: 'parchment' });
    const orgNames = Object.values(s0.orgs).map(o => o.name);
    sheet.body.innerHTML = `
        <form class="uie-form-grid" novalidate>
            <label class="uie-field"><span>Name</span><input name="name" value="${esc(n.name)}" maxlength="60" required></label>
            <label class="uie-field"><span>Role</span><input name="role" value="${esc(n.role)}" maxlength="120"></label>
            <label class="uie-field"><span>Title</span><input name="title" value="${esc(n.title)}" placeholder="Store owner, barrier guardian, rumor broker" maxlength="120"></label>
            <label class="uie-field"><span>Age</span><input name="age" value="${esc(n.age)}" maxlength="30"></label>
            <label class="uie-field uie-span2"><span>Map location</span><div class="uie-row"><select name="location" class="uie-grow">${locationOptions(n.location)}</select><button type="button" class="uie-btn uie-btn-sm" data-f="addloc">${icon('fa-plus')} Add</button></div></label>
            <label class="uie-field"><span>Appearance</span><textarea name="appearance" rows="3">${esc(n.appearance)}</textarea></label>
            <label class="uie-field"><span>Personality</span><textarea name="personality" rows="3">${esc(n.personality)}</textarea></label>
            <label class="uie-field"><span>Organization affiliations</span><input name="orgs" value="${esc((n.orgs || []).join(', '))}" list="uie-org-names" placeholder="Comma separated"><datalist id="uie-org-names">${orgNames.map(o => `<option value="${esc(o)}">`).join('')}</datalist></label>
            <label class="uie-field"><span>Rumors</span><textarea name="rumors" rows="2">${esc(n.rumors)}</textarea></label>
            <label class="uie-field"><span>Secrets</span><textarea name="secrets" rows="2">${esc(n.secrets)}</textarea></label>
            <label class="uie-field"><span>Schedule</span><textarea name="schedule" rows="3" placeholder="08:00-17:00 Bakery: baking bread&#10;22:00-06:00 Home: sleeping&#10;18:00-22:00 [5,6] Tavern: drinking">${esc(scheduleToText(n.schedule))}</textarea><small>One block per line: HH:MM-HH:MM [days 0-6] Place: activity</small></label>
            <label class="uie-field uie-span2"><span>Notes</span><textarea name="notes" rows="3">${esc(n.notes)}</textarea></label>
            <label class="uie-switch uie-span2"><input type="checkbox" name="locked" ${n.locked ? 'checked' : ''}><span></span> Locked (AI never changes this NPC)</label>
            <label class="uie-switch uie-span2"><input type="checkbox" name="present" ${n.present ? 'checked' : ''}><span></span> Present in the current scene</label>
        </form>
        <div class="uie-sticky-foot">
            ${npc ? `<button class="uie-btn uie-btn-danger" data-f="del">${icon('fa-trash')}</button>` : ''}
            ${npc && st.sdAvailable() ? `<button class="uie-btn" data-f="portrait">${icon('fa-image')} Portrait</button>` : ''}
            <button class="uie-btn" data-f="cancel">Cancel</button>
            <button class="uie-btn uie-btn-primary" data-f="save">${icon('fa-floppy-disk')} Save</button>
        </div>`;
    const form = sheet.body.querySelector('form');
    sheet.body.addEventListener('click', async (e) => {
        const a = e.target.closest('[data-f]')?.dataset.f;
        if (!a) return;
        try {
            if (a === 'cancel') sheet.close();
            if (a === 'addloc') {
                const name = await promptDialog('New location', { label: 'Place name' });
                if (!name?.trim()) return;
                mutate(s => {
                    if (Object.values(s.map.nodes).some(x => x.name.toLowerCase() === name.trim().toLowerCase())) return;
                    const here = s.map.nodes[s.map.location];
                    const nid = uid('loc');
                    s.map.nodes[nid] = { id: nid, name: str(name, 60), tier: here?.tier || 'local', parent: here?.parent ?? null, x: 20 + Math.random() * 60, y: 20 + Math.random() * 60, pin: 'place', kind: '', desc: '', explored: true, links: [] };
                });
                form.querySelector('[name=location]').innerHTML = locationOptions(name.trim());
            }
            if (a === 'del') {
                if (!await confirmDialog('Delete NPC', `Delete ${npc.name}? Their relationship and phone history go too.`, { okLabel: 'Delete', danger: true })) return;
                mutate(s => { delete s.npcs[id]; delete s.party.members[id]; delete s.phone.threads[id]; });
                sheet.close();
            }
            if (a === 'portrait') {
                globalThis.toastr?.info?.('Generating portrait…', 'UIE');
                const url = await st.generateImage(`portrait of ${npc.name}, ${npc.appearance || npc.role}, upper body`);
                if (url) mutate(s => { s.npcs[id].img = url; });
            }
            if (a === 'save') {
                const v = formData(form);
                const name = str(v.name, 60);
                if (!name) { form.querySelector('[name=name]').focus(); globalThis.toastr?.warning?.('Name is required.', 'UIE'); return; }
                const dup = !id && findByName(Object.values(S().npcs), name, 0.9);
                if (dup && !await confirmDialog('Possible duplicate', `${dup.name} already exists. Create a separate NPC anyway?`, { okLabel: 'Create anyway' })) return;
                mutate(s => {
                    const nid = id || uid('npc');
                    const base = s.npcs[nid] || { id: nid, aliases: [], rel: { affection: 30, trust: 30, standing: 50, memories: [] }, met: s.clock.t, card: '' };
                    const loc = Object.values(s.map.nodes).find(x => x.name === v.location);
                    s.npcs[nid] = {
                        ...base, ...(preset || {}), id: nid, name, role: str(v.role, 120), title: str(v.title, 120), age: str(v.age, 30),
                        location: v.location, locationId: loc?.id, appearance: text(v.appearance, 1200), personality: text(v.personality, 1200),
                        orgs: String(v.orgs || '').split(',').map(x => x.trim()).filter(Boolean), rumors: text(v.rumors, 800), secrets: text(v.secrets, 800),
                        schedule: parseScheduleText(v.schedule), notes: text(v.notes, 2000), locked: !!v.locked, present: !!v.present,
                    };
                    if (!base.card) {
                        const card = st.characters().find(c => nameScore(c.name, name) >= 0.9);
                        if (card) s.npcs[nid].card = card.name;
                    }
                });
                sheet.close();
            }
        } catch (err) { reportError(err); }
    });
    return sheet;
}

async function importFromCard() {
    const chars = st.characters();
    if (!chars.length) { globalThis.toastr?.info?.('No character cards found.', 'UIE'); return; }
    const pick = await choiceDialog('Import from character card', chars.slice(0, 80).map((c, i) => ({ label: c.name, value: i, icon: 'fa-id-card' })));
    if (pick === null || pick === undefined) return;
    const c = chars[pick];
    const ex = findByName(Object.values(S().npcs), c.name, 0.9);
    const desc = String(c.data?.description || c.description || '');
    const pers = String(c.data?.personality || c.personality || '');
    const extra = c.data?.extensions?.uie || {};
    if (ex) {
        mutate(s => { const n = s.npcs[ex.id]; n.card = c.name; if (!n.appearance) n.appearance = desc.slice(0, 600); if (!n.personality) n.personality = pers.slice(0, 600); });
        globalThis.toastr?.success?.(`Linked ${esc(ex.name)} to the card ${esc(c.name)}.`, 'UIE');
        return;
    }
    mutate(s => {
        const id = uid('npc');
        s.npcs[id] = {
            id, name: c.name, aliases: [], role: 'Character', title: '', age: '', location: '', appearance: desc.slice(0, 600), personality: pers.slice(0, 600),
            orgs: Array.isArray(extra.orgs) ? extra.orgs : [], rumors: '', secrets: '', schedule: [], notes: '', locked: false, card: c.name,
            rel: { affection: 30, trust: 30, standing: 50, memories: [] }, met: s.clock.t,
        };
    });
    globalThis.toastr?.success?.(`Imported ${esc(c.name)}.`, 'UIE');
}

async function aiGenerate() {
    const req = await promptDialog('Generate NPC', { label: 'What kind of person?', placeholder: 'a grumpy ferryman who knows every rumor', multiline: true });
    if (req === null) return;
    globalThis.toastr?.info?.('Generating NPC…', 'UIE');
    const { value } = await genJson(renderPrompt('npcGen', { request: req, state: compileContext(S(), { budget: 300 }) }), { label: 'NPC generator' });
    if (!value?.name) throw new Error('The model did not return an NPC.');
    editNpc(null, {
        name: str(value.name, 60), role: str(value.role, 120), title: str(value.title, 120), age: str(value.age, 30),
        appearance: text(value.appearance, 1200), personality: text(value.personality, 1200), rumors: text(value.rumors, 800),
        secrets: text(value.secrets, 800), schedule: parseScheduleText(value.schedule), notes: text(value.notes, 2000),
    });
}

/** Merge NPC records that obviously refer to the same person. */
export async function mergeDupes() {
    const list = Object.values(S().npcs);
    const pairs = [];
    for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
            if (nameScore(list[i].name, list[j].name) >= 0.9) pairs.push([list[i], list[j]]);
        }
    }
    if (!pairs.length) { globalThis.toastr?.info?.('No duplicates found.', 'UIE'); return; }
    if (!await confirmDialog('Merge duplicates', `Merge ${pairs.map(([a, b]) => `${a.name} + ${b.name}`).join(', ')}?`, { okLabel: 'Merge' })) return;
    mutate(s => {
        for (const [a, b] of pairs) {
            const A = s.npcs[a.id], B = s.npcs[b.id];
            if (!A || !B) continue;
            const keep = A.name.split(' ').length >= B.name.split(' ').length ? A : B;
            const drop = keep === A ? B : A;
            keep.name = mergeNames(keep.name, drop.name);
            keep.aliases = [...new Set([...(keep.aliases || []), ...(drop.aliases || []), drop.name].filter(x => x !== keep.name))];
            for (const k of ['role', 'title', 'age', 'location', 'appearance', 'personality', 'rumors', 'secrets', 'notes', 'card', 'img']) if (!keep[k] && drop[k]) keep[k] = drop[k];
            if (!keep.schedule?.length && drop.schedule?.length) keep.schedule = drop.schedule;
            keep.orgs = [...new Set([...(keep.orgs || []), ...(drop.orgs || [])])];
            if (keep.rel && drop.rel) keep.rel.memories = [...(keep.rel.memories || []), ...(drop.rel.memories || [])].slice(-30);
            if (s.phone.threads[drop.id]) s.phone.threads[keep.id] = [...(s.phone.threads[keep.id] || []), ...s.phone.threads[drop.id]];
            if (s.party.members[drop.id] && !s.party.members[keep.id]) s.party.members[keep.id] = s.party.members[drop.id];
            delete s.phone.threads[drop.id];
            delete s.party.members[drop.id];
            delete s.npcs[drop.id];
        }
    });
    globalThis.toastr?.success?.(`Merged ${pairs.length} duplicate${pairs.length > 1 ? 's' : ''}.`, 'UIE');
}
