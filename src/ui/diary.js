// Diary: open-book layout (two pages in landscape, one column in portrait), rich text
// with font / B / I / U / size / color, emoji stickers, polaroid photos (compressed
// gallery uploads or images ST generated in this chat), Previous / Next / New Page, copy, clear.

import { S, mutate } from '../state.js';
import { st } from '../st-adapter.js';
import { openSheet, confirmDialog, choiceDialog } from './sheet.js';
import { esc, icon, opt, safeHtml, compressImage, pickFile, reportError, debounce } from './dom.js';
import { uid } from '../engine/util.js';
import { toParts, formatDate, formatTime } from '../engine/time.js';

const FONTS = {
    script: ['Script', 'var(--uie-font-script)'],
    serif: ['Book serif', 'Georgia, "Palatino Linotype", serif'],
    hand: ['Handwritten', '"Segoe Print", "Bradley Hand", "Comic Sans MS", cursive'],
    type: ['Typewriter', '"Courier New", Courier, monospace'],
    sans: ['Clean', 'system-ui, sans-serif'],
};
const STICKERS = ['⭐', '💖', '🌸', '🌙', '☀️', '🍀', '🎵', '📌', '✨', '🔥', '🦋', '🍰', '🧋', '🎸', '📷', '💌', '😊', '😢', '😡', '😴', '🤔', '🥰', '👑', '🗝️', '🗺️', '⚔️', '🛡️', '🐉', '🦊', '🐾'];

function newEntry(n) {
    const s = S();
    return { id: uid('dia'), n, gameT: s.clock.t, at: Date.now(), title: '', html: '', font: 'script', size: 20, photos: [] };
}

function chatImages() {
    const out = [];
    for (const m of st.chat()) {
        const ex = m?.extra || {};
        if (typeof ex.image === 'string') out.push(ex.image);
        if (Array.isArray(ex.media)) ex.media.forEach(x => { if (x?.url) out.push(x.url); });
        if (Array.isArray(ex.image_swipes)) ex.image_swipes.forEach(u => typeof u === 'string' && out.push(u));
    }
    return [...new Set(out)].slice(-24);
}

export function open() {
    const sheet = openSheet({ id: 'diary', title: 'Diary', icon: 'fa-book-bookmark', theme: 'parchment', className: 'uie-diary' });
    const view = { i: Math.max(0, S().diary.entries.length - 1) };
    if (!S().diary.entries.length) mutate(s => { s.diary.entries.push(newEntry(1)); });

    const cur = () => S().diary.entries[view.i];

    const save = debounce(() => {
        const body = sheet.body.querySelector('.uie-diary-body');
        const subj = sheet.body.querySelector('.uie-diary-subject');
        if (!body || !cur()) return;
        const html = safeHtml(body.innerHTML, { rich: true }).slice(0, 60000);
        mutate(s => { const e = s.diary.entries[view.i]; if (e) { e.html = html; e.title = String(subj.value).slice(0, 120); } }, 'diary');
    }, 450);

    const render = () => {
        const s = S();
        const e = cur();
        if (!e) return;
        const p = toParts(e.gameT ?? s.clock.t, s.calendar.epoch);
        const font = FONTS[e.font] || FONTS.script;
        sheet.setTitle(`Diary · Entry ${e.n}`);
        sheet.body.innerHTML = `
            <div class="uie-book">
                <section class="uie-page left">
                    <div class="uie-page-head">
                        <h3>Entry #${esc(e.n)}</h3>
                        <time>${esc(formatDate(p, 'mdy'))}, ${esc(formatTime(p, false))}</time>
                        <button class="uie-icon-btn" data-d="help" aria-label="Help" style="width:36px;height:36px;border:0">${icon('fa-circle-question')}</button>
                        <button class="uie-icon-btn" data-d="delete" aria-label="Delete entry" style="width:36px;height:36px;border:0">${icon('fa-trash')}</button>
                    </div>
                    <input class="uie-diary-subject" placeholder="Subject / Title…" value="${esc(e.title)}" maxlength="120" aria-label="Subject">
                    <div class="uie-photos">${(e.photos || []).map((ph, k) => `<figure class="uie-polaroid" style="--r:${esc(ph.r)}deg"><img src="${esc(ph.src)}" alt="" loading="lazy"><button data-rmphoto="${k}" aria-label="Remove photo">${icon('fa-xmark')}</button></figure>`).join('')}</div>
                    <div class="uie-row uie-wrap" style="justify-content:center">
                        <button class="uie-btn uie-btn-sm" data-d="photo">${icon('fa-camera')} Photo</button>
                        <button class="uie-btn uie-btn-sm" data-d="stphoto">${icon('fa-images')} From chat</button>
                        <button class="uie-btn uie-btn-sm" data-d="copy">${icon('fa-copy')} Copy</button>
                        <button class="uie-btn uie-btn-sm" data-d="clear">${icon('fa-xmark')} Clear</button>
                    </div>
                    <div class="uie-page-nav">
                        <button class="uie-btn uie-btn-sm" data-d="prev" ${view.i === 0 ? 'disabled' : ''}>← Previous</button>
                        <button class="uie-btn uie-btn-sm uie-btn-primary" data-d="new">New Page</button>
                    </div>
                </section>
                <section class="uie-page right">
                    <div class="uie-row uie-between"><span></span><button class="uie-btn uie-btn-sm" data-d="stickers">${icon('fa-face-smile')} Stickers</button></div>
                    <div class="uie-diary-tools" role="toolbar" aria-label="Formatting">
                        <select data-font aria-label="Font">${Object.entries(FONTS).map(([k, v]) => opt(k, v[0], e.font === k)).join('')}</select>
                        <button class="uie-icon-btn" data-cmd="bold" aria-label="Bold">${icon('fa-bold')}</button>
                        <button class="uie-icon-btn" data-cmd="italic" aria-label="Italic">${icon('fa-italic')}</button>
                        <button class="uie-icon-btn" data-cmd="underline" aria-label="Underline">${icon('fa-underline')}</button>
                        <button class="uie-icon-btn" data-size="-2" aria-label="Smaller">${icon('fa-minus')}</button>
                        <span style="min-width:24px;text-align:center;font-weight:700">${esc(e.size)}</span>
                        <button class="uie-icon-btn" data-size="2" aria-label="Bigger">${icon('fa-plus')}</button>
                        <input type="color" data-color value="#2b1d10" aria-label="Text color">
                    </div>
                    <div class="uie-diary-body" contenteditable="true" role="textbox" aria-multiline="true" aria-label="Diary text" data-placeholder="Dear diary…" style="font-family:${font[1]};font-size:${Number(e.size) || 20}px;line-height:${Math.round((Number(e.size) || 20) * 1.6)}px">${safeHtml(e.html, { rich: true })}</div>
                    <div class="uie-page-nav"><span class="uie-muted" style="font-size:.8rem;color:#6d4b2a">${view.i + 1} / ${S().diary.entries.length}</span><button class="uie-btn uie-btn-sm" data-d="next" ${view.i >= S().diary.entries.length - 1 ? 'disabled' : ''}>Next →</button></div>
                </section>
            </div>`;
        const body = sheet.body.querySelector('.uie-diary-body');
        body.addEventListener('input', save);
        sheet.body.querySelector('.uie-diary-subject').addEventListener('input', save);
    };

    render();

    sheet.body.addEventListener('mousedown', (e) => { if (e.target.closest('[data-cmd]')) e.preventDefault(); }); // keep selection
    sheet.body.addEventListener('click', async (e) => {
        try {
            const cmd = e.target.closest('[data-cmd]')?.dataset.cmd;
            if (cmd) { document.execCommand(cmd, false); save(); return; }
            const size = e.target.closest('[data-size]')?.dataset.size;
            if (size) { flush(); mutate(s => { const en = s.diary.entries[view.i]; en.size = Math.max(12, Math.min(36, (Number(en.size) || 20) + Number(size))); }, 'diary'); render(); return; }
            const rm = e.target.closest('[data-rmphoto]');
            if (rm) { flush(); mutate(s => { s.diary.entries[view.i].photos.splice(Number(rm.dataset.rmphoto), 1); }, 'diary'); render(); return; }
            const a = e.target.closest('[data-d]')?.dataset.d;
            if (!a) return;
            switch (a) {
                case 'prev': flush(); view.i = Math.max(0, view.i - 1); render(); break;
                case 'next': flush(); view.i = Math.min(S().diary.entries.length - 1, view.i + 1); render(); break;
                case 'new': flush(); mutate(s => { s.diary.entries.push(newEntry(s.diary.entries.length + 1)); }, 'diary'); view.i = S().diary.entries.length - 1; render(); break;
                case 'delete':
                    if (!await confirmDialog('Delete entry', 'Delete this diary page?', { okLabel: 'Delete', danger: true })) return;
                    mutate(s => { s.diary.entries.splice(view.i, 1); s.diary.entries.forEach((en, k) => { en.n = k + 1; }); if (!s.diary.entries.length) s.diary.entries.push(newEntry(1)); }, 'diary');
                    view.i = Math.min(view.i, S().diary.entries.length - 1);
                    render();
                    break;
                case 'copy': {
                    const en = cur();
                    const tmp = document.createElement('div');
                    tmp.innerHTML = safeHtml(en.html, { rich: true });
                    await navigator.clipboard.writeText(`${en.title ? `${en.title}\n\n` : ''}${tmp.innerText}`);
                    globalThis.toastr?.success?.('Copied.', 'UIE');
                    break;
                }
                case 'clear':
                    if (!await confirmDialog('Clear page', 'Clear the text and photos on this page?', { okLabel: 'Clear', danger: true })) return;
                    mutate(s => { const en = s.diary.entries[view.i]; en.html = ''; en.title = ''; en.photos = []; }, 'diary');
                    render();
                    break;
                case 'photo': {
                    const f = await pickFile('image/*');
                    if (!f) return;
                    const src = await compressImage(f, { maxSide: 640, maxBytes: 200 * 1024 });
                    addPhoto(src);
                    break;
                }
                case 'stphoto': {
                    const imgs = chatImages();
                    if (!imgs.length) { globalThis.toastr?.info?.('No generated images in this chat yet.', 'UIE'); return; }
                    const pick = await choiceDialog('Pick an image from this chat', imgs.map((u, k) => ({ label: `Image ${k + 1} · ${u.split('/').pop().slice(0, 30)}`, value: u, icon: 'fa-image' })));
                    if (pick) addPhoto(pick); // stored as a reference URL, not a blob
                    break;
                }
                case 'stickers': {
                    const em = await choiceStickers();
                    if (!em) return;
                    const body = sheet.body.querySelector('.uie-diary-body');
                    body.focus();
                    const sel = window.getSelection();
                    if (!sel.rangeCount || !body.contains(sel.anchorNode)) {
                        const r = document.createRange(); r.selectNodeContents(body); r.collapse(false); sel.removeAllRanges(); sel.addRange(r);
                    }
                    document.execCommand('insertText', false, em);
                    save();
                    break;
                }
                case 'help':
                    globalThis.toastr?.info?.('Write freely — pages save automatically. Select text to format it; stickers go where the cursor is. Photos are compressed to keep your chat file small.', 'Diary', { timeOut: 7000 });
                    break;
            }
        } catch (err) { reportError(err); }
    });
    sheet.body.addEventListener('change', (e) => {
        if (e.target.matches('[data-font]')) { flush(); mutate(s => { s.diary.entries[view.i].font = e.target.value; }, 'diary'); render(); }
        if (e.target.matches('[data-color]')) { sheet.body.querySelector('.uie-diary-body').focus(); document.execCommand('foreColor', false, e.target.value); save(); }
    });
    sheet.onCleanup(() => flush());

    function flush() {
        const body = sheet.body.querySelector('.uie-diary-body');
        const subj = sheet.body.querySelector('.uie-diary-subject');
        if (!body || !cur()) return;
        const html = safeHtml(body.innerHTML, { rich: true }).slice(0, 60000);
        const e = cur();
        if (e.html !== html || e.title !== subj.value) mutate(s => { const en = s.diary.entries[view.i]; en.html = html; en.title = String(subj.value).slice(0, 120); }, 'diary');
    }
    function addPhoto(src) {
        flush();
        mutate(s => {
            const en = s.diary.entries[view.i];
            en.photos = [...(en.photos || []), { src, r: Math.round((Math.random() * 14 - 7) * 10) / 10 }].slice(-6);
        }, 'diary');
        render();
    }
    return sheet;
}

function choiceStickers() {
    return new Promise((resolve) => {
        const sh = openSheet({ id: 'stickers', title: 'Stickers', icon: 'fa-face-smile', size: 'half', theme: 'parchment', onClose: () => resolve(null) });
        sh.body.innerHTML = `<div class="uie-pad"><div class="uie-sticker-pick">${STICKERS.map(s => `<button data-st="${esc(s)}" aria-label="${esc(s)}">${esc(s)}</button>`).join('')}</div></div>`;
        sh.body.addEventListener('click', (e) => {
            const b = e.target.closest('[data-st]');
            if (!b) return;
            const v = b.dataset.st;
            resolve(v);
            sh.close();
        });
    });
}
