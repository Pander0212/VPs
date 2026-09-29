// Command Deck: full-screen grid menu with four labeled sections.

import { openSheet } from './sheet.js';
import { PANELS, SECTIONS, openPanel } from './panels.js';
import { esc, icon } from './dom.js';
import { S, isEphemeral } from '../state.js';
import { toParts, formatDate, formatTime } from '../engine/time.js';

export function openDeck() {
    const sheet = openSheet({ id: 'deck', title: 'Command Deck', icon: 'fa-compass-drafting', className: 'uie-deck' });
    const s = S();
    const p = toParts(s.clock.t, s.calendar.epoch);
    const here = s.map.nodes[s.map.location];
    sheet.body.innerHTML = `
        <div class="uie-deck-hero">
            <div class="uie-deck-logo"><span>UIE</span></div>
            <div class="uie-deck-meta">
                <div class="uie-deck-title">Universal Immersion Engine</div>
                <div class="uie-muted">${esc(formatDate(p, 'long', s.calendar.monthNames))} · ${esc(formatTime(p, s.calendar.h24))} · ${esc(here?.name || '—')}</div>
                ${isEphemeral() ? `<div class="uie-warn">${icon('fa-circle-info')} Open a chat to start a campaign. Changes here are not saved.</div>` : ''}
                ${!s.newGameDone && !isEphemeral() ? `<button class="uie-btn uie-btn-primary uie-deck-ng" data-open="newgame">${icon('fa-dice-d20')} Start a New Game</button>` : ''}
            </div>
        </div>
        ${SECTIONS.map(sec => `
            <section class="uie-deck-section">
                <h3>${esc(sec.label)}</h3>
                <div class="uie-deck-grid">
                    ${Object.entries(PANELS).filter(([, p2]) => p2.section === sec.id).map(([id, p2]) => `
                        <button class="uie-tile" data-open="${esc(id)}">${icon(p2.icon)}<span>${esc(p2.label)}</span></button>`).join('')}
                </div>
            </section>`).join('')}
        <p class="uie-deck-foot uie-muted">Tip: type <code>/uie-map</code>, <code>/uie-inv</code> … in chat to jump straight to a tool.</p>`;
    sheet.body.addEventListener('click', (e) => {
        const b = e.target.closest('[data-open]');
        if (!b) return;
        openPanel(b.dataset.open);
    });
    return sheet;
}
