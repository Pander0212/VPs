// End-to-end test against a real SillyTavern server with the extension installed.
// Generation is mocked inside the page (no LLM key needed): UIE.st.generateRaw is replaced
// with a queue of canned answers (valid JSON, messy JSON, garbage, errors, timeouts).
//
// Usage:
//   ST_URL=http://127.0.0.1:8000/ PW_DIR=/path/with/node_modules/playwright node tests/e2e/run.mjs
// Env: VIEWPORTS=iphone,android,landscape,desktop  OUT=tests/e2e/out  QUICK=1 (skip slow timeout test)

import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';

const require = createRequire(process.env.PW_DIR ? path.join(process.env.PW_DIR, 'package.json') : import.meta.url);
const { chromium } = require('playwright');

const BASE = process.env.ST_URL || 'http://127.0.0.1:8000/';
const OUT = process.env.OUT || path.join(path.dirname(new URL(import.meta.url).pathname), 'out');
fs.mkdirSync(OUT, { recursive: true });

const VIEWPORTS = {
    iphone: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' },
    android: { viewport: { width: 360, height: 800 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36' },
    landscape: { viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
    desktop: { viewport: { width: 1280, height: 800 } },
};

// Console noise that is not ours (e.g. ST probing an API that is not configured in the test).
const IGNORE = [/Failed to load resource/i, /favicon/i, /net::ERR_/i, /status of 40[134]/i];

const results = [];
let current = null;
function check(name, ok, detail = '') {
    const r = { viewport: current, name, ok: !!ok, detail: String(detail || '') };
    results.push(r);
    console.log(`${ok ? '  ✓' : '  ✗'} [${current}] ${name}${detail && !ok ? ` — ${detail}` : ''}`);
    return ok;
}

async function shot(page, name) {
    await page.waitForTimeout(260); // sheet open animation
    await page.screenshot({ path: path.join(OUT, `${current}-${name}.png`) });
}

async function boot(page) {
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    try {
        await page.locator('.popup .onboarding').first().waitFor({ timeout: 6000 });
        await page.locator('.popup-button-ok').first().click();
    } catch { /* not first run */ }
    await page.waitForFunction(() => !!globalThis.UIE, null, { timeout: 60000 });
    // A previous run may have left UIE disabled in the saved settings.
    await page.evaluate(() => { if (!UIE.state.settingsGet().enabled) UIE.setEnabled(true); });
    await page.waitForSelector('#uie-launcher', { timeout: 20000 });
}

async function installMocks(page) {
    await page.evaluate(() => {
        window.__uieMock = [];
        window.__uiePrompts = [];
        const fake = async (prompt) => {
            window.__uiePrompts.push(String(prompt));
            const r = window.__uieMock.shift();
            if (r === '__TIMEOUT__') return new Promise(() => {});
            if (r === '__ERROR__') throw new Error('mock backend failure');
            return r ?? '{"ops":[]}';
        };
        UIE.st.generateRaw = fake;
        UIE.st.generateQuiet = fake;
    });
}

const mock = (page, ...answers) => page.evaluate((a) => { window.__uieMock.push(...a); }, answers);

async function openChat(page) {
    await page.evaluate(async () => {
        const c = SillyTavern.getContext();
        if (c.characterId === undefined || c.characterId === null) await c.selectCharacterById(0);
    });
    await page.waitForFunction(() => !!SillyTavern.getContext().getCurrentChatId() && SillyTavern.getContext().chat.length > 0, null, { timeout: 30000 });
    await page.waitForTimeout(500);
}

async function freshChat(page) {
    await page.evaluate(async () => { await SillyTavern.getContext().executeSlashCommandsWithOptions('/newchat'); });
    await page.waitForFunction(() => SillyTavern.getContext().chat.length === 1, null, { timeout: 20000 });
    await page.waitForTimeout(600);
}

function addAi(page, text) {
    return page.evaluate(async (t) => {
        const c = SillyTavern.getContext();
        const date = `${new Date().toISOString()}#${Math.random().toString(36).slice(2, 7)}`;
        const msg = { name: c.name2, is_user: false, is_system: false, send_date: date, mes: t, extra: {}, swipe_id: 0, swipes: [t], swipe_info: [{ send_date: date, extra: {} }] };
        c.chat.push(msg);
        c.addOneMessage(msg);
        await c.eventSource.emit(c.eventTypes.MESSAGE_RECEIVED, c.chat.length - 1, 'normal');
        return c.chat.length - 1;
    }, text);
}

function addUser(page, text) {
    return page.evaluate(async (t) => {
        const c = SillyTavern.getContext();
        const msg = { name: c.name1, is_user: true, is_system: false, send_date: new Date().toISOString(), mes: t, extra: {} };
        c.chat.push(msg);
        c.addOneMessage(msg);
        await c.eventSource.emit(c.eventTypes.MESSAGE_SENT, c.chat.length - 1);
    }, text);
}

/** New swipe on the last message (like pressing swipe-right and getting a new generation). */
function swipeNew(page, text) {
    return page.evaluate(async (t) => {
        const c = SillyTavern.getContext();
        const idx = c.chat.length - 1;
        const m = c.chat[idx];
        const date = `${new Date().toISOString()}#${Math.random().toString(36).slice(2, 7)}`;
        m.swipes.push(t);
        m.swipe_info.push({ send_date: date, extra: {} });
        m.swipe_id = m.swipes.length - 1;
        m.mes = t; m.send_date = date;
        c.updateMessageBlock(idx, m);
        await c.eventSource.emit(c.eventTypes.MESSAGE_SWIPED, idx);
        await c.eventSource.emit(c.eventTypes.MESSAGE_RECEIVED, idx, 'swipe');
    }, text);
}

function swipeTo(page, sid) {
    return page.evaluate(async (i) => {
        const c = SillyTavern.getContext();
        const idx = c.chat.length - 1;
        const m = c.chat[idx];
        m.swipe_id = i; m.mes = m.swipes[i]; m.send_date = m.swipe_info[i].send_date;
        c.updateMessageBlock(idx, m);
        await c.eventSource.emit(c.eventTypes.MESSAGE_SWIPED, idx);
    }, sid);
}

const S = (page, fn) => page.evaluate(`(${fn})(UIE.state.S())`);

async function closeSheets(page) {
    for (let i = 0; i < 6; i++) {
        const n = await page.locator('.uie-dialog').count();
        if (n) { await page.keyboard.press('Escape'); await page.waitForTimeout(200); continue; }
        const s = await page.locator('.uie-sheet:not(.uie-closing)').count();
        if (!s) break;
        const btn = page.locator('.uie-sheet:not(.uie-closing)').last().locator('.uie-sheet-head [data-act="close"]:visible').first();
        if (await btn.count()) await btn.click(); else await page.keyboard.press('Escape');
        await page.waitForTimeout(260);
    }
}

async function layoutChecks(page, label) {
    const r = await page.evaluate(() => {
        const out = {};
        out.hscroll = document.documentElement.scrollWidth - window.innerWidth;
        const l = document.querySelector('#uie-launcher')?.getBoundingClientRect();
        const send = (document.querySelector('#send_but:not([style*="display: none"])') || document.querySelector('#send_form'))?.getBoundingClientRect();
        const form = document.querySelector('#send_form')?.getBoundingClientRect();
        out.launcher = l ? { x: l.x, y: l.y, w: l.width, h: l.height } : null;
        out.inViewport = l ? l.x >= 0 && l.y >= 0 && l.right <= window.innerWidth && l.bottom <= window.innerHeight : false;
        out.overlapsForm = l && form ? !(l.bottom <= form.top || l.top >= form.bottom || l.right <= form.left || l.left >= form.right) : false;
        void send;
        const hud = document.querySelector('#uie-hud .uie-hud-row')?.getBoundingClientRect();
        const top = document.querySelector('#top-bar')?.getBoundingClientRect();
        out.hudBelowTopBar = hud && top ? hud.top >= top.bottom - 2 : true;
        out.hudInViewport = hud ? hud.left >= -1 && hud.right <= window.innerWidth + 1 : true;
        return out;
    });
    check(`${label}: no horizontal page scroll`, r.hscroll <= 1, `scrollWidth overflow ${r.hscroll}px`);
    check(`${label}: launcher visible in viewport`, r.inViewport, JSON.stringify(r.launcher));
    check(`${label}: launcher does not cover the send bar`, !r.overlapsForm, JSON.stringify(r.launcher));
    check(`${label}: HUD sits below ST top bar and inside viewport`, r.hudBelowTopBar && r.hudInViewport);
}

async function sheetFits(page, label) {
    await page.waitForTimeout(320); // let the open animation finish
    const r = await page.evaluate(() => {
        const p = [...document.querySelectorAll('.uie-sheet:not(.uie-closing) .uie-sheet-panel')].pop();
        if (!p) return { ok: false, why: 'no sheet' };
        const b = p.getBoundingClientRect();
        const overflowX = [...p.querySelectorAll('*')].filter(e => { const r2 = e.getBoundingClientRect(); return r2.width > 0 && (r2.right > window.innerWidth + 2 || r2.left < -2) && getComputedStyle(e).position !== 'fixed' && !e.closest('.uie-tabs,.uie-map-top,.uie-map-tools,.uie-suggest,.uie-quick,.uie-hud-row,svg,.uie-dossier-nav'); }).slice(0, 3).map(e => `${e.tagName}.${e.className}`);
        return { ok: b.left >= -1 && b.top >= -1 && b.right <= window.innerWidth + 1 && b.bottom <= window.innerHeight + 1 && !overflowX.length, why: JSON.stringify({ b, overflowX }) };
    });
    check(`${label}: sheet fits the screen, no cut-off content`, r.ok, r.why);
}

async function run(vpName) {
    current = vpName;
    console.log(`\n=== ${vpName} ===`);
    const browser = await chromium.launch();
    const ctx = await browser.newContext(VIEWPORTS[vpName]);
    const page = await ctx.newPage();
    const errors = [];
    page.on('console', (m) => { if (m.type() === 'error' && !IGNORE.some(re => re.test(m.text()))) errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    page.on('dialog', (d) => d.dismiss().catch(() => {}));

    try {
        await boot(page);
        await page.waitForTimeout(1200);
        check('boots with zero console errors', errors.length === 0, errors.join(' | '));
        await installMocks(page);
        await openChat(page);
        await freshChat(page);
        await page.evaluate(() => { UIE.state.resetCampaign(); const s = UIE.state.settingsGet(); s.trackerMode = 'pass'; s.hud.expanded = false; });
        await page.waitForTimeout(300);
        check('campaign is bound to the open chat', await page.evaluate(() => !UIE.state.isEphemeral()));
        await shot(page, '01-chat');
        await layoutChecks(page, 'chat view');

        // ---------------------------------------------------------- HUD
        await page.click('#uie-hud .uie-hud-row');
        await page.waitForTimeout(250);
        check('HUD expands on tap', await page.locator('.uie-hud-more').count() === 1);
        await shot(page, '02-hud-expanded');
        await page.click('#uie-hud .uie-hud-row');
        await page.waitForTimeout(200);
        check('HUD collapses on tap', await page.locator('.uie-hud-more').count() === 0);

        // ---------------------------------------------------------- deck: open every tile
        await page.click('#uie-launcher');
        await page.waitForSelector('.uie-deck');
        await shot(page, '03-deck');
        const tiles = await page.$$eval('.uie-deck [data-open]', els => [...new Set(els.map(e => e.dataset.open))]);
        const bad = [];
        for (const id of tiles) {
            if (id === 'newgame' && tiles.indexOf(id) === 0) continue;
            await page.locator(`.uie-deck [data-open="${id}"]`).first().click();
            await page.waitForTimeout(700);
            const sheets = await page.locator('.uie-sheet:not(.uie-closing)').count();
            const toast = await page.locator('#toast-container .toast').count();
            if (sheets < 2 && !toast) bad.push(id);
            if (sheets >= 2) {
                await sheetFits(page, `tile ${id}`);
                await shot(page, `04-tile-${id}`);
            }
            // close everything above the deck
            for (let i = 0; i < 4 && await page.locator('.uie-sheet:not(.uie-closing)').count() > 1; i++) {
                if (await page.locator('.uie-dialog').count()) { await page.keyboard.press('Escape'); await page.waitForTimeout(150); continue; }
                const top = page.locator('.uie-sheet:not(.uie-closing)').last();
                const btn = top.locator('.uie-sheet-head [data-act="close"]:visible').first();
                if (await btn.count()) await btn.click(); else await page.keyboard.press('Escape');
                await page.waitForTimeout(250);
            }
            await page.evaluate(() => document.querySelectorAll('#toast-container .toast').forEach(t => t.remove()));
        }
        check(`every Command Deck tile opens (${tiles.length})`, bad.length === 0, `failed: ${bad.join(', ')}`);
        await closeSheets(page);

        // ---------------------------------------------------------- inventory flow
        await page.evaluate(() => UIE.openPanel('inventory'));
        await page.waitForSelector('[data-sheet="inventory"]');
        await page.locator('[data-sheet="inventory"] .uie-fab [data-inv="add"]').click();
        await page.waitForSelector('.uie-dialog input[name=name]');
        await page.fill('.uie-dialog input[name=name]', 'Iced Lemon Tea');
        await page.selectOption('.uie-dialog select[name=cat]', 'drink');
        await page.fill('.uie-dialog input[name=qty]', '2');
        await shot(page, '05-inv-add-dialog');
        await page.locator('.uie-dialog button[type=submit]').click();
        await page.waitForTimeout(400);
        check('inventory: item added via form', await page.locator('[data-sheet="inventory"] .uie-icard', { hasText: 'Iced Lemon Tea' }).count() >= 1);
        await page.evaluate(() => { UIE.state.S().trackers.hunger.value = 40; });
        await page.locator('[data-sheet="inventory"] .uie-icard', { hasText: 'Iced Lemon Tea' }).first().click();
        await page.waitForSelector('[data-ia="use"]');
        await sheetFits(page, 'item detail');
        await shot(page, '06-item-detail');
        await page.click('[data-ia="use"]');
        await page.waitForTimeout(300);
        const inv1 = await S(page, s => ({ hunger: s.trackers.hunger.value, qty: Object.values(s.inventory).find(i => i.name === 'Iced Lemon Tea')?.qty }));
        check('inventory: using a drink raises hunger deterministically and consumes one', inv1.hunger === 48 && inv1.qty === 1, JSON.stringify(inv1));
        await closeSheets(page);
        await page.evaluate(() => UIE.openPanel('inventory'));
        await page.fill('[data-inv-q]', 'lemon');
        await page.waitForTimeout(450);
        check('inventory: search filters', await page.locator('[data-sheet="inventory"] .uie-icard').count() >= 1);
        await shot(page, '07-inventory');
        await closeSheets(page);

        // ---------------------------------------------------------- tracker pass + rollback
        await addUser(page, 'I buy some bread and head out.');
        await mock(page, '{"ops":[{"op":"item.add","name":"Bread","qty":1,"cat":"food"},{"op":"time.advance","minutes":20},{"op":"npc.upsert","name":"Tobias","role":"Baker"}]}');
        const t0 = await S(page, s => s.clock.t);
        await addAi(page, 'Tobias hands you a warm loaf of bread. Twenty minutes pass as you chat.');
        let st1 = await S(page, s => ({ bread: Object.values(s.inventory).some(i => i.name === 'Bread'), t: s.clock.t, npcs: Object.values(s.npcs).map(n => n.name), log: s.log.length }));
        check('tracker pass applies ops (item, time, npc)', st1.bread && st1.t === t0 + 20 && st1.npcs.includes('Tobias'), JSON.stringify(st1));
        await mock(page, '```json\n{ops:[{op:\'npc.upsert\', name:\'Tobias Moreno\', location:\'Bakery\',},{op:"currency.delta",amount:-3}],}\n```');
        await swipeNew(page, 'Tobias Moreno waves you off. You pay 3 coins.');
        st1 = await S(page, s => ({ bread: Object.values(s.inventory).some(i => i.name === 'Bread'), t: s.clock.t, npcs: Object.values(s.npcs).map(n => n.name), money: s.player.currency }));
        check('swipe rolls back the previous swipe (bread gone, time restored)', !st1.bread && st1.t === t0, JSON.stringify(st1));
        check('messy JSON (fences, single quotes, trailing commas) is repaired', st1.money === 97 && st1.npcs.includes('Tobias Moreno'), JSON.stringify(st1));
        await swipeTo(page, 0);
        st1 = await S(page, s => ({ bread: Object.values(s.inventory).some(i => i.name === 'Bread'), t: s.clock.t, npcs: Object.values(s.npcs).map(n => n.name), money: s.player.currency }));
        check('swipe back restores swipe #0 state from history without an AI call', st1.bread && st1.t === t0 + 20 && st1.money === 100, JSON.stringify(st1));
        await page.evaluate(async () => { await SillyTavern.getContext().deleteLastMessage(); });
        await page.waitForTimeout(200);
        st1 = await S(page, s => ({ bread: Object.values(s.inventory).some(i => i.name === 'Bread'), t: s.clock.t, log: s.log.length }));
        check('deleting the message rolls its changes back', !st1.bread && st1.t === t0 && st1.log === 0, JSON.stringify(st1));

        // dedupe through the pipeline
        await mock(page, '{"ops":[{"op":"npc.upsert","name":"Tobias Moreno","role":"Bassist"}]}');
        await addAi(page, 'Tobias Moreno tunes his bass.');
        await mock(page, '{"ops":[{"op":"npc.upsert","name":"tobias","location":"Studio"}]}');
        await addAi(page, 'Tobias heads to the studio.');
        const npcs = await S(page, s => Object.values(s.npcs).map(n => n.name));
        check('NPC dedupe: "tobias" merges into "Tobias Moreno"', npcs.length === 1 && npcs[0] === 'Tobias Moreno', JSON.stringify(npcs));

        // garbage + backend error do not break anything
        await mock(page, 'I am sorry, I cannot help with that.', 'Still not JSON, sorry!');
        await addAi(page, 'The wind howls.');
        await mock(page, '__ERROR__');
        await addAi(page, 'Nothing happens.');
        check('garbage output and backend errors leave ST running', await page.evaluate(() => typeof SillyTavern.getContext === 'function' && !!document.querySelector('#send_textarea')));

        // inline mode: tag stripped from visible message
        await page.evaluate(() => { UIE.state.settingsGet().trackerMode = 'inline'; });
        await addAi(page, 'You find a rusty key under the mat. <uie>{"ops":[{"op":"item.add","name":"Rusty Key","cat":"key"}]}</uie>');
        const inl = await page.evaluate(() => ({
            dom: [...document.querySelectorAll('#chat .mes_text')].some(e => e.textContent.includes('<uie>') || e.innerHTML.includes('&lt;uie')),
            stored: SillyTavern.getContext().chat.some(m => String(m.mes).includes('<uie>')),
            key: Object.values(UIE.state.S().inventory).some(i => i.name === 'Rusty Key'),
            injected: SillyTavern.getContext().extensionPrompts.uie_inline?.value?.length > 0,
        }));
        check('inline mode: <uie> tag applied and never visible or stored', !inl.dom && !inl.stored && inl.key && inl.injected, JSON.stringify(inl));
        await page.evaluate(() => { UIE.state.settingsGet().trackerMode = 'pass'; });

        // edit: roll back and re-track
        await mock(page, '{"ops":[{"op":"item.add","name":"Lantern","cat":"tool"}]}');
        await addAi(page, 'A lantern sits on the table.');
        await mock(page, '{"ops":[{"op":"item.add","name":"Candle","cat":"tool"}]}');
        await page.evaluate(async () => {
            const c = SillyTavern.getContext();
            const i = c.chat.length - 1;
            c.chat[i].mes = 'A candle sits on the table.';
            c.chat[i].swipes[c.chat[i].swipe_id] = c.chat[i].mes;
            c.updateMessageBlock(i, c.chat[i]);
            await c.eventSource.emit(c.eventTypes.MESSAGE_EDITED, i);
        });
        const ed = await S(page, s => Object.values(s.inventory).map(i => i.name));
        check('editing a message rolls back and re-tracks it', ed.includes('Candle') && !ed.includes('Lantern'), JSON.stringify(ed));

        // injection budget
        const inj = await page.evaluate(() => {
            const v = SillyTavern.getContext().extensionPrompts.uie_state?.value || '';
            return { len: v.length, tokens: Math.ceil(v.length / 3.6), budget: UIE.state.settingsGet().injectBudget, hasTime: v.includes('Time:') };
        });
        check('context injection present and within token budget', inj.hasTime && inj.tokens <= inj.budget + 10, JSON.stringify(inj));

        // ---------------------------------------------------------- map flow
        await page.evaluate(() => UIE.openPanel('map'));
        await page.waitForSelector('[data-sheet="map"] svg .uie-pin');
        await shot(page, '08-map');
        await mock(page, '{"places":[{"name":"Horizon Gate","kind":"gate","desc":"An old stone gate.","customs":"Bow to the guards"},{"name":"Foggy Marsh","kind":"wilds/forest","desc":"Mist everywhere."},{"name":"Night Market","kind":"market","desc":"Stalls and lanterns."}]}');
        await page.click('[data-m="expand"]');
        await page.waitForTimeout(700);
        const pinCount = await page.locator('[data-sheet="map"] svg .uie-pin').count();
        check('map: Ask AI To Expand adds places', pinCount >= 4, `pins=${pinCount}`);
        await page.evaluate(() => document.querySelectorAll('#toast-container .toast').forEach(t => t.remove()));
        const unknown = page.locator('[data-sheet="map"] svg .uie-pin', { hasText: 'Unknown Nearby' }).first();
        const box = await unknown.locator('.uie-pin-head circle').boundingBox();
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
        await page.waitForSelector('.uie-map-side.show');
        await shot(page, '09-map-pin');
        await sheetFits(page, 'map side panel');
        const tBefore = await S(page, s => ({ t: s.clock.t, e: s.trackers.energy.value, loc: s.map.location }));
        await page.click('.uie-map-side [data-m="move"]');
        await page.waitForTimeout(400);
        const tAfter = await S(page, s => ({ t: s.clock.t, e: s.trackers.energy.value, loc: s.map.location, name: s.map.nodes[s.map.location].name, explored: s.map.nodes[s.map.location].explored }));
        check('map: Move To Area advances time, spends energy, updates location', tAfter.t > tBefore.t && tAfter.e < tBefore.e && tAfter.loc !== tBefore.loc && tAfter.explored, JSON.stringify({ tBefore, tAfter }));
        await page.click('[data-m="landmark"]');
        await page.waitForSelector('.uie-dialog input[name=name]');
        await page.fill('.uie-dialog input[name=name]', 'Old Lighthouse');
        await page.selectOption('.uie-dialog select[name=pin]', 'service');
        await page.locator('.uie-dialog button[type=submit]').click();
        await page.waitForTimeout(400);
        check('map: Place a Landmark', await S(page, s => Object.values(s.map.nodes).some(n => n.name === 'Old Lighthouse' && n.pin === 'service')));
        await page.click('[data-sheet="map"] [data-tier="region"]');
        await page.waitForTimeout(300);
        check('map: tier tabs switch', (await page.locator('[data-sheet="map"] .uie-sheet-title').textContent()).includes('Region'));
        await page.selectOption('[data-style]', 'scifi');
        await page.waitForTimeout(300);
        await shot(page, '10-map-scifi');
        await closeSheets(page);

        // ---------------------------------------------------------- organizations
        await page.evaluate(() => UIE.openPanel('orgs'));
        await page.waitForSelector('[data-sheet="orgs"]');
        await page.click('[data-o="new"]');
        await page.waitForSelector('.uie-dialog input[name=v]');
        await page.fill('.uie-dialog input[name=v]', 'Night Market Guild');
        await page.locator('.uie-dialog button[type=submit]').click();
        await page.waitForSelector('[data-orgform] input[name=standing]');
        await page.fill('[data-orgform] input[name=standing]', '10');
        await page.click('[data-o="save"]');
        await page.waitForTimeout(300);
        const org = await S(page, s => Object.values(s.orgs).find(o => o.name === 'Night Market Guild'));
        const label = await page.locator('.uie-kv').first().textContent();
        check('orgs: create + standing label computed in code (10 → Enemy)', org?.standing === 10 && /Enemy/.test(label), JSON.stringify({ standing: org?.standing, label }));
        await sheetFits(page, 'org dossier');
        await shot(page, '11-org-dossier');
        for (const tab of ['members', 'influence', 'rules', 'runins']) {
            await page.click(`[data-dtab="${tab}"]`);
            await page.waitForTimeout(150);
        }
        await shot(page, '12-org-runins');
        await closeSheets(page);

        // ---------------------------------------------------------- NPCs
        await page.evaluate(() => UIE.openPanel('npclist'));
        await page.waitForSelector('[data-sheet="npcs"]');
        await page.click('[data-sheet="npcs"] [data-n="add"]');
        await page.waitForSelector('[data-sheet^="npc-edit"] input[name=name]');
        await page.fill('[data-sheet^="npc-edit"] input[name=name]', 'Iris Thorne');
        await page.fill('[data-sheet^="npc-edit"] input[name=role]', 'Community regular');
        await page.fill('[data-sheet^="npc-edit"] textarea[name=schedule]', '00:00-23:59 Northcrest Woods: Practicing with the band');
        await sheetFits(page, 'npc form');
        await shot(page, '13-npc-form');
        await page.click('[data-sheet^="npc-edit"] [data-f="save"]');
        await page.waitForTimeout(400);
        check('NPC: created from the form', await S(page, s => Object.values(s.npcs).some(n => n.name === 'Iris Thorne' && n.schedule.length === 1)));
        await page.locator('[data-sheet="npcs"] [data-lock]').first().click();
        await page.waitForTimeout(200);
        check('NPC: lock toggles', await S(page, s => Object.values(s.npcs).some(n => n.locked)));
        await shot(page, '14-npc-list');
        await closeSheets(page);

        // ---------------------------------------------------------- calendar
        await page.evaluate(() => UIE.openPanel('calendar'));
        await page.waitForSelector('[data-sheet="calendar"] .uie-cal-grid');
        await page.click('[data-c="add"]');
        await page.waitForSelector('.uie-dialog input[name=title]');
        await page.fill('.uie-dialog input[name=title]', 'Concert');
        await page.locator('.uie-dialog button[type=submit]').click();
        await page.waitForTimeout(300);
        check('calendar: add event', await S(page, s => Object.values(s.calendar.events).some(e => e.title === 'Concert')));
        await shot(page, '15-calendar');
        await page.click('[data-sheet="calendar"] [data-tab="schedules"]');
        await page.waitForTimeout(200);
        check('calendar: schedules tab shows routines', await page.locator('.uie-sched', { hasText: 'Northcrest Woods' }).count() >= 1);
        await shot(page, '16-schedules');
        await closeSheets(page);

        // ---------------------------------------------------------- tier 3 panels if present
        for (const [id, sel] of [['diary', '.uie-diary-body'], ['persona', '[data-sheet="persona"]'], ['battle', '[data-sheet="battle"]'], ['phone', '[data-sheet="phone"]'], ['helper', '[data-sheet="helper"]'], ['newgame', '[data-sheet="newgame"]']]) {
            await page.evaluate((i) => UIE.openPanel(i), id);
            await page.waitForTimeout(600);
            if (await page.locator(sel).count()) {
                await sheetFits(page, id);
                await shot(page, `17-${id}`);
            }
            await closeSheets(page);
        }
        await diaryFlow(page);
        await battleFlow(page);
        await helperFlow(page);
        await tier3Flows(page);

        // ---------------------------------------------------------- chat isolation
        const firstChat = await page.evaluate(() => SillyTavern.getContext().getCurrentChatId());
        const invA = await S(page, s => Object.keys(s.inventory).length);
        await freshChat(page);
        const invB = await S(page, s => ({ n: Object.keys(s.inventory).length, npcs: Object.keys(s.npcs).length }));
        check('switching chats isolates campaign state', invA > 0 && invB.n === 0 && invB.npcs === 0, JSON.stringify({ invA, invB }));
        await page.evaluate(async (id) => { await SillyTavern.getContext().openCharacterChat(id); }, firstChat);
        await page.waitForFunction((id) => SillyTavern.getContext().getCurrentChatId() === id, firstChat, { timeout: 20000 });
        await page.waitForTimeout(800);
        const invA2 = await S(page, s => Object.keys(s.inventory).length);
        check('switching back restores the first chat\'s state', invA2 === invA, JSON.stringify({ invA, invA2 }));

        // ---------------------------------------------------------- export → reset → import
        const exported = await page.evaluate(() => UIE.state.exportCampaign());
        await page.evaluate(() => UIE.state.resetCampaign());
        const afterReset = await S(page, s => Object.keys(s.inventory).length);
        await page.evaluate((j) => UIE.state.importCampaign(j), exported);
        const afterImport = await S(page, s => Object.keys(s.inventory).length);
        check('export → reset → import round-trips the campaign', afterReset === 0 && afterImport === invA, JSON.stringify({ afterReset, afterImport, invA }));
        await page.evaluate(() => UIE.openPanel('settings', { tab: 'backup' }));
        await page.waitForTimeout(400);
        await shot(page, '18-settings-backup');
        await closeSheets(page);

        // ---------------------------------------------------------- no raw tags anywhere in chat
        check('no raw <uie> tags visible in chat', await page.evaluate(() => !document.querySelector('#chat').textContent.includes('<uie>')));

        // ---------------------------------------------------------- master toggle
        await page.evaluate(() => UIE.setEnabled(false));
        await page.waitForTimeout(400);
        const off = await page.evaluate(() => ({
            launcher: !!document.querySelector('#uie-launcher'), hud: !!document.querySelector('#uie-hud'), pet: !!document.querySelector('#uie-pet'),
            inj: SillyTavern.getContext().extensionPrompts.uie_state?.value || '', inl: SillyTavern.getContext().extensionPrompts.uie_inline?.value || '',
        }));
        check('toggle off removes all UI and prompt injections', !off.launcher && !off.hud && !off.pet && !off.inj && !off.inl, JSON.stringify(off));
        const logBefore = await S(page, s => s.log.length);
        await mock(page, '{"ops":[{"op":"item.add","name":"Should Not Appear"}]}');
        await addAi(page, 'While disabled, something happens.');
        check('toggle off disables handlers', await page.evaluate(() => !Object.values(UIE.state.S().inventory).some(i => i.name === 'Should Not Appear')), `log ${logBefore}`);
        await page.fill('#send_textarea', 'ST still works');
        check('ST input still works with UIE off', (await page.inputValue('#send_textarea')) === 'ST still works');
        await shot(page, '19-uie-off');
        await page.fill('#send_textarea', '');
        await page.evaluate(() => UIE.setEnabled(true));
        await page.waitForSelector('#uie-launcher');
        check('toggle on restores UI', true);
        await layoutChecks(page, 'after re-enable');
        await page.evaluate(() => { UIE.state.settingsGet().hud.expanded = false; });
        await page.waitForTimeout(1500); // let ST's debounced settings save flush

        check('no console errors during the whole run', errors.length === 0, errors.slice(0, 5).join(' | '));
    } catch (e) {
        check('run completed without exceptions', false, e.stack || e.message);
        await shot(page, 'zz-failure').catch(() => {});
    } finally {
        await browser.close();
    }
}

async function diaryFlow(page) {
    await page.evaluate(() => UIE.openPanel('diary'));
    await page.waitForTimeout(500);
    if (!await page.locator('.uie-diary-body').count()) return;
    await page.fill('.uie-diary-subject', 'First day');
    await page.click('.uie-diary-body');
    await page.keyboard.type('Dear diary, the market was loud.');
    await page.waitForTimeout(900);
    const d = await S(page, s => s.diary.entries[0]);
    check('diary: typing saves the entry', d?.title === 'First day' && /market was loud/.test(d?.html || ''), JSON.stringify(d));
    await shot(page, '20-diary');
    await closeSheets(page);
}

async function battleFlow(page) {
    const hasBattle = await page.evaluate(() => UIE.openPanel('battle').then(() => !!document.querySelector('[data-sheet="battle"]')));
    if (!hasBattle) return;
    await page.waitForTimeout(300);
    const start = page.locator('[data-b="quick"]');
    if (!await start.count()) { await closeSheets(page); return; }
    await start.click();
    await page.waitForTimeout(300);
    for (let i = 0; i < 40; i++) {
        const active = await S(page, s => !!s.battle?.active);
        if (!active) break;
        const atk = page.locator('[data-sk="attack"]');
        if (await atk.count() && await atk.isEnabled()) await atk.click();
        await page.waitForTimeout(80);
    }
    const res = await S(page, s => s.battle?.result);
    check('battle: deterministic fight runs to a result', ['victory', 'defeat', 'fled'].includes(res), String(res));
    await shot(page, '21-battle');
    await closeSheets(page);
}

async function helperFlow(page) {
    await page.evaluate(() => UIE.openPanel('helper'));
    await page.waitForTimeout(300);
    if (!await page.locator('[data-sheet="helper"] input[name=q]').count()) return;
    const chatLen = await page.evaluate(() => SillyTavern.getContext().chat.length);
    await mock(page, 'Here is a trinket for you! <uie>{"ops":[{"op":"item.add","name":"Lucky Charm","cat":"misc"}]}</uie>');
    await page.fill('[data-sheet="helper"] input[name=q]', 'Create a fitting item');
    await page.click('[data-sheet="helper"] .uie-send');
    await page.waitForSelector('[data-sheet="helper"] [data-apply]');
    const before = await S(page, s => Object.values(s.inventory).some(i => i.name === 'Lucky Charm'));
    await page.click('[data-sheet="helper"] [data-apply]');
    await page.waitForTimeout(200);
    const after = await S(page, s => Object.values(s.inventory).some(i => i.name === 'Lucky Charm'));
    const chatLen2 = await page.evaluate(() => SillyTavern.getContext().chat.length);
    check('helper pet: proposes ops, applies only after confirm, never posts to chat', !before && after && chatLen === chatLen2, JSON.stringify({ before, after, chatLen, chatLen2 }));
    await shot(page, '22-helper');
    await closeSheets(page);
}

async function tier3Flows(page) {
    // Activities
    await page.evaluate(() => UIE.openPanel('activities'));
    await page.waitForSelector('[data-act-id="sleep"]');
    const a0 = await S(page, s => ({ t: s.clock.t, e: s.trackers.energy.value }));
    await page.click('[data-act-id="sleep"]');
    await page.waitForTimeout(300);
    const a1 = await S(page, s => ({ t: s.clock.t, e: s.trackers.energy.value }));
    check('activities: sleep advances 8h and restores energy', a1.t - a0.t === 480 && a1.e > a0.e, JSON.stringify({ a0, a1 }));
    await shot(page, '23-activities');
    await closeSheets(page);

    // Persona lineage
    await page.evaluate(() => UIE.openPanel('persona'));
    await page.waitForSelector('[data-sheet="persona"]');
    await page.click('[data-sheet="persona"] [data-tab="lineage"]');
    const kin0 = await page.locator('.uie-kin', { hasText: 'Marta' }).count();
    await page.click('[data-p="addkin"]');
    await page.waitForSelector('.uie-dialog input[name=name]');
    await page.fill('.uie-dialog input[name=name]', 'Marta');
    await page.selectOption('.uie-dialog select[name=rel]', 'Grandparent');
    await page.locator('.uie-dialog button[type=submit]').click();
    await page.waitForTimeout(300);
    check('persona: lineage member added to the family tree', await page.locator('.uie-kin', { hasText: 'Marta' }).count() === kin0 + 1);
    // clean up (persona data is global, not per chat)
    await page.locator('.uie-kin', { hasText: 'Marta' }).last().locator('[data-rmkin]').click();
    await sheetFits(page, 'persona lineage');
    await shot(page, '24-persona-lineage');
    await closeSheets(page);

    // Social
    await page.evaluate(() => UIE.openPanel('social'));
    await page.waitForTimeout(300);
    check('social: relationship meters render', await page.locator('[data-sheet="social"] .uie-meter').count() >= 3);
    await shot(page, '25-social');
    await closeSheets(page);

    // Phone
    const npcId = await S(page, s => Object.keys(s.npcs)[0]);
    if (npcId) {
        const chatLen = await page.evaluate(() => SillyTavern.getContext().chat.length);
        await page.evaluate((id) => UIE.openPanel('phone', { npc: id }), npcId);
        await page.waitForSelector('[data-sheet="phone"] [name=t]');
        await mock(page, 'hey! yeah I\'m at the studio\nwanna come by?');
        await page.fill('[data-sheet="phone"] [name=t]', 'Where are you?');
        await page.click('[data-sheet="phone"] .uie-send');
        await page.waitForTimeout(500);
        const th = await page.evaluate((id) => UIE.state.S().phone.threads[id]?.length, npcId);
        const chatLen2 = await page.evaluate(() => SillyTavern.getContext().chat.length);
        check('phone: in-character texts stored per NPC, main chat untouched', th === 3 && chatLen === chatLen2, JSON.stringify({ th, chatLen, chatLen2 }));
        await sheetFits(page, 'phone thread');
        await shot(page, '26-phone');
        await closeSheets(page);
    }

    // Party
    await page.evaluate(() => UIE.openPanel('party'));
    await page.waitForSelector('[data-sheet="party"]');
    await shot(page, '27-party');
    await closeSheets(page);

    // Characters
    await page.evaluate(() => UIE.openPanel('characters'));
    await page.waitForSelector('[data-sheet="characters"]');
    if (await page.locator('[data-cform] [name=chatRules]').count()) {
        await page.fill('[data-cform] [name=chatRules]', 'Speaks softly.');
        await page.click('[data-c="save"]');
        await page.waitForTimeout(800);
        const saved = await page.evaluate(() => SillyTavern.getContext().characters[SillyTavern.getContext().characterId]?.data?.extensions?.uie?.chatRules);
        check('characters: UIE fields written to the ST card', saved === 'Speaks softly.', String(saved));
        const inj = await page.evaluate(() => SillyTavern.getContext().extensionPrompts.uie_state?.value || '');
        check('characters: chat rules injected while chatting', inj.includes('Speaks softly.'));
    }
    await shot(page, '28-characters');
    await closeSheets(page);

    // New game (AI fill + start)
    await page.evaluate(() => UIE.openPanel('newgame'));
    await page.waitForSelector('[data-sheet="newgame"]');
    await page.fill('[data-sheet="newgame"] [data-k="name"]', 'Irina');
    await mock(page, '{"cls":"Paladin","startLocation":{"name":"Adventurer\'s Path","kind":"road","desc":"A winding dirt road."},"items":[{"name":"Practice Hoodie","qty":1,"cat":"clothing"}],"quests":[{"title":"Find the band","desc":"They need a singer."}],"npcs":[{"name":"Bastian Rivers","role":"Guitarist"}],"opening":""}');
    await page.click('[data-ng="fill"]');
    await page.waitForTimeout(600);
    await shot(page, '29-newgame');
    await page.click('[data-ng="start"]');
    await page.waitForTimeout(300);
    if (await page.locator('.uie-dialog').count()) await page.locator('.uie-dialog button[type=submit]').click();
    await page.waitForTimeout(500);
    const ng = await S(page, s => ({ name: s.player.name, here: s.map.nodes[s.map.location].name, items: Object.values(s.inventory).map(i => i.name), npcs: Object.values(s.npcs).map(n => n.name), done: s.newGameDone, diary: s.diary.entries.length }));
    check('new game: seeds the campaign (name, location, items, NPCs), keeps diary', ng.name === 'Irina' && ng.here === 'Adventurer\'s Path' && ng.items.includes('Practice Hoodie') && ng.npcs.includes('Bastian Rivers') && ng.done && ng.diary >= 1, JSON.stringify(ng));
    await closeSheets(page);

    // VN stage mode
    await page.evaluate(() => { UIE.state.settingsGet().vnMode = true; UIE.state.saveSettings(); });
    await page.waitForTimeout(400);
    check('VN mode styles the last AI message', await page.locator('#chat .mes.uie-vn-last').count() === 1);
    await shot(page, '30-vn');
    await page.evaluate(() => { UIE.state.settingsGet().vnMode = false; UIE.state.saveSettings(); });
    await page.waitForTimeout(200);
    check('VN mode off cleans up', await page.locator('.uie-vn-last, .uie-vn-next').count() === 0);

    // Atmosphere follows weather
    await page.evaluate(() => UIE.openPanel('atmosphere'));
    await page.click('[data-w="rain"]');
    await page.waitForTimeout(200);
    check('atmosphere: overlay follows the weather', await page.evaluate(() => document.querySelector('#uie-atmo')?.dataset.kind === 'rain'));
    await closeSheets(page);
}

const list = (process.env.VIEWPORTS || 'iphone,android,landscape,desktop').split(',').map(s => s.trim()).filter(Boolean);
for (const vp of list) await run(vp);

const failed = results.filter(r => !r.ok);
const byVp = {};
for (const r of results) { byVp[r.viewport] = byVp[r.viewport] || { pass: 0, fail: 0 }; byVp[r.viewport][r.ok ? 'pass' : 'fail']++; }
fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify({ byVp, results }, null, 1));
console.log('\nSummary:', JSON.stringify(byVp));
if (failed.length) {
    console.log(`\n${failed.length} failing check(s):`);
    for (const f of failed) console.log(` - [${f.viewport}] ${f.name}: ${f.detail.slice(0, 300)}`);
    process.exitCode = 1;
}
