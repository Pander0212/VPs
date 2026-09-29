// Databank: facts learned during the campaign. Searchable, taggable; fed into the prompt
// injection by relevance (see ai/context.js).

import { S, bus, mutate } from '../state.js';
import { openSheet, formDialog, confirmDialog } from './sheet.js';
import { esc, icon, reportError } from './dom.js';
import { normalizeName } from '../engine/dedupe.js';
import { uid, str, text } from '../engine/util.js';
import { toParts, formatDate } from '../engine/time.js';

export function open() {
    const sheet = openSheet({ id: 'databank', title: 'Databank', icon: 'fa-database', actions: `<button class="uie-icon-btn" data-d="add" aria-label="Add fact">${icon('fa-plus')}</button>` });
    const view = { q: '', tag: '' };
    const render = () => {
        const s = S();
        const facts = Object.values(s.databank);
        const tags = [...new Set(facts.flatMap(f => f.tags || []))].sort();
        const q = normalizeName(view.q);
        const list = facts.filter(f => (!view.tag || (f.tags || []).includes(view.tag)) && (!q || normalizeName(`${f.title} ${f.text} ${(f.tags || []).join(' ')}`).includes(q))).sort((a, b) => (b.t || 0) - (a.t || 0));
        sheet.body.innerHTML = `
            <div class="uie-toolbar"><input type="search" class="uie-search" data-dq placeholder="Search facts…" value="${esc(view.q)}" aria-label="Search facts"></div>
            ${tags.length ? `<div class="uie-suggest" style="padding-top:10px"><button class="uie-pill ${!view.tag ? 'active' : ''}" data-tag="">All</button>${tags.map(t => `<button class="uie-pill ${view.tag === t ? 'active' : ''}" data-tag="${esc(t)}">#${esc(t)}</button>`).join('')}</div>` : ''}
            <div class="uie-list">${list.length ? list.map(f => `
                <div class="uie-item"><span class="uie-emoji">📌</span><div class="uie-grow"><h4>${esc(f.title)}</h4><p style="color:var(--ink)">${esc(f.text)}</p>
                <div class="uie-row uie-wrap" style="margin-top:4px">${(f.tags || []).map(t => `<span class="uie-tag">#${esc(t)}</span>`).join('')}<span class="uie-muted" style="font-size:.72rem">${esc(formatDate(toParts(f.t || 0, s.calendar.epoch), 'iso'))}</span>${f.pinned ? `<span class="uie-tag good">${icon('fa-thumbtack')} always in context</span>` : ''}</div></div>
                <div style="display:flex;flex-direction:column;gap:4px"><button class="uie-icon-btn" data-edit="${esc(f.id)}" aria-label="Edit">${icon('fa-pen')}</button><button class="uie-icon-btn" data-del="${esc(f.id)}" aria-label="Delete">${icon('fa-trash')}</button></div></div>`).join('')
                : `<div class="uie-empty">${icon('fa-database')}No facts yet.<br><small>Lore and discoveries are saved here and the most relevant ones are reminded to the AI.</small></div>`}</div>
            <div class="uie-fab"><button class="uie-btn uie-btn-primary" data-d="add">${icon('fa-plus')} Add fact</button></div>`;
    };
    render();
    sheet.onCleanup(bus.on(() => { if (!document.activeElement?.matches?.('[data-dq]')) render(); }));
    let t;
    sheet.body.addEventListener('input', (e) => {
        if (!e.target.matches('[data-dq]')) return;
        clearTimeout(t);
        t = setTimeout(() => { view.q = e.target.value; render(); const i = sheet.body.querySelector('[data-dq]'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }, 200);
    });
    sheet.el.addEventListener('click', async (e) => {
        try {
            const tg = e.target.closest('[data-tag]');
            if (tg) { view.tag = tg.dataset.tag; render(); return; }
            const del = e.target.closest('[data-del]');
            if (del) { if (await confirmDialog('Delete fact', 'Remove this fact?', { okLabel: 'Delete', danger: true })) mutate(s => { delete s.databank[del.dataset.del]; }); return; }
            const ed = e.target.closest('[data-edit]');
            if (!ed && !e.target.closest('[data-d="add"]')) return;
            const f = ed ? S().databank[ed.dataset.edit] : null;
            const v = await formDialog(f ? 'Edit fact' : 'Add fact', `
                <label class="uie-field"><span>Title</span><input name="title" value="${esc(f?.title || '')}" maxlength="120" required></label>
                <label class="uie-field"><span>Fact</span><textarea name="text" rows="4">${esc(f?.text || '')}</textarea></label>
                <label class="uie-field"><span>Tags (comma separated)</span><input name="tags" value="${esc((f?.tags || []).join(', '))}" placeholder="lore, people, magic"></label>
                <label class="uie-switch"><input type="checkbox" name="pinned" ${f?.pinned ? 'checked' : ''}><span></span> Always include in AI context</label>`);
            if (!v?.title?.trim()) return;
            mutate(s => {
                const id = f?.id || uid('fact');
                s.databank[id] = { ...(s.databank[id] || { t: s.clock.t }), id, title: str(v.title, 120), text: text(v.text, 1000), tags: String(v.tags || '').split(',').map(x => x.trim().replace(/^#/, '')).filter(Boolean).slice(0, 8), pinned: !!v.pinned };
            });
        } catch (err) { reportError(err); }
    });
    return sheet;
}
