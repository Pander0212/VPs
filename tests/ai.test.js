import test from 'node:test';
import assert from 'node:assert/strict';

import { extractJson, extractOps, repairJson, findBalanced } from '../src/ai/json.js';
import { compileContext, compileTrackerState, keywords } from '../src/ai/context.js';
import { fillTemplate, DEFAULT_PROMPTS } from '../src/ai/prompts.js';
import { defaultCampaign } from '../src/engine/schema.js';
import { validateOps, applyOps } from '../src/engine/ops.js';
import { estimateTokens } from '../src/engine/util.js';

test('json: clean, fenced, chatter, single quotes, trailing commas', () => {
    assert.deepEqual(extractJson('{"a":1}'), { a: 1 });
    assert.deepEqual(extractJson('```json\n{"ops":[{"op":"x"}]}\n```'), { ops: [{ op: 'x' }] });
    assert.deepEqual(extractJson('Sure! Here you go:\n{"ops": []}\nHope that helps.'), { ops: [] });
    assert.deepEqual(extractJson('{\'op\': \'item.add\', \'name\': \'Bread\',}'), { op: 'item.add', name: 'Bread' });
    assert.deepEqual(extractJson('{ops: [{op: "time.advance", minutes: +20,},]}'), { ops: [{ op: 'time.advance', minutes: 20 }] });
    assert.deepEqual(extractJson('{"ok": True, "v": None}'), { ok: true, v: null });
    assert.deepEqual(extractJson('“smart”: no'), undefined);
    assert.deepEqual(extractJson('{“a”: “b”}'), { a: 'b' });
    assert.deepEqual(extractJson('{"text": "it\'s fine"}'), { text: 'it\'s fine' });
});

test('json: truncated output and garbage', () => {
    assert.deepEqual(extractJson('{"ops":[{"op":"item.add","name":"Bread"'), { ops: [{ op: 'item.add', name: 'Bread' }] });
    assert.equal(extractJson('I cannot do that.'), undefined);
    assert.equal(extractJson(''), undefined);
    assert.equal(extractJson(null), undefined);
    assert.equal(extractJson('{{{{'), undefined);
    assert.equal(findBalanced('x {"a":"}"} y'), '{"a":"}"}');
    assert.equal(repairJson('{a:1,}'), '{"a":1}');
});

test('extractOps: tags, bare arrays, single op, wrong shapes', () => {
    assert.deepEqual(extractOps('Story text... <uie>{"ops":[{"op":"time.advance","minutes":5}]}</uie>'), [{ op: 'time.advance', minutes: 5 }]);
    assert.deepEqual(extractOps('[{"op":"a"}]'), [{ op: 'a' }]);
    assert.deepEqual(extractOps('{"op":"a"}'), [{ op: 'a' }]);
    assert.deepEqual(extractOps('{"changes":[{"op":"b"}]}'), [{ op: 'b' }]);
    assert.deepEqual(extractOps('{"foo":1}'), []);
    assert.equal(extractOps('nothing here'), undefined);
    // Objects inside prose separated by newlines: } { gets a comma.
    assert.deepEqual(extractOps('{"ops":[{"op":"a"}\n{"op":"b"}]}'), [{ op: 'a' }, { op: 'b' }]);
});

test('messy model output end-to-end through validation', () => {
    const raw = "Okay!\n```\n{ops:[{op:'add_item', name:'Iced Lemon Tea', qty:1}, {op:'time.advance', minutes:'20'}, {op:'tracker.delta', id:'hunger', value:-10}, {op:'rm -rf'}],}\n```";
    const { ops, rejected } = validateOps(extractOps(raw));
    assert.equal(ops.length, 3);
    assert.equal(rejected.length, 1);
    const s = defaultCampaign();
    const r = applyOps(s, ops);
    assert.ok(r.changes.includes('+1 Iced Lemon Tea'));
    assert.ok(r.changes.includes('20 min passed'));
});

test('context: includes key sections and respects the token budget', () => {
    const s = defaultCampaign();
    s.player.name = 'Irina';
    const { ops } = validateOps([
        { op: 'npc.upsert', name: 'Tobias Moreno', role: 'Bassist', present: true },
        { op: 'quest.add', title: 'Find a lead vocalist' },
        { op: 'org.upsert', org: 'Night Market Guild' },
        ...Array.from({ length: 60 }, (_, i) => ({ op: 'databank.add', title: `Fact ${i}`, text: 'x '.repeat(60) })),
    ]);
    applyOps(s, ops);
    const full = compileContext(s, { budget: 600, recentText: 'Tobias plays bass' });
    assert.match(full, /Time: /);
    assert.match(full, /Location: /);
    assert.match(full, /Irina/);
    assert.match(full, /Tobias Moreno \(Bassist\)/);
    assert.match(full, /Find a lead vocalist/);
    assert.ok(estimateTokens(full) <= 600 + 20, `over budget: ${estimateTokens(full)}`);
    const tiny = compileContext(s, { budget: 100 });
    assert.ok(estimateTokens(tiny) <= 110);
    assert.match(tiny, /Time: /);
    const ts = compileTrackerState(s);
    assert.match(ts, /Known people: Tobias Moreno/);
    assert.ok(keywords('The quick brown fox and the fox').includes('fox'));
});

test('templates fill placeholders', () => {
    assert.equal(fillTemplate('Hi {{user}} {{missing}}!', { user: 'A' }), 'Hi A !');
    assert.match(fillTemplate(DEFAULT_PROMPTS.tracker, { state: 'S', messages: 'M' }), /CURRENT STATE:\nS/);
});
