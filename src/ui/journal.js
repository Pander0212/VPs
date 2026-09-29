// Journal: quests with objectives and status (active / done / failed).

import { S, bus, mutate, userOps } from '../state.js';
import { openSheet, formDialog, confirmDialog, promptDialog } from './sheet.js';
import { esc, icon, opt, reportError } from './dom.js';
import { toParts, formatDate } from '../engine/time.js';
import { uid, str, text } from '../engine/util.js';

const STATUS = { active: ['Active', 'fa-scroll', 'neutral'], done: ['Completed', 'fa-circle-check', 'good'], failed: ['Failed', 'fa-circle-xmark', 'bad'] };

export function open() {
    const sheet = openSheet({ id: 'journal', title: 'Journal', icon: 'fa-book-open', actions: `<button class="uie-icon-btn" data-j="add" aria-label="New quest">${icon('fa-plus')}</button>` });
    const view = { filter: 'active', open: null };
    const render = () => {
        const s = S();
        const quests = Object.values(s.quests).filter(q => view.filter === 'all' || q.status === view.filter).sort((a, b) => (b.created || 0) - (a.created || 0));
        const counts = { active: 0, done: 0, failed: 0 };
        Object.values(s.quests).forEach(q => { counts[q.status] = (counts[q.status] || 0) + 1; });
        sheet.body.innerHTML = `
            <nav class="uie-tabs">${['active', 'done', 'failed', 'all'].map(f => `<button class="uie-tab ${view.filter === f ? 'active' : ''}" data-f="${f}">${f === 'all' ? 'All' : STATUS[f][0]} ${f === 'all' ? '' : `(${counts[f] || 0})`}</button>`).join('')}</nav>
            <div class="uie-list">${quests.length ? quests.map(q => {
                const objs = Object.entries(q.objectives || {});
                const done = objs.filter(([, o]) => o.done).length;
                const [label, ic, tone] = STATUS[q.status] || STATUS.active;
                return `<div class="uie-card" style="margin:0">
                    <div class="uie-row uie-between"><h4 style="margin:0">${icon(ic)} ${esc(q.title)}</h4><span class="uie-tag ${tone}">${esc(label)}</span></div>
                    ${q.desc ? `<p style="line-height:1.45;margin:8px 0">${esc(q.desc)}</p>` : ''}
                    ${objs.length ? `<div style="margin:6px 0">${objs.map(([oid, o]) => `<label class="uie-switch" style="min-height:38px"><input type="checkbox" data-obj="${esc(q.id)}|${esc(oid)}" ${o.done ? 'checked' : ''}><span></span> <span style="${o.done ? 'text-decoration:line-through;opacity:.65' : ''}">${esc(o.text)}</span></label>`).join('')}</div><div class="uie-muted" style="font-size:.8rem">${done}/${objs.length} objectives</div>` : ''}
                    <div class="uie-muted" style="font-size:.75rem;margin-top:4px">${q.giver ? `From ${esc(q.giver)} · ` : ''}${q.reward ? `Reward: ${esc(q.reward)} · ` : ''}Started ${esc(formatDate(toParts(q.created || 0, s.calendar.epoch), 'long', s.calendar.monthNames))}</div>
                    <div class="uie-item-actions">
                        <button class="uie-btn uie-btn-sm" data-addobj="${esc(q.id)}">${icon('fa-plus')} Objective</button>
                        ${q.status !== 'done' ? `<button class="uie-btn uie-btn-sm" data-st="${esc(q.id)}|done">${icon('fa-check')} Complete</button>` : ''}
                        ${q.status !== 'failed' ? `<button class="uie-btn uie-btn-sm" data-st="${esc(q.id)}|failed">${icon('fa-xmark')} Fail</button>` : ''}
                        ${q.status !== 'active' ? `<button class="uie-btn uie-btn-sm" data-st="${esc(q.id)}|active">${icon('fa-rotate')} Reopen</button>` : ''}
                        <button class="uie-btn uie-btn-sm" data-edit="${esc(q.id)}">${icon('fa-pen')}</button>
                        <button class="uie-btn uie-btn-sm" data-del="${esc(q.id)}">${icon('fa-trash')}</button>
                    </div>
                </div>`;
            }).join('') : `<div class="uie-empty">${icon('fa-scroll')}No ${view.filter === 'all' ? '' : STATUS[view.filter][0].toLowerCase()} quests.<br><small>Quests appear as the story hands them out, or add your own.</small></div>`}</div>
            <div class="uie-fab"><button class="uie-btn uie-btn-primary" data-j="add">${icon('fa-plus')} New quest</button></div>`;
    };
    render();
    sheet.onCleanup(bus.on(() => render()));
    sheet.el.addEventListener('change', (e) => {
        const o = e.target.closest('[data-obj]');
        if (!o) return;
        const [qid, oid] = o.dataset.obj.split('|');
        mutate(s => { s.quests[qid].objectives[oid].done = o.checked; });
    });
    sheet.el.addEventListener('click', async (e) => {
        try {
            const f = e.target.closest('[data-f]');
            if (f) { view.filter = f.dataset.f; render(); return; }
            const stb = e.target.closest('[data-st]');
            if (stb) { const [qid, st] = stb.dataset.st.split('|'); mutate(s => { s.quests[qid].status = st; }); return; }
            const ao = e.target.closest('[data-addobj]');
            if (ao) {
                const t = await promptDialog('New objective', { label: 'Objective' });
                if (t?.trim()) mutate(s => { const q = s.quests[ao.dataset.addobj]; q.objectives = q.objectives || {}; q.objectives[uid('o')] = { text: str(t, 120), done: false }; });
                return;
            }
            const del = e.target.closest('[data-del]');
            if (del) {
                if (await confirmDialog('Delete quest', 'Remove this quest from the journal?', { okLabel: 'Delete', danger: true })) mutate(s => { delete s.quests[del.dataset.del]; });
                return;
            }
            const ed = e.target.closest('[data-edit]');
            if (ed || e.target.closest('[data-j="add"]')) {
                const q = ed ? S().quests[ed.dataset.edit] : null;
                const v = await formDialog(q ? 'Edit quest' : 'New quest', `
                    <label class="uie-field"><span>Title</span><input name="title" value="${esc(q?.title || '')}" maxlength="120" required></label>
                    <label class="uie-field"><span>Description</span><textarea name="desc" rows="3">${esc(q?.desc || '')}</textarea></label>
                    <div class="uie-grid2"><label class="uie-field"><span>Given by</span><input name="giver" value="${esc(q?.giver || '')}"></label><label class="uie-field"><span>Reward</span><input name="reward" value="${esc(q?.reward || '')}"></label></div>
                    ${q ? '' : '<label class="uie-field"><span>Objectives (one per line)</span><textarea name="objectives" rows="3"></textarea></label>'}
                    ${q ? `<label class="uie-field"><span>Status</span><select name="status">${Object.entries(STATUS).map(([k, v2]) => opt(k, v2[0], q.status === k)).join('')}</select></label>` : ''}`, { okLabel: q ? 'Save' : 'Add' });
                if (!v?.title?.trim()) return;
                if (q) mutate(s => { Object.assign(s.quests[q.id], { title: str(v.title, 120), desc: text(v.desc, 600), giver: str(v.giver, 60), reward: str(v.reward, 120), status: v.status }); });
                else {
                    userOps([{ op: 'quest.add', title: v.title, desc: v.desc, objectives: String(v.objectives || '').split('\n').map(x => x.trim()).filter(Boolean) }]);
                    const nq = Object.values(S().quests).find(x => x.title === str(v.title, 120));
                    if (nq) mutate(() => { nq.giver = str(v.giver, 60); nq.reward = str(v.reward, 120); });
                }
            }
        } catch (err) { reportError(err); }
    });
    return sheet;
}
