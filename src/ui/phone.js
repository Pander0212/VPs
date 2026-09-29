// Phone: contacts are known NPCs; text threads are generated in character with quiet/raw
// prompts, stored per NPC, and can be summarized into the Databank (-> main context).

import { S, bus, mutate } from '../state.js';
import { st } from '../st-adapter.js';
import { openSheet, confirmDialog } from './sheet.js';
import { esc, icon, reportError } from './dom.js';
import { genText, render as renderPrompt, recentMessages } from '../ai/gen.js';
import { relationshipLabel } from '../engine/rules.js';
import { toParts, formatTime } from '../engine/time.js';
import { uid, str } from '../engine/util.js';
import { npcAvatar } from './npcs.js';

function threadText(thread, npcName) {
    return thread.slice(-12).map(m => `${m.from === 'me' ? st.userName() : npcName}: ${m.text}`).join('\n');
}

export function open(params = {}) {
    const sheet = openSheet({ id: 'phone', title: 'Phone', icon: 'fa-mobile-screen' });
    const view = { npc: params.npc || null, busy: false };

    const render = () => {
        const s = S();
        if (!view.npc) {
            const contacts = Object.values(s.npcs).sort((a, b) => {
                const la = s.phone.threads[a.id]?.at(-1)?.at || 0, lb = s.phone.threads[b.id]?.at(-1)?.at || 0;
                return lb - la || a.name.localeCompare(b.name);
            });
            sheet.setTitle('Phone');
            sheet.body.innerHTML = `<div class="uie-phone-frame">
                <div class="uie-pad uie-muted" style="font-size:.85rem">${icon('fa-sim-card')} Your number: ${esc(s.phone.number || 'unknown')} · Texts stay on the phone — nothing is posted into the main chat unless you summarize it.</div>
                ${contacts.length ? contacts.map(n => {
                    const last = s.phone.threads[n.id]?.at(-1);
                    return `<button class="uie-contact" data-npc="${esc(n.id)}">${npcAvatar(n)}<span class="uie-grow"><b>${esc(n.name)}</b><small>${esc(last ? `${last.from === 'me' ? 'You: ' : ''}${last.text}` : n.role || 'No messages yet')}</small></span>${icon('fa-chevron-right')}</button>`;
                }).join('') : `<div class="uie-empty">${icon('fa-address-book')}No contacts yet.<br><small>People you meet in the story become contacts.</small></div>`}
            </div>`;
            return;
        }
        const n = s.npcs[view.npc];
        if (!n) { view.npc = null; render(); return; }
        const thread = s.phone.threads[n.id] || [];
        sheet.setTitle(n.name);
        sheet.body.innerHTML = `<div class="uie-phone-frame uie-phone-thread">
            <div class="uie-row" style="padding:8px 12px;border-bottom:1px solid var(--line)"><button class="uie-btn uie-btn-sm" data-back>${icon('fa-chevron-left')} Contacts</button><span class="uie-grow"></span><button class="uie-btn uie-btn-sm" data-sum ${thread.length ? '' : 'disabled'}>${icon('fa-file-lines')} Summarize</button><button class="uie-icon-btn" data-clear aria-label="Clear thread">${icon('fa-trash')}</button></div>
            <div class="uie-chatlog" style="max-height:none">${thread.length ? thread.map(m => `<div class="uie-msg ${m.from === 'me' ? 'me' : 'them'}">${m.from === 'me' ? '' : `<span class="uie-avatar">${esc(n.name[0])}</span>`}<div class="uie-bubble">${esc(m.text)}<div class="uie-muted" style="font-size:.68rem;margin-top:3px;${m.from === 'me' ? 'color:inherit;opacity:.7' : ''}">${esc(formatTime(toParts(m.gameT || 0, s.calendar.epoch), s.calendar.h24))}</div></div></div>`).join('') : `<div class="uie-empty">${icon('fa-comment-sms')}Start a conversation with ${esc(n.name)}.</div>`}
            ${view.busy ? `<div class="uie-msg them"><span class="uie-avatar">${esc(n.name[0])}</span><div class="uie-bubble uie-typing"><i></i><i></i><i></i></div></div>` : ''}</div>
            <form class="uie-chatbar" data-send><input name="t" placeholder="Text ${esc(n.name)}…" autocomplete="off" enterkeyhint="send" aria-label="Message"><button class="uie-icon-btn uie-send" aria-label="Send">${icon('fa-paper-plane')}</button></form>
        </div>`;
        const log = sheet.body.querySelector('.uie-chatlog');
        log.scrollTop = log.scrollHeight;
    };
    render();
    sheet.onCleanup(bus.on((r) => { if (r !== 'phone' && !document.activeElement?.matches?.('[name=t]')) render(); }));

    sheet.body.addEventListener('click', async (e) => {
        try {
            const c = e.target.closest('[data-npc]');
            if (c) { view.npc = c.dataset.npc; render(); return; }
            if (e.target.closest('[data-back]')) { view.npc = null; render(); return; }
            if (e.target.closest('[data-clear]')) {
                if (await confirmDialog('Clear thread', 'Delete this text conversation?', { okLabel: 'Delete', danger: true })) { mutate(s => { delete s.phone.threads[view.npc]; }, 'phone'); render(); }
                return;
            }
            if (e.target.closest('[data-sum]')) {
                const s = S();
                const n = s.npcs[view.npc];
                const txt = await genText(renderPrompt('phoneSummary', { npc: n.name, thread: threadText(s.phone.threads[n.id] || [], n.name) }), { responseLength: 160, label: 'Phone summary' });
                const clean = str(txt, 400);
                if (!clean) return;
                mutate(st2 => { const id = uid('fact'); st2.databank[id] = { id, title: `Texts with ${n.name}`, text: clean, tags: ['phone'], t: st2.clock.t, pinned: true }; });
                globalThis.toastr?.success?.('Summary added to the Databank (always in context).', 'UIE');
            }
        } catch (err) { reportError(err); }
    });
    sheet.body.addEventListener('submit', async (e) => {
        if (!e.target.matches('[data-send]')) return;
        e.preventDefault();
        const inp = e.target.querySelector('[name=t]');
        const text = str(inp.value, 500);
        if (!text || view.busy) return;
        inp.value = '';
        const id = view.npc;
        mutate(s => { s.phone.threads[id] = [...(s.phone.threads[id] || []), { from: 'me', text, at: Date.now(), gameT: s.clock.t }].slice(-80); }, 'phone');
        view.busy = true;
        render();
        try {
            const s = S();
            const n = s.npcs[id];
            const p = toParts(s.clock.t, s.calendar.epoch);
            const out = await genText(renderPrompt('phone', {
                npc: n.name, persona: [n.personality, n.role].filter(Boolean).join('; ').slice(0, 500) || 'a person from the story',
                rel: n.rel ? relationshipLabel(n.rel) : 'acquaintance', time: formatTime(p, true),
                thread: threadText(s.phone.threads[id] || [], n.name), messages: recentMessages(2, null, 800),
            }), { responseLength: 180, label: 'Phone' });
            const replies = String(out).split('\n').map(x => x.replace(new RegExp(`^\\s*${n.name.split(' ')[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:\\s*`, 'i'), '').replace(/^["“]|["”]$/g, '').trim()).filter(Boolean).slice(0, 3);
            mutate(st2 => { st2.phone.threads[id] = [...(st2.phone.threads[id] || []), ...replies.map(r => ({ from: 'them', text: str(r, 500), at: Date.now(), gameT: st2.clock.t }))].slice(-80); }, 'phone');
        } catch (err) {
            reportError(err);
        } finally {
            view.busy = false;
            render();
        }
    });
    return sheet;
}
