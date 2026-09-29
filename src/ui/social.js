// Social: per-character relationship meters (affection, trust, standing), a computed label,
// and a memories list. The tracker pass updates these via rel.delta / rel.memory ops.

import { S, bus, mutate } from '../state.js';
import { openSheet, promptDialog } from './sheet.js';
import { esc, icon, bar, reportError } from './dom.js';
import { relationshipLabel } from '../engine/rules.js';
import { toParts, formatDate } from '../engine/time.js';
import { npcAvatar } from './npcs.js';
import { openPanel } from './panels.js';
import { str, clamp } from '../engine/util.js';

const METERS = [['affection', 'Affection', '#e46a8f'], ['trust', 'Trust', '#5ab7e3'], ['standing', 'Standing', '#d6b468']];

export function open() {
    const sheet = openSheet({ id: 'social', title: 'Social', icon: 'fa-heart' });
    const view = { open: null };
    const render = () => {
        const s = S();
        const npcs = Object.values(s.npcs).sort((a, b) => ((b.rel?.affection || 0) + (b.rel?.trust || 0)) - ((a.rel?.affection || 0) + (a.rel?.trust || 0)));
        sheet.body.innerHTML = npcs.length ? `<div class="uie-list uie-list-2">${npcs.map(n => {
            const rel = n.rel || { affection: 30, trust: 30, standing: 50, memories: [] };
            const opened = view.open === n.id;
            return `<div class="uie-npc-card">
                <div class="uie-npc-top">${npcAvatar(n)}<div class="uie-grow"><h4>${esc(n.name)}</h4><div class="uie-sub">${esc(relationshipLabel(rel))}${n.locked ? ` · ${icon('fa-lock')}` : ''}</div></div>
                <button class="uie-icon-btn" data-toggle="${esc(n.id)}" aria-label="Details" aria-expanded="${opened}">${icon(opened ? 'fa-chevron-up' : 'fa-chevron-down')}</button></div>
                ${METERS.map(([k, l, c]) => `<div class="uie-meter"><span>${l}</span>${bar(rel[k] ?? 0, 100, c, { label: l })}<b>${esc(Math.round(rel[k] ?? 0))}</b></div>`).join('')}
                ${opened ? `
                    <div style="margin-top:10px">${METERS.map(([k, l]) => `<label class="uie-field"><span>${l}</span><input type="range" min="0" max="100" value="${esc(rel[k] ?? 0)}" data-rel="${esc(n.id)}|${k}"></label>`).join('')}</div>
                    <h5 class="uie-section-h" style="margin:8px 0">${icon('fa-bookmark')} Memories</h5>
                    ${(rel.memories || []).length ? [...rel.memories].reverse().slice(0, 12).map(m => `<div class="uie-sub">• ${esc(m.text)} <small class="uie-muted">(${esc(formatDate(toParts(m.t || 0, s.calendar.epoch), 'iso'))})</small></div>`).join('') : '<div class="uie-muted">No shared memories yet.</div>'}
                    <div class="uie-item-actions"><button class="uie-btn uie-btn-sm" data-mem="${esc(n.id)}">${icon('fa-plus')} Memory</button><button class="uie-btn uie-btn-sm" data-phone="${esc(n.id)}">${icon('fa-mobile-screen')} Text</button></div>` : ''}
            </div>`;
        }).join('')}</div>` : `<div class="uie-empty">${icon('fa-heart')}No relationships yet.<br><small>Meet people in the story and they appear here.</small></div>`;
    };
    render();
    sheet.onCleanup(bus.on(() => { if (!document.activeElement?.matches?.('input[type=range]')) render(); }));
    sheet.body.addEventListener('click', async (e) => {
        try {
            const t = e.target.closest('[data-toggle]');
            if (t) { view.open = view.open === t.dataset.toggle ? null : t.dataset.toggle; render(); return; }
            const m = e.target.closest('[data-mem]');
            if (m) {
                const txt = await promptDialog('Add memory', { label: 'Something you shared', multiline: true });
                if (txt?.trim()) mutate(s => { const n = s.npcs[m.dataset.mem]; n.rel = n.rel || { affection: 30, trust: 30, standing: 50, memories: [] }; n.rel.memories = [...(n.rel.memories || []), { t: s.clock.t, text: str(txt, 160) }].slice(-30); });
                return;
            }
            const p = e.target.closest('[data-phone]');
            if (p) openPanel('phone', { npc: p.dataset.phone });
        } catch (err) { reportError(err); }
    });
    sheet.body.addEventListener('change', (e) => {
        const r = e.target.closest('[data-rel]');
        if (!r) return;
        const [id, k] = r.dataset.rel.split('|');
        mutate(s => { const n = s.npcs[id]; n.rel = n.rel || { affection: 30, trust: 30, standing: 50, memories: [] }; n.rel[k] = clamp(Number(r.value), 0, 100); });
        render();
    });
    return sheet;
}
