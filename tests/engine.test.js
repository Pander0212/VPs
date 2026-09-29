import test from 'node:test';
import assert from 'node:assert/strict';

import { toParts, formatDate, formatTime, dateToMinutes, parseHHMM, realtimeAdvance, humanDuration, daysInMonth } from '../src/engine/time.js';
import { standingLabel, decayTrackers, guessCategory, relationshipLabel, xpForLevel } from '../src/engine/rules.js';
import { nameScore, findByName, normalizeName, mergeNames, levenshtein } from '../src/engine/dedupe.js';
import { travelCost, ancestors, findNode, placeNode, pathsFrom } from '../src/engine/map.js';
import { activeBlock, npcWhereabouts, parseScheduleText, scheduleToText } from '../src/engine/schedules.js';
import { Tx, undoPatches } from '../src/engine/tx.js';
import { defaultCampaign, migrate, migrateSettings, SCHEMA_VERSION } from '../src/engine/schema.js';
import { validateOp, validateOps, applyOps, AI_OPS, USER_OPS } from '../src/engine/ops.js';
import { reconcile, record, fingerprint, rollbackEntry, stripTags } from '../src/engine/ledger.js';
import { createBattle, act, runEnemies, currentActor, rewards, summary } from '../src/engine/battle.js';

// ---------------------------------------------------------------- time
test('time: parts, formatting, epoch math', () => {
    const epoch = { y: 2026, m: 7, d: 1 };
    const p = toParts(8 * 60 + 5, epoch);
    assert.deepEqual([p.y, p.m, p.d, p.hh, p.mm], [2026, 7, 1, 8, 5]);
    assert.equal(p.dow, 3); // 1 July 2026 is a Wednesday
    assert.equal(formatTime(p), '08:05');
    assert.equal(formatTime({ hh: 13, mm: 7 }, false), '1:07 PM');
    assert.equal(formatDate(p, 'iso'), '2026-07-01');
    assert.equal(formatDate(p, 'dmy'), '01.07.2026');
    assert.match(formatDate(p, 'long'), /Wed, 1 July 2026/);
    // Month rollover
    const q = toParts(31 * 1440 + 30, epoch);
    assert.deepEqual([q.m, q.d, q.hh, q.mm], [8, 1, 0, 30]);
    assert.equal(dateToMinutes(2026, 7, 2, epoch), 1440);
    assert.equal(dateToMinutes(2026, 6, 30, epoch), -1440);
    assert.equal(daysInMonth(2028, 2), 29);
});

test('time: parse + durations + realtime', () => {
    assert.equal(parseHHMM('08:30'), 510);
    assert.equal(parseHHMM('24:00'), 1440);
    assert.equal(parseHHMM('8.30'), null);
    assert.equal(parseHHMM('12:75'), null);
    assert.equal(humanDuration(45), '45 min');
    assert.equal(humanDuration(90), '1 h 30 min');
    assert.equal(humanDuration(1500), '1 d 1 h');
    // 20 real minutes per game day -> 1 real minute = 72 game minutes
    assert.equal(realtimeAdvance(60000, 20), 72);
    assert.equal(realtimeAdvance(-5, 20), 0);
});

// ---------------------------------------------------------------- rules
test('standing labels thresholds', () => {
    assert.equal(standingLabel(0), 'Enemy');
    assert.equal(standingLabel(14), 'Enemy');
    assert.equal(standingLabel(15), 'Hostile');
    assert.equal(standingLabel(34), 'Hostile');
    assert.equal(standingLabel(35), 'Neutral');
    assert.equal(standingLabel(64), 'Neutral');
    assert.equal(standingLabel(65), 'Friendly');
    assert.equal(standingLabel(100), 'Friendly');
    assert.equal(standingLabel(-20), 'Enemy');
    assert.equal(standingLabel(500), 'Friendly');
    assert.equal(standingLabel('abc'), 'Enemy');
});

test('tracker decay is proportional and clamped', () => {
    const tr = { hunger: { value: 50, min: 0, max: 100, decayPerHour: 4 }, energy: { value: 2, min: 0, max: 100, decayPerHour: 3 }, fixed: { value: 10, decayPerHour: 0 } };
    const d = decayTrackers(tr, 120);
    assert.equal(d.hunger, 42);
    assert.equal(d.energy, 0);
    assert.equal(d.fixed, undefined);
    assert.deepEqual(decayTrackers(tr, 0), {});
});

test('item category guess + relationship + xp curve', () => {
    assert.equal(guessCategory('Iced Lemon Tea'), 'drink');
    assert.equal(guessCategory('Roast Chicken'), 'food');
    assert.equal(guessCategory('Rusty Sword'), 'weapon');
    assert.equal(guessCategory('Street Jacket'), 'clothing');
    assert.equal(guessCategory('Brass Key'), 'key');
    assert.equal(guessCategory('Strange Pebble'), 'misc');
    assert.equal(relationshipLabel({ affection: 90, trust: 80 }), 'Devoted');
    assert.equal(relationshipLabel({ affection: 5, trust: 5 }), 'Hostile');
    assert.ok(xpForLevel(2) > xpForLevel(1));
});

// ---------------------------------------------------------------- dedupe
test('name dedupe: first-name match, case, diacritics, typos', () => {
    assert.equal(nameScore('Tobias', 'Tobias Moreno'), 0.9);
    assert.equal(nameScore('tobias moreno', 'Tobias Moreno'), 1);
    assert.equal(nameScore('Zoë', 'Zoe'), 1);
    assert.equal(nameScore('José García', 'Jose Garcia'), 1);
    assert.ok(nameScore('Tobais Moreno', 'Tobias Moreno') >= 0.75);
    assert.equal(nameScore('Tobias', 'Bastian'), 0);
    assert.equal(nameScore('Mr. Moreno', 'Tobias Moreno'), 0.9);
    assert.equal(nameScore('Ann', 'Anna Bell'), 0);
    assert.equal(normalizeName('  The  Captain Hook '), 'hook');
    assert.equal(levenshtein('kitten', 'sitting'), 3);
    assert.equal(mergeNames('Tobias', 'Tobias Moreno'), 'Tobias Moreno');
    assert.equal(mergeNames('Tobias Moreno', 'Tobias'), 'Tobias Moreno');
});

test('findByName merges Tobias into Tobias Moreno but refuses ambiguous first names', () => {
    const list = [{ id: 1, name: 'Tobias Moreno' }, { id: 2, name: 'Bastian Rivers' }, { id: 3, name: 'Iris Thorne' }];
    assert.equal(findByName(list, 'Tobias')?.id, 1);
    assert.equal(findByName(list, 'bastian')?.id, 2);
    assert.equal(findByName(list, 'Mira'), null);
    const twins = [{ id: 1, name: 'Alex Moreno' }, { id: 2, name: 'Alex Stone' }];
    assert.equal(findByName(twins, 'Alex'), null);
    assert.equal(findByName(twins, 'Alex Stone')?.id, 2);
    assert.equal(findByName([{ id: 9, name: 'Kat', aliases: ['Katherine Vance'] }], 'Katherine Vance')?.id, 9);
});

// ---------------------------------------------------------------- map / travel
function mapFixture() {
    return {
        location: 'b',
        nodes: {
            w: { id: 'w', name: 'World', tier: 'world', parent: null, x: 50, y: 50 },
            r: { id: 'r', name: 'Region', tier: 'region', parent: 'w', x: 50, y: 50 },
            a: { id: 'a', name: 'Old Horizon Gate', tier: 'local', parent: 'r', x: 20, y: 20, links: ['b'] },
            b: { id: 'b', name: 'Underground Foggy Marsh', tier: 'local', parent: 'r', x: 23, y: 24, kind: 'wilds/forest' },
            c: { id: 'c', name: 'Far Tower', tier: 'local', parent: 'r', x: 90, y: 90 },
            d: { id: 'd', name: 'Tower Basement', tier: 'nearby', parent: 'c', x: 50, y: 50 },
        },
    };
}

test('travel cost is deterministic, scales with distance, weather and mode', () => {
    const m = mapFixture();
    const near = travelCost(m, 'a', 'b');
    const far = travelCost(m, 'a', 'c');
    assert.equal(near.minutes, Math.round(5 * 1.2)); // dist 5 * local scale 1.2
    assert.equal(near.energy, Math.round(near.minutes * 0.4));
    assert.ok(far.minutes > near.minutes);
    assert.ok(travelCost(m, 'a', 'c', 'foot', 'storm').minutes > far.minutes);
    assert.ok(travelCost(m, 'a', 'c', 'vehicle').minutes < far.minutes);
    assert.ok(travelCost(m, 'a', 'd').minutes > far.minutes); // extra last mile into child
    assert.deepEqual(travelCost(m, 'a', 'a'), { minutes: 0, energy: 0, fare: 0, mode: 'foot' });
    assert.deepEqual(travelCost(m, 'a', 'a'), travelCost(m, 'a', 'a'));
    assert.equal(ancestors(m, 'd').map(n => n.id).join(), 'w,r,c,d');
    assert.equal(findNode(m, 'old horizon gate').id, 'a');
    assert.equal(findNode(m, 'Nowhere'), null);
    const pos = placeNode(m, 'r', 'New');
    assert.ok(pos.x >= 10 && pos.x <= 90 && pos.y >= 12 && pos.y <= 88);
    assert.deepEqual(placeNode(m, 'r', 'New'), pos);
    assert.equal(pathsFrom(m, 'a')[0].id, 'b');
});

// ---------------------------------------------------------------- schedules
test('schedules decide NPC whereabouts, including overnight blocks and weekdays', () => {
    const sched = parseScheduleText('08:00-17:00 Bakery: baking bread\n17:00-22:00 [5,6] Tavern: drinking\n22:00-08:00 Home: sleeping');
    assert.equal(sched.length, 3);
    assert.deepEqual(sched[1].days, [5, 6]);
    assert.equal(activeBlock(sched, 9 * 60, 1).loc, 'Bakery');
    assert.equal(activeBlock(sched, 23 * 60, 1).loc, 'Home');
    assert.equal(activeBlock(sched, 3 * 60, 1).loc, 'Home');
    assert.equal(activeBlock(sched, 18 * 60, 5).loc, 'Tavern');
    assert.equal(activeBlock(sched, 18 * 60, 2), null);
    const npc = { location: 'Market', schedule: sched };
    assert.equal(npcWhereabouts(npc, { minuteOfDay: 18 * 60, dow: 2 }).loc, 'Market');
    assert.equal(npcWhereabouts(npc, { minuteOfDay: 10 * 60, dow: 2 }).activity, 'baking bread');
    assert.match(scheduleToText(sched), /17:00-22:00 \[5,6\] Tavern: drinking/);
});

// ---------------------------------------------------------------- tx
test('tx records patches and undo respects conflicts', () => {
    const root = { a: { b: 1 }, list: {} };
    const tx = new Tx(root);
    tx.set(['a', 'b'], 2);
    tx.set(['list', 'x'], { qty: 1 });
    tx.set(['list', 'x', 'qty'], 3);
    tx.add(['a', 'n'], 5, 0, 4);
    assert.equal(root.a.n, 4);
    assert.equal(tx.patches.length, 4);
    // user edits a.b afterwards -> conflict, must not be clobbered
    root.a.b = 99;
    const conflicts = undoPatches(root, tx.patches);
    assert.equal(conflicts, 1);
    assert.equal(root.a.b, 99);
    assert.equal(root.list.x, undefined);
    assert.equal(root.a.n, undefined);
});

// ---------------------------------------------------------------- schema
test('schema defaults + migrations from arrays / garbage', () => {
    const d = defaultCampaign();
    assert.equal(d.v, SCHEMA_VERSION);
    assert.ok(d.map.nodes[d.map.location]);
    const old = { v: 1, time: 600, inventory: [{ name: 'Bread', qty: 2 }], npcs: [{ id: 'n1', name: 'Mira' }], map: { location: 'gone', nodes: {} } };
    const m = migrate(old);
    assert.equal(m.clock.t, 600);
    assert.equal(Object.values(m.inventory)[0].name, 'Bread');
    assert.equal(m.npcs.n1.name, 'Mira');
    assert.ok(m.map.nodes[m.map.location]);
    assert.deepEqual(Object.keys(migrate(null)).sort(), Object.keys(d).sort());
    assert.deepEqual(Object.keys(migrate('garbage')).sort(), Object.keys(d).sort());
    const s = migrateSettings({ hud: { items: { hp: false } } });
    assert.equal(s.hud.items.hp, false);
    assert.equal(s.hud.items.mp, true);
    assert.equal(s.injectBudget, 600);
});

// ---------------------------------------------------------------- ops validation
test('op validation: whitelist, aliases, clamping', () => {
    assert.equal(validateOp({ op: 'eval', code: 'x' })[0], null);
    assert.equal(validateOp({ op: 'item.equip', name: 'Sword' })[0], null); // UI-only for AI
    assert.equal(validateOp({ op: 'item.equip', name: 'Sword' }, USER_OPS)[0].op, 'item.equip');
    assert.equal(validateOp({ op: 'add_item', name: 'Bread' })[0].op, 'item.add');
    assert.equal(validateOp({ op: 'time.advance', minutes: 999999 })[0].minutes, 10080);
    assert.equal(validateOp({ op: 'time.advance', hours: 2 })[0].minutes, 120);
    assert.equal(validateOp({ op: 'time.advance', minutes: -5 })[0], null);
    assert.equal(validateOp({ op: 'tracker.delta', id: 'Hunger', value: -500 })[0].value, -100);
    assert.equal(validateOp({ op: 'item.add', name: 'X'.repeat(500), qty: 10000 })[0].name.length, 60);
    assert.equal(validateOp({ op: 'item.add', name: 'Bread', qty: 10000 })[0].qty, 999);
    assert.equal(validateOp({ op: 'rel.delta', name: 'Mira', affection: 900 })[0].affection, 50);
    assert.equal(validateOp({ op: 'rel.delta', name: 'Mira' })[0], null);
    assert.equal(validateOp({ op: 'org.standing', org: 'Guild', delta: '7' })[0].delta, 7);
    assert.equal(validateOp('string')[0], null);
    const { ops, rejected } = validateOps([{ op: 'time.advance', minutes: 5 }, { op: 'nope' }, null]);
    assert.equal(ops.length, 1);
    assert.equal(rejected.length, 2);
    assert.ok(AI_OPS.has('npc.upsert'));
});

// ---------------------------------------------------------------- ops application
function applyAi(state, raw) {
    const { ops } = validateOps(raw);
    return applyOps(state, ops, { source: 'ai' });
}

test('apply: items stack, remove, use applies effects deterministically', () => {
    const s = defaultCampaign();
    s.trackers.hunger.value = 40;
    applyAi(s, [{ op: 'item.add', name: 'Iced Lemon Tea', qty: 1 }, { op: 'item.add', name: 'iced lemon tea', qty: 2 }, { op: 'item.add', name: 'Bread', qty: 1 }]);
    const items = Object.values(s.inventory);
    assert.equal(items.length, 2);
    assert.equal(items.find(i => i.name === 'Iced Lemon Tea').qty, 3);
    const r = applyAi(s, [{ op: 'item.use', name: 'Bread' }]);
    assert.equal(s.trackers.hunger.value, 65);
    assert.ok(r.changes.some(c => c.startsWith('Hunger +25')));
    assert.equal(Object.values(s.inventory).some(i => i.name === 'Bread'), false);
    const r2 = applyAi(s, [{ op: 'item.remove', name: 'Ghost Item' }]);
    assert.equal(r2.skipped.length, 1);
});

test('apply: time advance decays trackers and expires statuses', () => {
    const s = defaultCampaign();
    s.trackers.hunger.value = 50;
    applyAi(s, [{ op: 'status.add', name: 'Soaked', minutes: 30 }]);
    assert.equal(Object.keys(s.statuses).length, 1);
    const r = applyAi(s, [{ op: 'time.advance', minutes: 60 }]);
    assert.equal(s.clock.t, 8 * 60 + 60);
    assert.equal(s.trackers.hunger.value, 46);
    assert.equal(Object.keys(s.statuses).length, 0);
    assert.ok(r.changes.includes('1 h passed'));
});

test('apply: npc upsert merges Tobias into Tobias Moreno; locked NPCs are untouchable', () => {
    const s = defaultCampaign();
    applyAi(s, [{ op: 'npc.upsert', name: 'Tobias', role: 'Bassist' }]);
    applyAi(s, [{ op: 'npc.upsert', name: 'Tobias Moreno', location: 'Studio' }]);
    const npcs = Object.values(s.npcs);
    assert.equal(npcs.length, 1);
    assert.equal(npcs[0].name, 'Tobias Moreno');
    assert.deepEqual(npcs[0].aliases, ['Tobias']);
    assert.equal(npcs[0].role, 'Bassist');
    npcs[0].locked = true;
    const r = applyAi(s, [{ op: 'npc.upsert', name: 'Tobias', role: 'Villain' }, { op: 'rel.delta', name: 'Tobias', trust: -40 }]);
    assert.equal(npcs[0].role, 'Bassist');
    assert.equal(r.skipped.length, 2);
    // user source may edit locked
    applyOps(s, validateOps([{ op: 'npc.upsert', name: 'Tobias', role: 'Singer' }]).ops, { source: 'user' });
    assert.equal(npcs[0].role, 'Singer');
});

test('apply: orgs standing clamp + location move computes travel deterministically', () => {
    const s = defaultCampaign();
    applyAi(s, [{ op: 'org.standing', org: 'Night Guild', delta: 50 }, { op: 'org.standing', org: 'night guild', delta: 50 }]);
    const org = Object.values(s.orgs)[0];
    assert.equal(Object.keys(s.orgs).length, 1);
    assert.equal(org.standing, 100);
    const t0 = s.clock.t, e0 = s.trackers.energy.value;
    applyAi(s, [{ op: 'location.move', to: 'Old Horizon Gate', kind: 'gate' }]);
    const here = s.map.nodes[s.map.location];
    assert.equal(here.name, 'Old Horizon Gate');
    assert.equal(here.pin, 'station');
    assert.ok(s.clock.t > t0);
    assert.ok(s.trackers.energy.value < e0);
    // When the op list already advances time, travel does not double-count.
    const t1 = s.clock.t;
    applyAi(s, [{ op: 'time.advance', minutes: 5 }, { op: 'location.move', to: 'Starting Point' }]);
    assert.equal(s.clock.t - t1, 5);
});

test('apply: xp levels up; quests; databank; events; battle.start', () => {
    const s = defaultCampaign();
    applyAi(s, [{ op: 'bar.delta', id: 'xp', value: 250 }]);
    assert.ok(s.player.level >= 2);
    applyAi(s, [{ op: 'quest.add', title: 'Find a singer', objectives: ['Ask at the market'] }]);
    applyAi(s, [{ op: 'quest.update', title: 'find a singer', objective: 'ask at the market', done: true }]);
    const q = Object.values(s.quests)[0];
    assert.equal(Object.values(q.objectives)[0].done, true);
    applyAi(s, [{ op: 'databank.add', title: 'Gate', text: 'Opens at dusk' }, { op: 'event.add', title: 'Concert', inDays: 3 }]);
    assert.equal(Object.values(s.databank)[0].text, 'Opens at dusk');
    assert.equal(Object.values(s.calendar.events)[0].date, '2026-07-04');
    applyAi(s, [{ op: 'battle.start', enemies: [{ name: 'Rat', hp: 5 }] }]);
    assert.equal(s.battle.active, true);
});

// ---------------------------------------------------------------- ledger / rollback
function msg(text, date = 'd1', user = false) { return { mes: text, send_date: date, is_user: user }; }

function runPass(state, chat, idx, raw) {
    const { ops } = validateOps(raw);
    const res = applyOps(state, ops, { source: 'ai' });
    record(state, { key: fingerprint(chat[idx]), idx, ops, patches: res.patches, changes: res.changes });
}

test('ledger: swipe rolls back and swipe-back replays; delete rolls back', () => {
    const s = defaultCampaign();
    const chat = [msg('hi', 'u1', true), msg('You find bread.', 'a1')];
    runPass(s, chat, 1, [{ op: 'item.add', name: 'Bread' }, { op: 'time.advance', minutes: 10 }]);
    assert.equal(Object.keys(s.inventory).length, 1);
    const t1 = s.clock.t;

    // Swipe to a new variant: message 1 text changes
    const swiped = [chat[0], msg('You find a sword.', 'a2')];
    let r = reconcile(s, swiped);
    assert.equal(r.rolledBack.length, 1);
    assert.equal(Object.keys(s.inventory).length, 0);
    assert.equal(s.clock.t, 8 * 60);
    runPass(s, swiped, 1, [{ op: 'item.add', name: 'Sword' }]);
    assert.equal(Object.values(s.inventory)[0].name, 'Sword');

    // Swipe back to the first variant: sword rolled back, bread replayed from stash, no AI call
    r = reconcile(s, chat);
    assert.equal(r.rolledBack.length, 1);
    assert.equal(r.replayed.length, 1);
    assert.deepEqual(Object.values(s.inventory).map(i => i.name), ['Bread']);
    assert.equal(s.clock.t, t1);

    // Delete the AI message
    r = reconcile(s, [chat[0]]);
    assert.equal(r.rolledBack.length, 1);
    assert.equal(Object.keys(s.inventory).length, 0);
    assert.equal(s.log.length, 0);
});

test('ledger: rollback keeps later manual edits (conflict guard) and handles mid-chat deletes', () => {
    const s = defaultCampaign();
    const chat = [msg('a', 'x1'), msg('b', 'x2'), msg('c', 'x3')];
    runPass(s, chat, 0, [{ op: 'currency.delta', amount: 10 }]);
    runPass(s, chat, 1, [{ op: 'item.add', name: 'Rope' }]);
    runPass(s, chat, 2, [{ op: 'item.add', name: 'Lamp' }]);
    // user manually edits rope qty -> conflicts must not remove it
    Object.values(s.inventory).find(i => i.name === 'Rope').qty = 5;
    const r = reconcile(s, [chat[0], chat[2]]); // message 1 deleted from the middle
    assert.equal(r.rolledBack.length, 1);
    assert.equal(r.conflicts, 1);
    assert.equal(Object.values(s.inventory).find(i => i.name === 'Rope').qty, 5);
    assert.equal(s.player.currency, 110);
    assert.equal(s.log.find(e => e.key === fingerprint(chat[2])).idx, 1);
    rollbackEntry(s, s.log[0]);
    assert.equal(s.player.currency, 100);
});

test('ledger: fingerprints ignore <uie> tags, differ per swipe', () => {
    assert.equal(fingerprint(msg('Hello <uie>{"ops":[]}</uie>')), fingerprint(msg('Hello')));
    assert.notEqual(fingerprint(msg('Hello', 'a')), fingerprint(msg('Hello', 'b')));
    assert.equal(stripTags('x <uie>{}</uie> y'), 'x  y');
});

// ---------------------------------------------------------------- battle
test('battle is deterministic and ends', () => {
    const setup = { party: [{ id: 'player', name: 'Hero', hp: 60, atk: 12, def: 4, spd: 8 }], enemies: [{ name: 'Rat', hp: 20, atk: 5, def: 1, spd: 3 }], seed: 's1' };
    const play = () => {
        let b = createBattle(setup);
        let guard = 0;
        while (b.active && guard++ < 100) {
            b = runEnemies(b);
            if (!b.active) break;
            b = act(b, { skill: 'attack' });
        }
        return b;
    };
    const b1 = play(), b2 = play();
    assert.deepEqual(b1.log, b2.log);
    assert.equal(b1.result, 'victory');
    assert.ok(rewards(b1).xp > 0);
    assert.match(summary(b1), /won the fight against Rat/);
    const b = createBattle(setup);
    const a = currentActor(b);
    assert.ok(a);
    const after = act(b, { skill: 'defend' });
    assert.notEqual(after, b); // pure
    assert.equal(b.log.length, 1);
});

test('battle: skills cost resources, statuses tick', () => {
    let b = createBattle({ party: [{ id: 'p', name: 'Mage', hp: 50, mp: 5, ap: 0, spd: 99, mag: 20 }], enemies: [{ name: 'Slime', hp: 200, spd: 0 }], seed: 'x' });
    assert.equal(currentActor(b).id, 'p');
    b = act(b, { skill: 'spell' });
    assert.equal(b.combatants.p.mp, 0);
    b = runEnemies(b);
    b = act(b, { skill: 'power' }); // not enough AP -> attack
    assert.ok(b.log.some(l => l.includes('lacks the AP')));
});
