// Helper Pet chat window. Uses quiet/raw generation over the UIE state; never posts into
// the main chat. Proposed ops are shown as a card and only applied after confirmation.

import { S, settingsGet, userOps, mutate } from '../state.js';
import { openSheet } from './sheet.js';
import { esc, icon, aiText, reportError } from './dom.js';
import { genText, render, recentMessages } from '../ai/gen.js';
import { compileContext } from '../ai/context.js';
import { extractOps } from '../ai/json.js';
import { validateOps, USER_OPS } from '../engine/ops.js';
import { stripTags } from '../engine/ledger.js';

const SUGGESTIONS = [
    'Where can I go from here?',
    'Create a fitting item I could find nearby',
    'Give me a side quest',
    'Write a status effect for being soaked',
    'Summarize what happened so far',
];

function describeOp(o) {
    switch (o.op) {
        case 'item.add': return `${icon('fa-plus')} Add ${o.qty}× ${esc(o.name)} <small>(${esc(o.cat)})</small>`;
        case 'quest.add': return `${icon('fa-scroll')} New quest: ${esc(o.title)}`;
        case 'status.add': return `${icon('fa-shield-virus')} Status: ${esc(o.name)}${o.desc ? ` — ${esc(o.desc)}` : ''}`;
        case 'npc.upsert': return `${icon('fa-user')} NPC: ${esc(o.name)}${o.role ? ` (${esc(o.role)})` : ''}`;
        case 'location.add': return `${icon('fa-location-dot')} Place: ${esc(o.to)}`;
        case 'databank.add': return `${icon('fa-database')} Fact: ${esc(o.title)}`;
        default: return `${icon('fa-gear')} ${esc(o.op)} ${esc(o.name || o.title || o.to || o.org || '')}`;
    }
}

export function open() {
    const pet = settingsGet().helperPet;
    const sheet = openSheet({ id: 'helper', title: `${pet.name || 'Helper Pet'}`, icon: 'fa-paw', size: 'half', className: 'uie-helper' });
    const s = S();
    if (!Array.isArray(s.helper?.messages)) s.helper = { messages: [] };
    sheet.body.innerHTML = `
        <div class="uie-chatlog" aria-live="polite"></div>
        <div class="uie-suggest">${SUGGESTIONS.map(t => `<button class="uie-pill" data-sug="${esc(t)}">${esc(t)}</button>`).join('')}</div>
        <form class="uie-chatbar">
            <input name="q" type="text" placeholder="Ask ${esc(pet.name || 'your helper')}…" autocomplete="off" enterkeyhint="send" aria-label="Message">
            <button class="uie-icon-btn uie-send" aria-label="Send">${icon('fa-paper-plane')}</button>
        </form>`;
    const log = sheet.body.querySelector('.uie-chatlog');
    const input = sheet.body.querySelector('input[name=q]');

    const draw = () => {
        const msgs = S().helper?.messages || [];
        const intro = `<div class="uie-msg them"><span class="uie-avatar">${esc(pet.emoji || '🦊')}</span><div class="uie-bubble">Hello. I am your Helper Pet. You can ask me to fetch details, search files, generate customized items, skills, quests, or procedurally write status effects.</div></div>`;
        log.innerHTML = intro + msgs.map((m, i) => `
            <div class="uie-msg ${m.from === 'me' ? 'me' : 'them'}">
                ${m.from === 'me' ? '' : `<span class="uie-avatar">${esc(pet.emoji || '🦊')}</span>`}
                <div class="uie-bubble">${m.from === 'me' ? esc(m.text) : aiText(m.text)}
                    ${m.ops?.length ? `<div class="uie-opcard ${m.applied ? 'done' : ''}">
                        <div class="uie-opcard-h">${icon('fa-wand-magic-sparkles')} Proposed changes</div>
                        <ul>${m.ops.map(o => `<li>${describeOp(o)}</li>`).join('')}</ul>
                        ${m.applied ? `<div class="uie-muted">${m.applied === 'yes' ? 'Applied' : 'Discarded'}</div>` : `<div class="uie-row"><button class="uie-btn uie-btn-primary uie-btn-sm" data-apply="${i}">${icon('fa-check')} Apply</button><button class="uie-btn uie-btn-sm" data-discard="${i}">Discard</button></div>`}
                    </div>` : ''}
                </div>
            </div>`).join('') + (sheet.busy ? `<div class="uie-msg them"><span class="uie-avatar">${esc(pet.emoji || '🦊')}</span><div class="uie-bubble uie-typing"><i></i><i></i><i></i></div></div>` : '');
        log.scrollTop = log.scrollHeight;
    };

    const ask = async (q) => {
        q = String(q || '').trim();
        if (!q || sheet.busy) return;
        mutate(st => { st.helper.messages.push({ from: 'me', text: q }); st.helper.messages = st.helper.messages.slice(-40); }, 'helper');
        sheet.busy = true;
        draw();
        try {
            const prompt = render('helper', {
                pet: pet.name || 'Helper',
                state: compileContext(S(), { budget: 900, recentText: q }),
                messages: recentMessages(3),
                request: q,
            });
            const raw = await genText(prompt, { responseLength: 600, label: 'Helper Pet' });
            const ops = validateOps(extractOps(/<uie>/i.test(raw) ? raw : '') || [], USER_OPS).ops;
            const text = stripTags(raw).replace(/<uie>[\s\S]*$/i, '').trim() || '(no answer)';
            mutate(st => { st.helper.messages.push({ from: 'pet', text, ops }); }, 'helper');
        } catch (e) {
            mutate(st => { st.helper.messages.push({ from: 'pet', text: `I could not reach the model: ${e?.message || e}` }); }, 'helper');
        } finally {
            sheet.busy = false;
            draw();
        }
    };

    sheet.body.querySelector('form').addEventListener('submit', (e) => {
        e.preventDefault();
        const q = input.value;
        input.value = '';
        ask(q);
    });
    sheet.body.addEventListener('click', (e) => {
        const sug = e.target.closest('[data-sug]');
        if (sug) { ask(sug.dataset.sug); return; }
        const ap = e.target.closest('[data-apply]');
        const di = e.target.closest('[data-discard]');
        const i = Number((ap || di)?.dataset.apply ?? (ap || di)?.dataset.discard);
        if (!ap && !di) return;
        try {
            const m = S().helper.messages[i];
            if (!m || m.applied) return;
            if (ap) userOps(m.ops);
            mutate(() => { m.applied = ap ? 'yes' : 'no'; }, 'helper');
            draw();
        } catch (err) { reportError(err); }
    });
    draw();
    return sheet;
}
