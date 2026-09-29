// Optional visual-novel stage: styles ST's last AI message as a VN dialogue box
// (name tag, round avatar, cream textbox, next chevron). Pure CSS class toggles on
// existing ST elements — nothing in ST's DOM is moved or rewritten. Off by default.

import { st } from '../st-adapter.js';

let on = false;
const offs = [];

function mark() {
    if (!on) return;
    try {
        document.querySelectorAll('#chat .mes.uie-vn-last').forEach(n => n.classList.remove('uie-vn-last'));
        const msgs = document.querySelectorAll('#chat .mes[is_user="false"]:not([is_system="true"])');
        const last = msgs[msgs.length - 1];
        if (last) {
            last.classList.add('uie-vn-last');
            if (!last.querySelector('.uie-vn-next')) {
                const chev = document.createElement('button');
                chev.className = 'uie-vn-next';
                chev.setAttribute('aria-label', 'Continue');
                chev.innerHTML = '<i class="fa-solid fa-chevron-right"></i>';
                chev.addEventListener('click', () => {
                    const ta = document.getElementById('send_textarea');
                    if (ta) ta.focus();
                });
                last.querySelector('.mes_block')?.appendChild(chev);
            }
        }
    } catch (e) { st.warn('vn mark failed', e); }
}

export function mountVn() {
    if (on) return;
    // Don't fight ST's own VN mode (power user setting); only one at a time.
    if (document.body.classList.contains('waifuMode')) {
        globalThis.toastr?.info?.('SillyTavern\'s own Visual Novel mode is active — UIE stage styling stays off.', 'UIE');
        return;
    }
    on = true;
    document.body.classList.add('uie-vn');
    for (const ev of ['CHARACTER_MESSAGE_RENDERED', 'CHAT_CHANGED', 'MESSAGE_DELETED', 'MESSAGE_SWIPED', 'USER_MESSAGE_RENDERED']) {
        offs.push(st.on(ev, () => setTimeout(mark, 30)));
    }
    mark();
}

export function unmountVn() {
    on = false;
    offs.splice(0).forEach(f => f());
    document.body.classList.remove('uie-vn');
    document.querySelectorAll('.uie-vn-last').forEach(n => n.classList.remove('uie-vn-last'));
    document.querySelectorAll('.uie-vn-next').forEach(n => n.remove());
}
