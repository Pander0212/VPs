// Full-screen sheets (phones) / centered panels (desktop), stacked. Plus small modal dialogs.

import { esc, icon, el, delegate, reportError } from './dom.js';

const stack = [];
let layer = null;

export function sheetLayer() {
    if (!layer || !document.body.contains(layer)) {
        layer = el('<div id="uie-sheets" class="uie-scope" aria-live="polite"></div>');
        document.body.appendChild(layer);
        document.addEventListener('keydown', onKey, true);
    }
    return layer;
}

function onKey(e) {
    if (e.key !== 'Escape' || !stack.length) return;
    const top = stack[stack.length - 1];
    if (top?.dismissible === false) return;
    e.stopPropagation();
    top.close();
}

export function topSheet() { return stack[stack.length - 1] || null; }
export function openSheets() { return [...stack]; }

/**
 * Open a sheet.
 * @param {{id:string, title:string, icon?:string, theme?:'glass'|'parchment', size?:'full'|'wide'|'half', actions?:string, onClose?:Function, className?:string}} o
 * @returns {{el: HTMLElement, body: HTMLElement, close: Function, setTitle: Function, id: string}}
 */
export function openSheet(o) {
    const existing = stack.find(s => s.id === o.id);
    if (existing) { existing.bringToFront(); return existing; }
    const root = sheetLayer();
    const theme = o.theme || 'glass';
    const node = el(`
        <section class="uie-sheet uie-theme-${esc(theme)} uie-size-${esc(o.size || 'full')} ${esc(o.className || '')}" role="dialog" aria-modal="true" aria-label="${esc(o.title)}" data-sheet="${esc(o.id)}">
            <div class="uie-sheet-backdrop" data-act="backdrop"></div>
            <div class="uie-sheet-panel">
                <header class="uie-sheet-head">
                    <button class="uie-icon-btn uie-sheet-back" data-act="close" aria-label="Close">${icon(o.size === 'half' ? 'fa-xmark' : 'fa-chevron-left')}</button>
                    <h2 class="uie-sheet-title">${o.icon ? icon(o.icon) : ''}<span>${esc(o.title)}</span></h2>
                    <div class="uie-sheet-actions">${o.actions || ''}</div>
                    <button class="uie-icon-btn uie-sheet-x" data-act="close" aria-label="Close">${icon('fa-xmark')}</button>
                </header>
                <div class="uie-sheet-body"></div>
            </div>
        </section>`);
    root.appendChild(node);
    const body = node.querySelector('.uie-sheet-body');
    const cleanups = [];
    const api = {
        id: o.id, el: node, body, dismissible: o.dismissible !== false,
        close() {
            const i = stack.indexOf(api);
            if (i < 0) return;
            stack.splice(i, 1);
            for (const c of cleanups) { try { c(); } catch { /* ignore */ } }
            try { o.onClose?.(); } catch (e) { reportError(e); }
            node.classList.add('uie-closing');
            setTimeout(() => node.remove(), 160);
            document.documentElement.classList.toggle('uie-sheet-open', stack.length > 0);
        },
        setTitle(t) { node.querySelector('.uie-sheet-title span').textContent = t; },
        setActions(html) { node.querySelector('.uie-sheet-actions').innerHTML = html; },
        onCleanup(fn) { cleanups.push(fn); },
        bringToFront() { root.appendChild(node); const i = stack.indexOf(api); stack.splice(i, 1); stack.push(api); },
    };
    cleanups.push(delegate(node.querySelector('.uie-sheet-head'), { close: () => api.close() }));
    node.querySelector('.uie-sheet-backdrop').addEventListener('click', () => { if (o.size === 'half' || o.size === 'wide') api.close(); });
    stack.push(api);
    document.documentElement.classList.add('uie-sheet-open');
    requestAnimationFrame(() => node.classList.add('uie-open'));
    return api;
}

export function closeAllSheets() {
    for (const s of [...stack].reverse()) s.close();
}

// ---------------------------------------------------------------- dialogs

function dialog({ title, bodyHtml, buttons, theme = 'glass', onMount, onBodyClick }) {
    return new Promise((resolve) => {
        const root = sheetLayer();
        const node = el(`
            <div class="uie-dialog uie-theme-${esc(theme)}" role="alertdialog" aria-modal="true" aria-label="${esc(title)}">
                <div class="uie-dialog-backdrop"></div>
                <form class="uie-dialog-card" novalidate>
                    <h3>${esc(title)}</h3>
                    <div class="uie-dialog-body">${bodyHtml || ''}</div>
                    <div class="uie-dialog-btns">${buttons.map((b, i) => `<button type="${b.submit ? 'submit' : 'button'}" class="uie-btn ${b.cls || ''}" data-i="${i}">${b.icon ? icon(b.icon) : ''} ${esc(b.label)}</button>`).join('')}</div>
                </form>
            </div>`);
        root.appendChild(node);
        const form = node.querySelector('form');
        const finish = (val) => {
            document.removeEventListener('keydown', key, true);
            node.classList.add('uie-closing');
            setTimeout(() => node.remove(), 140);
            resolve(val);
        };
        const key = (e) => { if (e.key === 'Escape') { e.stopPropagation(); finish(buttons.find(b => b.cancel)?.value ?? null); } };
        document.addEventListener('keydown', key, true);
        node.querySelector('.uie-dialog-btns').addEventListener('click', (e) => {
            const b = e.target.closest('button[data-i]');
            if (!b || b.type === 'submit') return;
            const spec = buttons[Number(b.dataset.i)];
            finish(typeof spec.value === 'function' ? spec.value(form) : spec.value);
        });
        if (onBodyClick) node.querySelector('.uie-dialog-body').addEventListener('click', (e) => onBodyClick(e, finish));
        form.addEventListener('submit', (e) => {
            e.preventDefault();
            const spec = buttons.find(b => b.submit);
            finish(typeof spec.value === 'function' ? spec.value(form) : spec.value);
        });
        node.querySelector('.uie-dialog-backdrop').addEventListener('click', () => finish(buttons.find(b => b.cancel)?.value ?? null));
        requestAnimationFrame(() => {
            node.classList.add('uie-open');
            onMount?.(form);
            const first = form.querySelector('input,textarea,select');
            if (first && !matchMedia('(pointer: coarse)').matches) first.focus();
        });
    });
}

export function confirmDialog(title, message, { okLabel = 'Confirm', danger = false } = {}) {
    return dialog({
        title,
        bodyHtml: `<p>${esc(message)}</p>`,
        buttons: [
            { label: 'Cancel', value: false, cancel: true },
            { label: okLabel, value: true, submit: true, cls: danger ? 'uie-btn-danger' : 'uie-btn-primary' },
        ],
    });
}

export function promptDialog(title, { label = '', value = '', placeholder = '', multiline = false, okLabel = 'OK' } = {}) {
    const field = multiline
        ? `<textarea name="v" rows="4" placeholder="${esc(placeholder)}">${esc(value)}</textarea>`
        : `<input name="v" type="text" value="${esc(value)}" placeholder="${esc(placeholder)}" autocomplete="off">`;
    return dialog({
        title,
        bodyHtml: `<label class="uie-field">${label ? `<span>${esc(label)}</span>` : ''}${field}</label>`,
        buttons: [
            { label: 'Cancel', value: null, cancel: true },
            { label: okLabel, submit: true, cls: 'uie-btn-primary', value: (f) => f.querySelector('[name=v]').value },
        ],
    });
}

/** Custom form dialog. `fields` is raw HTML using [name] inputs; resolves with an object or null. */
export function formDialog(title, fieldsHtml, { okLabel = 'Save', theme = 'glass', onMount } = {}) {
    return dialog({
        title, theme, onMount,
        bodyHtml: fieldsHtml,
        buttons: [
            { label: 'Cancel', value: null, cancel: true },
            {
                label: okLabel, submit: true, cls: 'uie-btn-primary', value: (f) => {
                    const out = {};
                    f.querySelectorAll('[name]').forEach(i => { out[i.name] = i.type === 'checkbox' ? i.checked : i.value; });
                    return out;
                },
            },
        ],
    });
}

export function choiceDialog(title, choices, { message = '' } = {}) {
    return dialog({
        title,
        bodyHtml: `${message ? `<p>${esc(message)}</p>` : ''}<div class="uie-choice-list">${choices.map((c, i) => `<button type="button" class="uie-btn uie-choice" data-choice="${i}">${c.icon ? icon(c.icon) : ''}<span>${esc(c.label)}</span>${c.hint ? `<small>${esc(c.hint)}</small>` : ''}</button>`).join('')}</div>`,
        buttons: [{ label: 'Cancel', value: null, cancel: true }],
        onBodyClick(e, finish) {
            const b = e.target.closest('[data-choice]');
            if (b) finish(choices[Number(b.dataset.choice)].value);
        },
    });
}
