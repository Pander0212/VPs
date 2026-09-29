// Party: members (from NPCs), roles, simple combat stats and equipment slots.

import { S, bus, mutate } from '../state.js';
import { openSheet, choiceDialog, formDialog, confirmDialog } from './sheet.js';
import { esc, icon, bar, reportError } from './dom.js';
import { npcAvatar } from './npcs.js';
import { str, clamp } from '../engine/util.js';

const ROLES = ['Tank', 'Fighter', 'Healer', 'Mage', 'Scout', 'Support', 'Face', 'Companion'];
const SLOTS = ['weapon', 'offhand', 'armor', 'accessory'];

export function open() {
    const sheet = openSheet({ id: 'party', title: 'Party', icon: 'fa-people-group', actions: `<button class="uie-icon-btn" data-p="add" aria-label="Add member">${icon('fa-user-plus')}</button>` });
    const render = () => {
        const s = S();
        const members = Object.entries(s.party.members).map(([id, m]) => ({ id, m, n: s.npcs[id] })).filter(x => x.n);
        const p = s.player;
        sheet.body.innerHTML = `
            <div class="uie-list">
                <div class="uie-npc-card" style="border-color:var(--accent)">
                    <div class="uie-npc-top"><span class="uie-avatar-lg" style="--av:#6b4a1c">${icon('fa-star')}</span><div class="uie-grow"><h4>${esc(p.name || 'You')}</h4><div class="uie-sub">Leader · Lv ${esc(p.level)} ${esc(p.cls || '')}</div></div></div>
                    <div class="uie-meter"><span>HP</span>${bar(p.bars.hp?.value || 0, p.bars.hp?.max || 1, p.bars.hp?.color || '#e0565b')}<b>${esc(Math.round(p.bars.hp?.value || 0))}</b></div>
                    <div class="uie-sub">${icon('fa-shirt')} ${Object.entries(s.equipment).map(([slot, iid]) => s.inventory[iid] ? `${esc(slot)}: ${esc(s.inventory[iid].name)}` : '').filter(Boolean).join(' · ') || 'Nothing equipped'}</div>
                </div>
                ${members.length ? members.map(({ id, m, n }) => `
                <div class="uie-npc-card">
                    <div class="uie-npc-top">${npcAvatar(n)}<div class="uie-grow"><h4>${esc(n.name)}</h4><div class="uie-sub">${esc(m.role || 'Companion')} · ATK ${esc(m.atk ?? 8)} · DEF ${esc(m.def ?? 3)} · SPD ${esc(m.spd ?? 5)}</div></div></div>
                    <div class="uie-meter"><span>HP</span>${bar(m.hp ?? 60, m.maxHp ?? 60, '#e0565b')}<b>${esc(m.hp ?? 60)}</b></div>
                    <div class="uie-equip-slots" style="padding:6px 0 0">${SLOTS.map(sl => `<div class="uie-slot"><b>${sl}</b>${esc(m.slots?.[sl] || '—')}</div>`).join('')}</div>
                    <div class="uie-item-actions"><button class="uie-btn uie-btn-sm" data-edit="${esc(id)}">${icon('fa-pen')} Edit</button><button class="uie-btn uie-btn-sm" data-heal="${esc(id)}">${icon('fa-heart-pulse')} Rest</button><button class="uie-btn uie-btn-sm" data-rm="${esc(id)}">${icon('fa-user-minus')} Remove</button></div>
                </div>`).join('') : `<div class="uie-empty">${icon('fa-people-group')}Nobody travels with you yet.<br><small>Add NPCs to your party — they fight alongside you in battles.</small></div>`}
            </div>
            <div class="uie-fab"><button class="uie-btn uie-btn-primary" data-p="add">${icon('fa-user-plus')} Add member</button></div>`;
    };
    render();
    sheet.onCleanup(bus.on(() => render()));
    sheet.body.addEventListener('click', async (e) => {
        try {
            const s = S();
            if (e.target.closest('[data-p="add"]')) {
                const avail = Object.values(s.npcs).filter(n => !s.party.members[n.id]);
                if (!avail.length) { globalThis.toastr?.info?.('No NPCs to add — meet someone first or add an NPC.', 'UIE'); return; }
                const id = await choiceDialog('Add to party', avail.slice(0, 60).map(n => ({ label: n.name, value: n.id, icon: 'fa-user', hint: n.role })));
                if (!id) return;
                const role = await choiceDialog('Role', ROLES.map(r => ({ label: r, value: r })));
                mutate(st => { st.party.members[id] = { role: role || 'Companion', hp: 60, maxHp: 60, atk: 8, def: 3, spd: 5, slots: {} }; });
                return;
            }
            const ed = e.target.closest('[data-edit]');
            if (ed) {
                const m = s.party.members[ed.dataset.edit];
                const v = await formDialog('Edit party member', `
                    <label class="uie-field"><span>Role</span><select name="role">${ROLES.map(r => `<option ${m.role === r ? 'selected' : ''}>${r}</option>`).join('')}</select></label>
                    <div class="uie-grid2">${['maxHp', 'atk', 'def', 'spd'].map(k => `<label class="uie-field"><span>${k === 'maxHp' ? 'Max HP' : k.toUpperCase()}</span><input type="number" name="${k}" min="1" max="999" value="${esc(m[k] ?? '')}"></label>`).join('')}</div>
                    ${SLOTS.map(sl => `<label class="uie-field"><span>${sl}</span><input name="slot_${sl}" value="${esc(m.slots?.[sl] || '')}" maxlength="60"></label>`).join('')}`);
                if (!v) return;
                mutate(st => {
                    const mm = st.party.members[ed.dataset.edit];
                    mm.role = v.role;
                    for (const k of ['maxHp', 'atk', 'def', 'spd']) mm[k] = clamp(Number(v[k]) || mm[k] || 1, 1, 999);
                    mm.hp = Math.min(mm.hp ?? mm.maxHp, mm.maxHp);
                    mm.slots = Object.fromEntries(SLOTS.map(sl => [sl, str(v[`slot_${sl}`], 60)]));
                });
                return;
            }
            const h = e.target.closest('[data-heal]');
            if (h) { mutate(st => { const mm = st.party.members[h.dataset.heal]; mm.hp = mm.maxHp ?? 60; }); return; }
            const rm = e.target.closest('[data-rm]');
            if (rm && await confirmDialog('Remove from party', `Remove ${s.npcs[rm.dataset.rm]?.name}?`, { okLabel: 'Remove' })) mutate(st => { delete st.party.members[rm.dataset.rm]; });
        } catch (err) { reportError(err); }
    });
    return sheet;
}
