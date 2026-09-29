// Characters: UIE data stored on the ST character card itself (writeExtensionField):
// drives, organizations, per-character chat rules (injected while chatting with them),
// and a voice assignment passed to ST's TTS extension.

import { st } from '../st-adapter.js';
import { S, mutate } from '../state.js';
import { openSheet } from './sheet.js';
import { esc, icon, reportError } from './dom.js';
import { findByName } from '../engine/dedupe.js';
import { uid, str, text } from '../engine/util.js';
import { refreshInjection } from '../core.js';

export function open() {
    const sheet = openSheet({ id: 'characters', title: 'Characters', icon: 'fa-id-card', size: 'wide' });
    const chars = st.characters();
    const current = st.characterId();
    const view = { i: current !== undefined && current !== null ? Number(current) : (chars.length ? 0 : -1), q: '' };

    const render = () => {
        const list = st.characters();
        const c = list[view.i];
        const data = c?.data?.extensions?.uie || {};
        const tts = st.ttsInfo();
        const voices = st.ttsVoices();
        const curVoice = tts?.map?.[c?.name] || data.voice || '';
        const q = view.q.toLowerCase();
        sheet.body.innerHTML = `
            <div class="uie-org-layout">
                <div class="uie-card" style="margin:0">
                    <input type="search" data-cq placeholder="Search characters…" value="${esc(view.q)}" aria-label="Search characters" style="margin-bottom:10px">
                    <div style="display:grid;gap:6px;max-height:60dvh;overflow:auto">${list.map((ch, i) => !q || ch.name.toLowerCase().includes(q) ? `<button class="uie-tile ${i === view.i ? 'active' : ''}" data-ci="${i}"><img src="${esc(st.avatarUrl(ch))}" alt="" style="width:36px;height:36px;border-radius:50%;object-fit:cover" loading="lazy"><span class="uie-grow">${esc(ch.name)}${String(i) === String(current) ? ' <small class="uie-muted">· in chat</small>' : ''}</span></button>` : '').join('') || '<p class="uie-muted">No characters.</p>'}</div>
                </div>
                <div>${c ? `
                    <div class="uie-persona-top"><div class="uie-portrait"><img src="${esc(st.avatarUrl(c))}" alt=""></div><div class="uie-grow"><h3 style="margin:0;font:700 1.3rem var(--uie-font-head)">${esc(c.name)}</h3><p class="uie-muted" style="font-size:.85rem">${esc(String(c.data?.description || c.description || '').slice(0, 180))}…</p>
                    <button class="uie-btn uie-btn-sm" data-c="npc">${icon('fa-user-plus')} ${findByName(Object.values(S().npcs), c.name, 0.9) ? 'Linked NPC ✓' : 'Add as NPC'}</button></div></div>
                    <form class="uie-pad" data-cform>
                        <label class="uie-field"><span>Drives &amp; goals</span><textarea name="drives" rows="3" placeholder="Wants to find a lead vocalist; fears being forgotten">${esc(data.drives || '')}</textarea></label>
                        <label class="uie-field"><span>Organizations</span><input name="orgs" value="${esc((data.orgs || []).join(', '))}" placeholder="Comma separated" list="uie-org-list"><datalist id="uie-org-list">${Object.values(S().orgs).map(o => `<option value="${esc(o.name)}">`).join('')}</datalist></label>
                        <label class="uie-field"><span>Chat rules for this character</span><textarea name="chatRules" rows="4" placeholder="Always speaks in short sentences. Never reveals the secret before chapter 3.">${esc(data.chatRules || '')}</textarea><small>Injected into the prompt while you chat with this character.</small></label>
                        <div class="uie-card"><h4>${icon('fa-microphone-lines')} Voice</h4>
                            ${tts ? `<p class="uie-muted" style="font-size:.85rem">TTS provider: <b>${esc(tts.provider || 'none')}</b>${tts.enabled ? '' : ' (TTS is disabled in ST)'}</p>` : '<p class="uie-muted" style="font-size:.85rem">SillyTavern\'s TTS extension is not configured. The voice id is still saved on the card.</p>'}
                            <label class="uie-field"><span>Voice id</span><input name="voice" value="${esc(curVoice)}" list="uie-voices" placeholder="Pick or type a voice id"><datalist id="uie-voices">${voices.map(v => `<option value="${esc(v)}">`).join('')}</datalist>${voices.length ? `<small>${voices.length} voices found in the TTS settings.</small>` : ''}</label>
                        </div>
                        <button type="button" class="uie-btn uie-btn-primary uie-btn-block" data-c="save">${icon('fa-floppy-disk')} Save to character card</button>
                    </form>` : '<div class="uie-empty">Pick a character.</div>'}
                </div>
            </div>`;
    };
    render();
    let t;
    sheet.body.addEventListener('input', (e) => {
        if (!e.target.matches('[data-cq]')) return;
        clearTimeout(t);
        t = setTimeout(() => { view.q = e.target.value; render(); const i = sheet.body.querySelector('[data-cq]'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }, 200);
    });
    sheet.body.addEventListener('click', async (e) => {
        try {
            const ci = e.target.closest('[data-ci]');
            if (ci) { view.i = Number(ci.dataset.ci); render(); return; }
            const a = e.target.closest('[data-c]')?.dataset.c;
            const c = st.characters()[view.i];
            if (!a || !c) return;
            if (a === 'save') {
                const f = sheet.body.querySelector('[data-cform]');
                const g = (n) => f.querySelector(`[name=${n}]`).value;
                const payload = { drives: text(g('drives'), 1500), orgs: g('orgs').split(',').map(x => x.trim()).filter(Boolean).slice(0, 12), chatRules: text(g('chatRules'), 2000), voice: str(g('voice'), 120) };
                await st.writeCharField('uie', payload, view.i);
                if (payload.voice) {
                    try { st.setTtsVoice(c.name, payload.voice); } catch (err) { st.warn('tts voice not applied', err); }
                }
                refreshInjection();
                globalThis.toastr?.success?.(`Saved to ${c.name}'s card.`, 'UIE');
            }
            if (a === 'npc') {
                const ex = findByName(Object.values(S().npcs), c.name, 0.9);
                if (ex) return;
                mutate(s => {
                    const id = uid('npc');
                    s.npcs[id] = { id, name: c.name, aliases: [], role: 'Character', title: '', age: '', location: '', appearance: String(c.data?.description || '').slice(0, 600), personality: String(c.data?.personality || '').slice(0, 600), orgs: c.data?.extensions?.uie?.orgs || [], rumors: '', secrets: '', schedule: [], notes: '', locked: false, card: c.name, rel: { affection: 30, trust: 30, standing: 50, memories: [] }, met: s.clock.t };
                });
                render();
            }
        } catch (err) { reportError(err); }
    });
    return sheet;
}
