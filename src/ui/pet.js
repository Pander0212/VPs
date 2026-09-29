// Floating Helper Pet critter. Tap to open the helper chat. Can be hidden in settings.

import { settingsGet, saveSettings } from '../state.js';
import { el, esc } from './dom.js';
import { openPanel } from './panels.js';
import { choiceDialog } from './sheet.js';

let node = null;

export function mountPet() {
    const s = settingsGet().helperPet;
    if (node) { update(); return; }
    node = el(`<button id="uie-pet" class="uie-scope uie-pet" aria-label="Open Helper Pet"><span class="uie-pet-body"></span><span class="uie-pet-shadow"></span></button>`);
    document.body.appendChild(node);
    node.addEventListener('click', () => openPanel('helper'));
    node.addEventListener('contextmenu', async (e) => {
        e.preventDefault();
        const v = await choiceDialog('Helper Pet', [
            { label: 'Open chat', value: 'open', icon: 'fa-comments' },
            { label: 'Swap side', value: 'side', icon: 'fa-left-right' },
            { label: 'Hide pet', value: 'hide', icon: 'fa-eye-slash' },
        ]);
        if (v === 'open') openPanel('helper');
        if (v === 'side') { s.side = s.side === 'right' ? 'left' : 'right'; saveSettings(); update(); }
        if (v === 'hide') { s.show = false; saveSettings(); }
    });
    update();
}

function update() {
    if (!node) return;
    const s = settingsGet().helperPet;
    node.querySelector('.uie-pet-body').textContent = s.emoji || '🦊';
    node.title = `${esc(s.name || 'Helper')} — tap to chat, long-press for options`;
    node.dataset.side = s.side === 'right' ? 'right' : 'left';
}

export function petSay(text) {
    if (!node) return;
    node.querySelector('.uie-pet-bubble')?.remove();
    const b = el(`<span class="uie-pet-bubble">${esc(text)}</span>`);
    node.appendChild(b);
    setTimeout(() => b.remove(), 3500);
}

export function unmountPet() {
    node?.remove();
    node = null;
}
