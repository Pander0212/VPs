// Organizations: atlas list, summary cards, dossier with Info / Members / Influence / Rules / Run-ins.
// Standing labels come from engine/rules.js (<15 Enemy, <35 Hostile, <65 Neutral, >=65 Friendly).

import { S, bus, mutate } from '../state.js';
import { openSheet, confirmDialog, choiceDialog, promptDialog } from './sheet.js';
import { esc, icon, opt, reportError } from './dom.js';
import { standingLabel, standingTone } from '../engine/rules.js';
import { newOrg } from '../engine/ops.js';
import { uid, str, text, clamp } from '../engine/util.js';
import { toParts, formatDate } from '../engine/time.js';
import { genJson, render as renderPrompt } from '../ai/gen.js';
import { compileContext } from '../ai/context.js';

const TONE_COLOR = { good: '#7edba5', neutral: '#d6b468', bad: '#ff8a70' };

export function open(params = {}) {
    const sheet = openSheet({ id: 'orgs', title: 'Organizations', icon: 'fa-sitemap', size: 'wide' });
    const view = { sel: params.sel || null, tab: 'info' };

    const render = () => {
        const s = S();
        const orgs = Object.values(s.orgs).sort((a, b) => a.name.localeCompare(b.name));
        const mapped = orgs.filter(o => (o.influence || []).length || o.mainLocation).length;
        const friendly = orgs.filter(o => o.standing >= 65).length;
        const hostile = orgs.filter(o => o.standing < 35).length;
        const atlas = `
            <div class="uie-card" style="margin:0">
                <div class="uie-row uie-between"><h4 style="margin:0">Organization Atlas</h4><div class="uie-row"><button class="uie-btn uie-btn-sm" data-o="gen">${icon('fa-wand-magic-sparkles')}</button><button class="uie-btn uie-btn-sm" data-o="new">${icon('fa-plus')} New</button></div></div>
                <p class="uie-muted" style="font-size:.82rem">Universal groups, crews, orders, companies, councils, cults, teams, families, governments, and strange alliances.</p>
                <div style="display:grid;gap:10px">${orgs.length ? orgs.map(o => {
                    const tone = standingTone(o.standing);
                    return `<button class="uie-org-card" data-sel="${esc(o.id)}" style="${view.sel === o.id ? 'border-color:var(--accent)' : ''}">
                        <div class="uie-row"><span class="uie-org-sigil">${icon('fa-sitemap')}</span><div class="uie-grow"><h4>${esc(o.name)}</h4>
                        <div class="uie-row uie-wrap"><span class="uie-tag">${esc(o.mainLocation || 'Unmapped')}</span><span class="uie-tag ${tone}">${esc(standingLabel(o.standing))} ${esc(o.standing)}</span><span class="uie-tag">${esc(o.scale)}</span></div></div></div>
                        <div class="uie-muted" style="font-size:.8rem;margin-top:6px">Leader: ${esc(leaderName(s, o))} · Members: ${Object.keys(o.members || {}).length}</div>
                        <div class="uie-standing"><i style="width:${clamp(o.standing, 0, 100)}%;--c:${TONE_COLOR[tone]}"></i></div>
                    </button>`;
                }).join('') : `<div class="uie-empty">${icon('fa-sitemap')}No organizations known yet.</div>`}</div>
            </div>`;
        const stats = `<div class="uie-stats"><div class="uie-stat"><small>Organizations</small><b>${orgs.length}</b></div><div class="uie-stat"><small>Mapped reach</small><b>${mapped}</b></div><div class="uie-stat"><small>Friendly</small><b>${friendly}</b></div><div class="uie-stat"><small>Hostile</small><b>${hostile}</b></div></div>`;
        const org = s.orgs[view.sel];
        const right = org ? dossier(s, org, view.tab) : `<div class="uie-card"><h3 style="font:700 1.4rem var(--uie-font-head);margin:4px 0 8px">Tap an organization to open its dossier.</h3><p class="uie-muted">The dossier holds leadership, mapped influence, members, rules, your run-ins, and major events. Influence locations are linked to map places.</p></div>${stats}`;
        sheet.body.innerHTML = `<div class="uie-org-layout"><div>${atlas}</div><div class="uie-dossier-wrap">${org ? `${right}` : right}</div></div>`;
        if (org && matchMedia('(max-width: 899px)').matches && view.scrollToDossier) {
            view.scrollToDossier = false;
            sheet.body.querySelector('.uie-dossier-wrap')?.scrollIntoView({ block: 'start' });
        }
    };

    render();
    sheet.onCleanup(bus.on(() => { if (!sheet.body.contains(document.activeElement) || !document.activeElement.matches('input,textarea,select')) render(); }));

    sheet.body.addEventListener('click', async (e) => {
        try {
            const sel = e.target.closest('[data-sel]');
            if (sel) { view.sel = sel.dataset.sel; view.tab = 'info'; view.scrollToDossier = true; render(); return; }
            const tab = e.target.closest('[data-dtab]');
            if (tab) { saveForm(); view.tab = tab.dataset.dtab; render(); return; }
            const a = e.target.closest('[data-o]')?.dataset.o;
            if (!a) return;
            const s = S();
            const org = s.orgs[view.sel];
            switch (a) {
                case 'new': {
                    const name = await promptDialog('New organization', { label: 'Name', value: 'New Organization' });
                    if (!name?.trim()) return;
                    const id = uid('org');
                    const here = s.map.nodes[s.map.location];
                    mutate(st => { st.orgs[id] = newOrg(id, str(name, 60), { mainLocation: here?.name || '' }); });
                    view.sel = id; view.tab = 'info'; render();
                    break;
                }
                case 'gen': {
                    const req = await promptDialog('Generate organization', { label: 'What kind of group?', placeholder: 'a smuggling ring run out of the docks', multiline: true });
                    if (req === null) return;
                    globalThis.toastr?.info?.('Generating…', 'UIE');
                    const { value } = await genJson(renderPrompt('orgGen', { request: req, state: compileContext(s, { budget: 300 }) }), { label: 'Org generator' });
                    if (!value?.name) throw new Error('No organization returned.');
                    const id = uid('org');
                    mutate(st => {
                        st.orgs[id] = { ...newOrg(id, str(value.name, 60), { type: str(value.type, 40), purpose: text(value.purpose, 600) }), leaderTitle: str(value.leaderTitle, 60), rules: text(value.rules, 1200), scale: ['local', 'regional', 'world'].includes(value.scale) ? value.scale : 'local', mainLocation: st.map.nodes[st.map.location]?.name || '' };
                    });
                    view.sel = id; render();
                    break;
                }
                case 'save': saveForm(true); break;
                case 'close': view.sel = null; render(); break;
                case 'del':
                    if (!org || !await confirmDialog('Delete organization', `Delete ${org.name}?`, { okLabel: 'Delete', danger: true })) return;
                    mutate(st => { delete st.orgs[org.id]; });
                    view.sel = null; render();
                    break;
                case 'addmember': {
                    const npcs = Object.values(s.npcs).filter(n => !org.members?.[n.id]);
                    if (!npcs.length) { globalThis.toastr?.info?.('No NPCs available — add NPCs first.', 'UIE'); return; }
                    const nid = await choiceDialog('Add member', npcs.slice(0, 60).map(n => ({ label: n.name, value: n.id, icon: 'fa-user' })));
                    if (!nid) return;
                    const rank = await promptDialog('Rank', { label: 'Rank / role in the organization', value: 'Member' });
                    mutate(st => { st.orgs[org.id].members = { ...(st.orgs[org.id].members || {}), [nid]: { rank: str(rank || 'Member', 60) } }; const n = st.npcs[nid]; if (n && !(n.orgs || []).includes(org.name)) n.orgs = [...(n.orgs || []), org.name]; });
                    break;
                }
                case 'addinfl': {
                    const nodes = Object.values(s.map.nodes).filter(n => n.explored !== false && !(org.influence || []).includes(n.id));
                    const nid = await choiceDialog('Add influence location', nodes.slice(0, 80).map(n => ({ label: n.name, value: n.id, icon: 'fa-location-dot', hint: n.tier })));
                    if (!nid) return;
                    mutate(st => { st.orgs[org.id].influence = [...(st.orgs[org.id].influence || []), nid]; });
                    break;
                }
                case 'addrunin': {
                    const t = await promptDialog('Log a run-in', { label: 'What happened?', multiline: true });
                    if (!t?.trim()) return;
                    mutate(st => { st.orgs[org.id].runins = [...(st.orgs[org.id].runins || []), { t: st.clock.t, text: str(t, 300) }]; });
                    break;
                }
            }
        } catch (err) { reportError(err); }
    });
    sheet.body.addEventListener('click', (e) => {
        const rm = e.target.closest('[data-rm-member]');
        if (rm) mutate(st => { delete st.orgs[view.sel].members[rm.dataset.rmMember]; });
        const rmi = e.target.closest('[data-rm-infl]');
        if (rmi) mutate(st => { st.orgs[view.sel].influence = (st.orgs[view.sel].influence || []).filter(x => x !== rmi.dataset.rmInfl); });
        const rmr = e.target.closest('[data-rm-runin]');
        if (rmr) mutate(st => { st.orgs[view.sel].runins.splice(Number(rmr.dataset.rmRunin), 1); });
    });

    function saveForm(toast = false) {
        const f = sheet.body.querySelector('[data-orgform]');
        const org = S().orgs[view.sel];
        if (!f || !org) return;
        const g = (n) => f.querySelector(`[name=${n}]`)?.value;
        mutate(st => {
            const o = st.orgs[org.id];
            const set = (k, v) => { if (v !== undefined) o[k] = v; };
            set('name', g('name') !== undefined ? str(g('name'), 60) || o.name : undefined);
            set('type', g('type') !== undefined ? str(g('type'), 40) : undefined);
            set('standing', g('standing') !== undefined ? clamp(Number(g('standing')), 0, 100) : undefined);
            set('scale', g('scale'));
            set('mainLocation', g('mainLocation') !== undefined ? str(g('mainLocation'), 80) : undefined);
            set('locationKind', g('locationKind') !== undefined ? str(g('locationKind'), 40) : undefined);
            set('leaderTitle', g('leaderTitle') !== undefined ? str(g('leaderTitle'), 60) : undefined);
            set('leaderId', g('leaderId'));
            set('subLeaders', g('subLeaders') !== undefined ? str(g('subLeaders'), 200) : undefined);
            set('purpose', g('purpose') !== undefined ? text(g('purpose'), 1200) : undefined);
            set('rules', g('rules') !== undefined ? text(g('rules'), 2000) : undefined);
        });
        if (toast) globalThis.toastr?.success?.('Saved.', 'UIE');
    }
    return sheet;
}

function leaderName(s, o) {
    if (!o.leaderId || o.leaderId === 'hidden') return 'Unknown/Hidden';
    return s.npcs[o.leaderId]?.name || 'Unknown/Hidden';
}

function dossier(s, o, tab) {
    const tone = standingTone(o.standing);
    const head = `
        <div class="uie-card">
            <div class="uie-row uie-between"><div><h4 style="margin:0">Organization Dossier</h4><div class="uie-muted" style="font-size:.8rem">Change standing, influence, members, rules, and map-backed locations.</div></div><button class="uie-icon-btn" data-o="close" aria-label="Close dossier">${icon('fa-xmark')}</button></div>
            <div class="uie-kv" style="margin-top:10px">
                <div><small>Name</small><b>${esc(o.name)}</b></div>
                <div><small>Location</small><b>${esc(o.mainLocation || 'Unmapped')}</b></div>
                <div><small>Standing</small><b style="color:${TONE_COLOR[tone]}">${esc(standingLabel(o.standing))} (${esc(o.standing)}/100)</b></div>
                <div><small>Leader title</small><b>${esc(o.leaderTitle || 'Unset')}</b></div>
                <div><small>Leader</small><b>${esc(leaderName(s, o))}</b></div>
                <div><small>Sub leaders</small><b>${esc(o.subLeaders || 'None recorded')}</b></div>
            </div>
            <div class="uie-dossier">
                <nav class="uie-dossier-nav">${[['info', 'Info', 'fa-id-badge'], ['members', 'Members', 'fa-users'], ['influence', 'Influence', 'fa-map-location'], ['rules', 'Rules', 'fa-scale-balanced'], ['runins', 'Run-ins', 'fa-code-branch']].map(([id, l, ic]) => `<button class="uie-tab ${tab === id ? 'active' : ''}" data-dtab="${id}">${icon(ic)} ${l}</button>`).join('')}</nav>
                <div data-orgform>${dossierTab(s, o, tab)}</div>
            </div>
        </div>`;
    return head;
}

function dossierTab(s, o, tab) {
    const npcOpts = Object.values(s.npcs).map(n => opt(n.id, n.name, o.leaderId === n.id)).join('');
    const foot = `<div class="uie-row" style="justify-content:flex-end;margin-top:10px"><button class="uie-btn uie-btn-danger" data-o="del">${icon('fa-trash')} Delete</button><button class="uie-btn uie-btn-primary" data-o="save">${icon('fa-floppy-disk')} Save</button></div>`;
    switch (tab) {
        case 'members': {
            const mem = Object.entries(o.members || {});
            return `${mem.length ? mem.map(([id, m]) => `<div class="uie-item" style="margin-top:8px"><div class="uie-grow"><h4>${esc(s.npcs[id]?.name || 'Unknown')}</h4><p>${esc(m.rank || 'Member')}</p></div><button class="uie-icon-btn" data-rm-member="${esc(id)}" aria-label="Remove">${icon('fa-user-minus')}</button></div>`).join('') : '<p class="uie-muted">No known members.</p>'}
                <button class="uie-btn" data-o="addmember" style="margin-top:8px">${icon('fa-user-plus')} Add member</button>`;
        }
        case 'influence': {
            const infl = (o.influence || []).map(id => s.map.nodes[id]).filter(Boolean);
            return `${infl.length ? infl.map(n => `<div class="uie-item" style="margin-top:8px">${icon('fa-location-dot')}<div class="uie-grow"><h4>${esc(n.name)}</h4><p>${esc(n.tier)}${n.kind ? ` · ${esc(n.kind)}` : ''}</p></div><button class="uie-icon-btn" data-rm-infl="${esc(n.id)}" aria-label="Remove">${icon('fa-xmark')}</button></div>`).join('') : '<p class="uie-muted">No mapped influence.</p>'}
                <button class="uie-btn" data-o="addinfl" style="margin-top:8px">${icon('fa-map-pin')} Add influence location</button>
                <label class="uie-field" style="margin-top:12px"><span>Influence scale</span><select name="scale">${['local', 'regional', 'world'].map(x => opt(x, x, o.scale === x)).join('')}</select></label>${foot}`;
        }
        case 'rules': return `<label class="uie-field"><span>Rules, customs, codes</span><textarea name="rules" rows="8">${esc(o.rules || '')}</textarea></label>${foot}`;
        case 'runins': return `${(o.runins || []).length ? [...o.runins].map((r, i) => ({ r, i })).reverse().map(({ r, i }) => `<div class="uie-item" style="margin-top:8px"><div class="uie-grow"><p style="color:var(--ink)">${esc(r.text)}</p><p>${esc(formatDate(toParts(r.t, s.calendar.epoch), 'long', s.calendar.monthNames))}</p></div><button class="uie-icon-btn" data-rm-runin="${i}" aria-label="Remove">${icon('fa-xmark')}</button></div>`).join('') : '<p class="uie-muted">No run-ins yet.</p>'}
            <button class="uie-btn" data-o="addrunin" style="margin-top:8px">${icon('fa-plus')} Log run-in</button>`;
        default: return `
            <div class="uie-grid2">
                <label class="uie-field"><span>Name</span><input name="name" value="${esc(o.name)}"></label>
                <label class="uie-field"><span>Type</span><input name="type" value="${esc(o.type)}"></label>
                <label class="uie-field"><span>User standing / 100</span><input name="standing" type="number" min="0" max="100" value="${esc(o.standing)}"></label>
                <label class="uie-field"><span>Influence scale</span><select name="scale">${['local', 'regional', 'world'].map(x => opt(x, x, o.scale === x)).join('')}</select></label>
                <label class="uie-field"><span>Main location</span><input name="mainLocation" value="${esc(o.mainLocation)}" list="uie-places"><datalist id="uie-places">${Object.values(s.map.nodes).map(n => `<option value="${esc(n.name)}">`).join('')}</datalist></label>
                <label class="uie-field"><span>Location kind</span><input name="locationKind" value="${esc(o.locationKind)}"></label>
                <label class="uie-field"><span>Leader title</span><input name="leaderTitle" value="${esc(o.leaderTitle)}" placeholder="Guildmaster, director, class president"></label>
                <label class="uie-field"><span>Leader identity</span><select name="leaderId">${opt('hidden', 'Unknown/Hidden (system)', !o.leaderId || o.leaderId === 'hidden')}${npcOpts}</select></label>
            </div>
            <label class="uie-field"><span>Sub leaders</span><input name="subLeaders" value="${esc(o.subLeaders)}" placeholder="Comma separated"></label>
            <label class="uie-field"><span>Purpose / agenda / presence</span><textarea name="purpose" rows="4">${esc(o.purpose)}</textarea></label>${foot}`;
    }
}
