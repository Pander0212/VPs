// DOM helpers. All dynamic text goes through esc(); AI-generated rich text goes through safeHtml().

export function esc(v) {
    return String(v ?? '').replace(/[&<>"'`]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;', '`': '&#96;' }[c]));
}

/** Sanitize HTML with ST's global DOMPurify. Falls back to escaping if unavailable. */
export function safeHtml(html, { rich = false } = {}) {
    const P = globalThis.DOMPurify;
    if (!P?.sanitize) return esc(html);
    const cfg = rich
        ? { ALLOWED_TAGS: ['b', 'i', 'u', 'em', 'strong', 'br', 'p', 'div', 'span', 'font', 'ul', 'ol', 'li', 's', 'strike', 'h3', 'h4', 'blockquote'], ALLOWED_ATTR: ['style', 'color', 'face', 'size'] }
        : { ALLOWED_TAGS: ['b', 'i', 'u', 'em', 'strong', 'br', 'p', 'ul', 'ol', 'li', 'code'], ALLOWED_ATTR: [] };
    return P.sanitize(String(html ?? ''), cfg);
}

/** Plain AI text -> safe HTML paragraphs with **bold** and *italic*. */
export function aiText(txt) {
    const e = esc(txt).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/\*(.+?)\*/g, '<i>$1</i>');
    return safeHtml(e.split(/\n{2,}/).map(p => `<p>${p.replace(/\n/g, '<br>')}</p>`).join(''));
}

export function $one(sel, root = document) { return root.querySelector(sel); }
export function $all(sel, root = document) { return [...root.querySelectorAll(sel)]; }

export function el(html) {
    const t = document.createElement('template');
    t.innerHTML = String(html).trim();
    return t.content.firstElementChild;
}

export const icon = (fa, extra = '') => `<i class="fa-solid ${esc(fa)} ${extra}" aria-hidden="true"></i>`;

export function bar(value, max, color, { label = '', small = false } = {}) {
    const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
    return `<div class="uie-bar${small ? ' sm' : ''}" role="meter" aria-valuenow="${Math.round(value)}" aria-valuemin="0" aria-valuemax="${Math.round(max)}" aria-label="${esc(label)}"><div class="uie-bar-fill" style="width:${pct.toFixed(1)}%;--c:${esc(color)}"></div></div>`;
}

/** Event delegation: calls handlers[action](target, event) for [data-act] clicks inside root. */
export function delegate(root, handlers, events = ['click']) {
    const fn = (ev) => {
        const t = ev.target.closest('[data-act]');
        if (!t || !root.contains(t)) return;
        const act = t.getAttribute('data-act');
        const h = handlers[act];
        if (!h) return;
        if (ev.type === 'click' && t.tagName === 'A') ev.preventDefault();
        try {
            const r = h(t, ev);
            if (r && typeof r.catch === 'function') r.catch(err => reportError(err));
        } catch (err) {
            reportError(err);
        }
    };
    for (const e of events) root.addEventListener(e, fn);
    return () => events.forEach(e => root.removeEventListener(e, fn));
}

export function reportError(err, where = '') {
    console.error('[UIE]', where, err);
    try { globalThis.toastr?.error?.(esc(err?.message || String(err)), 'UIE'); } catch { /* ignore */ }
}

export function debounce(fn, ms = 250) {
    let t;
    return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

/** Read a form into a plain object using [name] attributes. */
export function formData(root) {
    const out = {};
    for (const f of root.querySelectorAll('[name]')) {
        if (f.type === 'checkbox') out[f.name] = f.checked;
        else if (f.type === 'number' || f.type === 'range') out[f.name] = f.value === '' ? '' : Number(f.value);
        else out[f.name] = f.value;
    }
    return out;
}

export function opt(value, label, selected) {
    return `<option value="${esc(value)}"${selected ? ' selected' : ''}>${esc(label)}</option>`;
}

/** Read a File into a compressed JPEG data URL (for diary photos / portraits). */
export function compressImage(fileOrUrl, { maxSide = 640, maxBytes = 200 * 1024 } = {}) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            try {
                let w = img.naturalWidth, h = img.naturalHeight;
                const scale = Math.min(1, maxSide / Math.max(w, h));
                w = Math.max(1, Math.round(w * scale)); h = Math.max(1, Math.round(h * scale));
                const c = document.createElement('canvas');
                c.width = w; c.height = h;
                c.getContext('2d').drawImage(img, 0, 0, w, h);
                let q = 0.82, out = c.toDataURL('image/jpeg', q);
                while (out.length * 0.75 > maxBytes && q > 0.3) { q -= 0.1; out = c.toDataURL('image/jpeg', q); }
                if (out.length * 0.75 > maxBytes) {
                    c.width = Math.round(w * 0.6); c.height = Math.round(h * 0.6);
                    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
                    out = c.toDataURL('image/jpeg', 0.6);
                }
                resolve(out);
            } catch (e) { reject(e); }
            finally { if (typeof fileOrUrl !== 'string') URL.revokeObjectURL(img.src); }
        };
        img.onerror = () => reject(new Error('Could not read image'));
        img.crossOrigin = 'anonymous';
        img.src = typeof fileOrUrl === 'string' ? fileOrUrl : URL.createObjectURL(fileOrUrl);
    });
}

export function pickFile(accept = 'image/*') {
    return new Promise((resolve) => {
        const inp = document.createElement('input');
        inp.type = 'file';
        inp.accept = accept;
        inp.style.display = 'none';
        inp.onchange = () => { resolve(inp.files?.[0] || null); inp.remove(); };
        document.body.appendChild(inp);
        inp.click();
    });
}

export function download(filename, textContent, type = 'application/json') {
    const blob = new Blob([textContent], { type });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

/** Long-press helper (touch + mouse). Never required for any feature. */
export function onLongPress(node, fn, ms = 550) {
    let t = null, sx = 0, sy = 0;
    const start = (e) => {
        const p = e.touches?.[0] || e;
        sx = p.clientX; sy = p.clientY;
        t = setTimeout(() => { t = null; fn(e); }, ms);
    };
    const move = (e) => {
        const p = e.touches?.[0] || e;
        if (t && Math.hypot(p.clientX - sx, p.clientY - sy) > 10) { clearTimeout(t); t = null; }
    };
    const end = () => { if (t) clearTimeout(t); t = null; };
    node.addEventListener('pointerdown', start);
    node.addEventListener('pointermove', move);
    node.addEventListener('pointerup', end);
    node.addEventListener('pointercancel', end);
    node.addEventListener('pointerleave', end);
}
