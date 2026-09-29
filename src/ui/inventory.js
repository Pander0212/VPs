// Inventory: category filter + search, pinned equipped/quick row, lazy item grid,
// item detail sheet with use / equip / drop / give, add & edit items.

import { S, bus, userOps, mutate, settingsGet } from '../state.js';
import { st } from '../st-adapter.js';
import { openSheet, formDialog, promptDialog, choiceDialog, confirmDialog } from './sheet.js';
import { esc, icon, opt, reportError } from './dom.js';
import { ITEM_CATEGORIES, CATEGORY_META, isConsumable, isEquippable, defaultSlot, defaultEffects } from '../engine/rules.js';
import { normalizeName } from '../engine/dedupe.js';
import { itemEmoji, CAT_COLOR } from './itemicons.js';

const PAGE = 60;

function card(item, equippedIds) {
    const eq = equippedIds.has(item.id);
    const tags = [CATEGORY_META[item.cat]?.label || item.cat, ...(item.tags || [])].slice(0, 3).join(' · ');
    const effects = Object.keys(item.effects || {}).length;
    return `<button class="uie-icard ${eq ? 'equipped' : ''}" data-item="${esc(item.id)}" style="--cat:${CAT_COLOR[item.cat] || '#d6b468'}" aria-label="${esc(item.name)}, quantity ${esc(item.qty)}">
        <div class="uie-icard-art">${item.img ? `<img src="${esc(item.img)}" alt="" loading="lazy" style="max-height:70px;border-radius:8px">` : `<span>${esc(itemEmoji(item))}</span>`}</div>
        ${item.qty > 1 || item.qty === 0 ? `<span class="uie-qty">${esc(item.qty)}</span>` : ''}
        ${eq ? '<span class="uie-eq-badge">E</span>' : ''}
        <div class="uie-icard-body"><div class="uie-icard-name">${esc(item.name)}</div><div class="uie-icard-tags">${esc(tags)}${effects ? ` · ${effects} effect${effects > 1 ? 's' : ''}` : ''}</div></div>
    </button>`;
}

export function open(params = {}) {
    const sheet = openSheet({
        id: 'inventory', title: 'Inventory', icon: 'fa-bag-shopping',
        actions: `<button class="uie-icon-btn" data-inv="add" aria-label="Add item">${icon('fa-plus')}</button>`,
    });
    const view = { cat: params.cat || 'all', q: '', limit: PAGE };

    const render = () => {
        const s = S();
        const items = Object.values(s.inventory);
        const equippedIds = new Set(Object.values(s.equipment));
        const q = normalizeName(view.q);
        const filtered = items
            .filter(i => view.cat === 'all' || i.cat === view.cat)
            .filter(i => !q || normalizeName(`${i.name} ${(i.tags || []).join(' ')} ${i.desc}`).includes(q))
            .sort((a, b) => ITEM_CATEGORIES.indexOf(a.cat) - ITEM_CATEGORIES.indexOf(b.cat) || a.name.localeCompare(b.name));
        const quick = items.filter(i => equippedIds.has(i.id) || i.pinned);
        const counts = {};
        items.forEach(i => { counts[i.cat] = (counts[i.cat] || 0) + 1; });

        let gridHtml = '';
        const shown = filtered.slice(0, view.limit);
        if (!items.length) {
            gridHtml = `<div class="uie-empty">${icon('fa-box-open')}Your bag is empty.<br><small>Items appear here automatically as the story gives them to you, or tap + to add one.</small></div>`;
        } else if (!filtered.length) {
            gridHtml = `<div class="uie-empty">${icon('fa-magnifying-glass')}No items match.</div>`;
        } else if (view.cat === 'all' && !q) {
            for (const cat of ITEM_CATEGORIES) {
                const list = shown.filter(i => i.cat === cat);
                if (!list.length) continue;
                gridHtml += `<div class="uie-section-h">${esc(CATEGORY_META[cat].icon)} ${esc(CATEGORY_META[cat].label)} (${counts[cat] || 0})</div><div class="uie-inv-grid">${list.map(i => card(i, equippedIds)).join('')}</div>`;
            }
        } else {
            gridHtml = `<div class="uie-inv-grid" style="padding-top:12px">${shown.map(i => card(i, equippedIds)).join('')}</div>`;
        }
        if (filtered.length > view.limit) gridHtml += `<div class="uie-center" style="padding:12px"><button class="uie-btn" data-inv="more">Show ${Math.min(PAGE, filtered.length - view.limit)} more</button></div>`;

        const slots = Object.entries(s.equipment).map(([slot, id]) => s.inventory[id] ? `<div class="uie-slot"><b>${esc(slot)}</b>${esc(itemEmoji(s.inventory[id]))} ${esc(s.inventory[id].name)}</div>` : '').join('');

        sheet.body.innerHTML = `
            <div class="uie-toolbar">
                <select data-inv-cat aria-label="Category">${opt('all', `All (${items.length})`, view.cat === 'all')}${ITEM_CATEGORIES.map(c => opt(c, `${CATEGORY_META[c].label} (${counts[c] || 0})`, view.cat === c)).join('')}</select>
                <input type="search" class="uie-search" data-inv-q placeholder="Search items…" value="${esc(view.q)}" aria-label="Search items">
                <span class="uie-inv-money" title="${esc(s.player.currencyName)}">${esc(s.player.currencySymbol || '🪙')} ${esc(s.player.currency)}</span>
            </div>
            ${quick.length ? `<div class="uie-section-h">${icon('fa-thumbtack')} Equipped &amp; quick</div><div class="uie-quick">${quick.map(i => `<div class="uie-quick-slot">${card(i, equippedIds)}</div>`).join('')}</div>` : ''}
            ${slots ? `<details class="uie-details" style="padding:0 12px"><summary>${icon('fa-shirt')}&nbsp; Equipment slots</summary><div class="uie-equip-slots">${slots}</div></details>` : ''}
            <div class="uie-inv-list">${gridHtml}</div>
            <div class="uie-fab"><button class="uie-btn uie-btn-primary" data-inv="add">${icon('fa-plus')} Add item</button></div>`;
    };

    render();
    const off = bus.on(() => { if (!sheet.el.isConnected) return; const a = document.activeElement; const typing = a?.matches?.('[data-inv-q]'); if (!typing) render(); });
    sheet.onCleanup(off);

    sheet.el.addEventListener('click', async (e) => {
        try {
            const it = e.target.closest('[data-item]');
            if (it) { openItem(it.dataset.item); return; }
            const a = e.target.closest('[data-inv]')?.dataset.inv;
            if (a === 'add') await addItem();
            if (a === 'more') { view.limit += PAGE; render(); }
        } catch (err) { reportError(err); }
    });
    sheet.body.addEventListener('change', (e) => {
        if (e.target.matches('[data-inv-cat]')) { view.cat = e.target.value; view.limit = PAGE; render(); }
    });
    let t;
    sheet.body.addEventListener('input', (e) => {
        if (!e.target.matches('[data-inv-q]')) return;
        clearTimeout(t);
        t = setTimeout(() => {
            view.q = e.target.value;
            view.limit = PAGE;
            const pos = e.target.selectionStart;
            render();
            const inp = sheet.body.querySelector('[data-inv-q]');
            inp?.focus();
            try { inp?.setSelectionRange(pos, pos); } catch { /* ignore */ }
        }, 200);
    });
    return sheet;
}

function effectsText(effects) {
    return Object.entries(effects || {}).map(([k, v]) => `${k}:${v > 0 ? '+' : ''}${v}`).join(', ');
}

function parseEffects(txt) {
    const out = {};
    for (const part of String(txt || '').split(/[,;\n]+/)) {
        const m = /^\s*([a-z_ ]+?)\s*[:=]\s*([+-]?\d+)\s*$/i.exec(part);
        if (m) out[m[1].trim().toLowerCase()] = Math.max(-100, Math.min(100, Number(m[2])));
    }
    return out;
}

function itemForm(item = {}) {
    return `
        <label class="uie-field"><span>Name</span><input name="name" value="${esc(item.name || '')}" maxlength="60" required></label>
        <div class="uie-grid2">
            <label class="uie-field"><span>Category</span><select name="cat">${ITEM_CATEGORIES.map(c => opt(c, CATEGORY_META[c].label, (item.cat || 'misc') === c)).join('')}</select></label>
            <label class="uie-field"><span>Quantity</span><input name="qty" type="number" min="0" max="9999" value="${esc(item.qty ?? 1)}"></label>
        </div>
        <label class="uie-field"><span>Icon (emoji, optional)</span><input name="icon" value="${esc(item.icon || '')}" maxlength="4" class="uie-w-emoji"></label>
        <label class="uie-field"><span>Description</span><textarea name="desc" rows="3">${esc(item.desc || '')}</textarea></label>
        <label class="uie-field"><span>Effects when used</span><input name="effects" value="${esc(effectsText(item.effects))}" placeholder="hunger:+20, energy:+5, hp:+10"><small>Trackers or bars: ${esc([...Object.keys(S().trackers), ...Object.keys(S().player.bars)].join(', '))}</small></label>
        <label class="uie-field"><span>Tags (comma separated)</span><input name="tags" value="${esc((item.tags || []).join(', '))}"></label>`;
}

async function addItem() {
    const v = await formDialog('Add item', itemForm({}), { okLabel: 'Add' });
    if (!v || !String(v.name).trim()) return;
    const effects = parseEffects(v.effects);
    userOps([{ op: 'item.add', name: v.name, qty: Number(v.qty) || 1, cat: v.cat, desc: v.desc, icon: v.icon, effects: Object.keys(effects).length ? effects : defaultEffects(v.cat, v.name), tags: String(v.tags || '').split(',').map(x => x.trim()).filter(Boolean) }]);
}

function openItem(id) {
    const sheet = openSheet({ id: `item-${id}`, title: 'Item', icon: 'fa-box', size: 'half' });
    const render = () => {
        const s = S();
        const item = s.inventory[id];
        if (!item) { sheet.close(); return; }
        const eq = Object.values(s.equipment).includes(id);
        const eff = Object.keys(item.effects || {}).length ? item.effects : defaultEffects(item.cat, item.name);
        sheet.setTitle(item.name);
        sheet.body.innerHTML = `<div class="uie-pad">
            <div class="uie-idetail-art" style="--cat:${CAT_COLOR[item.cat]}">${item.img ? `<img src="${esc(item.img)}" alt="">` : esc(itemEmoji(item))}</div>
            <div class="uie-row uie-wrap"><span class="uie-tag">${esc(CATEGORY_META[item.cat]?.label || item.cat)}</span><span class="uie-tag">×${esc(item.qty)}</span>${eq ? `<span class="uie-tag good">Equipped · ${esc(defaultSlot(item))}</span>` : ''}${(item.tags || []).map(t => `<span class="uie-tag">${esc(t)}</span>`).join('')}</div>
            <p style="line-height:1.5">${esc(item.desc || 'No description yet.')}</p>
            ${Object.keys(eff).length ? `<div class="uie-effects">${Object.entries(eff).map(([k, v]) => `<span class="uie-tag ${v >= 0 ? 'good' : 'bad'}">${esc(k)} ${v > 0 ? '+' : ''}${esc(v)}</span>`).join('')}</div>` : ''}
            <div class="uie-actions-grid">
                ${isConsumable(item) || Object.keys(eff).length ? `<button class="uie-btn uie-btn-primary" data-ia="use">${icon('fa-hand-sparkles')} Use</button>` : ''}
                ${isEquippable(item) ? `<button class="uie-btn" data-ia="equip">${icon('fa-shirt')} ${eq ? 'Unequip' : 'Equip'}</button>` : ''}
                <button class="uie-btn" data-ia="pin">${icon('fa-thumbtack')} ${item.pinned ? 'Unpin' : 'Pin to quick'}</button>
                <button class="uie-btn" data-ia="give">${icon('fa-hand-holding-heart')} Give</button>
                <button class="uie-btn" data-ia="drop">${icon('fa-trash-can')} Drop</button>
                <button class="uie-btn" data-ia="edit">${icon('fa-pen')} Edit</button>
                ${st.sdAvailable() ? `<button class="uie-btn" data-ia="img">${icon('fa-image')} Item icon</button>` : ''}
            </div>
        </div>`;
    };
    render();
    sheet.onCleanup(bus.on(() => render()));
    sheet.body.addEventListener('click', async (e) => {
        const a = e.target.closest('[data-ia]')?.dataset.ia;
        if (!a) return;
        const item = S().inventory[id];
        if (!item) return;
        try {
            switch (a) {
                case 'use': userOps([{ op: 'item.use', name: item.name, id }]); break;
                case 'equip': userOps([{ op: 'item.equip', name: item.name, id, on: !Object.values(S().equipment).includes(id) }]); break;
                case 'pin': mutate(s => { s.inventory[id].pinned = !s.inventory[id].pinned; }); break;
                case 'drop': {
                    let qty = 1;
                    if (item.qty > 1) {
                        const v = await promptDialog(`Drop ${item.name}`, { label: `How many? (1-${item.qty})`, value: '1' });
                        if (v === null) return;
                        qty = Math.max(1, Math.min(item.qty, Number(v) || 1));
                    } else if (!await confirmDialog('Drop item', `Drop ${item.name}?`, { okLabel: 'Drop', danger: true })) return;
                    userOps([{ op: 'item.drop', name: item.name, id, qty }]);
                    break;
                }
                case 'give': {
                    const npcs = Object.values(S().npcs);
                    const to = npcs.length
                        ? await choiceDialog(`Give ${item.name} to…`, npcs.slice(0, 30).map(n => ({ label: n.name, value: n.name, icon: 'fa-user' })))
                        : await promptDialog(`Give ${item.name} to…`, { label: 'Name' });
                    if (!to) return;
                    userOps([{ op: 'item.give', name: item.name, id, qty: 1, to }]);
                    if (settingsGet().narratorNotes) st.narrate(`*${st.userName()} gives ${item.name} to ${to}.*`);
                    break;
                }
                case 'edit': {
                    const v = await formDialog(`Edit ${item.name}`, itemForm(item));
                    if (!v) return;
                    mutate(s => {
                        const it = s.inventory[id];
                        Object.assign(it, { name: String(v.name).slice(0, 60) || it.name, cat: v.cat, qty: Math.max(0, Number(v.qty) || 0), icon: v.icon, desc: v.desc, effects: parseEffects(v.effects), tags: String(v.tags || '').split(',').map(x => x.trim()).filter(Boolean) });
                    });
                    break;
                }
                case 'img': {
                    globalThis.toastr?.info?.('Generating item icon…', 'UIE');
                    const url = await st.generateImage(`game item icon, ${item.name}, ${item.desc || item.cat}, centered, simple background`);
                    if (url) mutate(s => { if (s.inventory[id]) s.inventory[id].img = url; });
                    break;
                }
            }
        } catch (err) { reportError(err); }
    });
}
