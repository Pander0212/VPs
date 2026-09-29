// Deterministic turn-based battle. All randomness comes from a seeded PRNG whose position
// is stored in the battle state (battle.rngState), so replays and rollbacks are exact.

import { clamp, num, hash, deepClone } from './util.js';

export const SKILLS = {
    attack: { label: 'Attack', icon: 'fa-hand-fist', ap: 0, mp: 0, mult: 1, target: 'enemy' },
    power: { label: 'Power Strike', icon: 'fa-burst', ap: 3, mp: 0, mult: 1.7, target: 'enemy' },
    spell: { label: 'Arcane Bolt', icon: 'fa-wand-sparkles', ap: 0, mp: 5, mult: 1.5, magic: true, target: 'enemy' },
    heal: { label: 'Heal', icon: 'fa-hand-holding-medical', ap: 0, mp: 4, heal: 22, target: 'ally' },
    poison: { label: 'Venom Edge', icon: 'fa-skull-crossbones', ap: 2, mp: 0, mult: 0.8, status: { id: 'poison', turns: 3 }, target: 'enemy' },
    stun: { label: 'Stagger', icon: 'fa-star', ap: 4, mp: 0, mult: 0.6, status: { id: 'stun', turns: 1 }, target: 'enemy' },
    defend: { label: 'Defend', icon: 'fa-shield', ap: 0, mp: 0, target: 'self' },
    item: { label: 'Item', icon: 'fa-flask', ap: 0, mp: 0, target: 'ally' },
    flee: { label: 'Flee', icon: 'fa-person-running', ap: 0, mp: 0, target: 'self' },
};

export const STATUS = {
    poison: { label: 'Poisoned', icon: '☠️', dot: 4 },
    burn: { label: 'Burning', icon: '🔥', dot: 5 },
    stun: { label: 'Stunned', icon: '💫', skip: true },
    regen: { label: 'Regenerating', icon: '✨', dot: -5 },
};

function nextRand(b) {
    // mulberry32 step on stored state
    let a = (b.rngState + 0x6D2B79F5) >>> 0;
    b.rngState = a;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function roll(b, lo, hi) {
    return lo + Math.floor(nextRand(b) * (hi - lo + 1));
}

export function makeCombatant(src, side, idx = 0) {
    const maxHp = clamp(num(src.maxHp ?? src.hp, 30), 1, 9999);
    return {
        id: src.id || `${side}_${idx}`,
        name: String(src.name || (side === 'enemy' ? `Enemy ${idx + 1}` : `Ally ${idx + 1}`)).slice(0, 60),
        side,
        hp: clamp(num(src.hp, maxHp), 0, maxHp), maxHp,
        ap: clamp(num(src.ap, 10), 0, 999), maxAp: clamp(num(src.maxAp ?? src.ap, 10), 0, 999),
        mp: clamp(num(src.mp, 10), 0, 999), maxMp: clamp(num(src.maxMp ?? src.mp, 10), 0, 999),
        atk: clamp(num(src.atk, 8), 0, 999), def: clamp(num(src.def, 3), 0, 999),
        spd: clamp(num(src.spd, 5), 0, 999), mag: clamp(num(src.mag, 6), 0, 999),
        statuses: [], defending: false, fled: false,
    };
}

export function createBattle({ party = [], enemies = [], seed = 'battle', t = 0 }) {
    const b = {
        active: true, round: 1, turn: 0, rngState: parseInt(hash(seed), 36) >>> 0,
        combatants: {}, order: [], log: [], result: null, startedAt: t,
    };
    party.forEach((p, i) => { const c = makeCombatant(p, 'party', i); b.combatants[c.id] = c; });
    enemies.forEach((e, i) => { const c = makeCombatant({ ...e, id: e.id || `enemy_${i}` }, 'enemy', i); b.combatants[c.id] = c; });
    // Initiative: spd + d6, ties broken by id for determinism.
    const init = Object.values(b.combatants).map(c => ({ id: c.id, v: c.spd + roll(b, 1, 6) }));
    init.sort((x, y) => (y.v - x.v) || x.id.localeCompare(y.id));
    b.order = init.map(x => x.id);
    b.log.push(`Battle begins! Initiative: ${b.order.map(id => b.combatants[id].name).join(' → ')}`);
    skipDead(b);
    return b;
}

export const alive = (c) => c && c.hp > 0 && !c.fled;

export function currentActor(b) {
    return b?.combatants?.[b.order[b.turn]] || null;
}

function skipDead(b) {
    let guard = 0;
    while (!alive(currentActor(b)) && guard++ < b.order.length + 1) advanceTurn(b, true);
}

function advanceTurn(b, silent = false) {
    b.turn++;
    if (b.turn >= b.order.length) {
        b.turn = 0;
        b.round++;
        if (!silent) b.log.push(`— Round ${b.round} —`);
    }
}

function applyStatusTicks(b, c) {
    let skip = false;
    for (const s of c.statuses) {
        const def = STATUS[s.id];
        if (!def) continue;
        if (def.dot) {
            const before = c.hp;
            c.hp = clamp(c.hp - def.dot, 0, c.maxHp);
            b.log.push(`${c.name} ${def.dot > 0 ? `takes ${before - c.hp} ${def.label.toLowerCase()} damage` : `regenerates ${c.hp - before} HP`}.`);
        }
        if (def.skip) skip = true;
        s.turns--;
    }
    c.statuses = c.statuses.filter(s => s.turns > 0);
    return skip;
}

function damage(b, actor, target, mult, magic) {
    const base = magic ? actor.mag : actor.atk;
    const defense = magic ? target.def * 0.5 : target.def;
    let dmg = Math.round(base * mult + roll(b, 0, 3) - defense * 0.6);
    const crit = roll(b, 1, 20) === 20;
    if (crit) dmg = Math.round(dmg * 1.5);
    if (target.defending) dmg = Math.round(dmg / 2);
    dmg = Math.max(1, dmg);
    target.hp = clamp(target.hp - dmg, 0, target.maxHp);
    return { dmg, crit };
}

export function checkEnd(b) {
    const cs = Object.values(b.combatants);
    const partyUp = cs.some(c => c.side === 'party' && alive(c));
    const enemyUp = cs.some(c => c.side === 'enemy' && alive(c));
    if (!enemyUp) { b.active = false; b.result = 'victory'; b.log.push('Victory!'); }
    else if (!partyUp) {
        b.active = false;
        b.result = cs.some(c => c.side === 'party' && c.fled) ? 'fled' : 'defeat';
        b.log.push(b.result === 'fled' ? 'You escaped.' : 'Defeat...');
    }
    return b.result;
}

/**
 * Perform an action for the current actor. Returns a NEW battle object (input untouched).
 * @param {object} battle
 * @param {{skill: string, target?: string, itemHeal?: number, itemName?: string}} action
 */
export function act(battle, action) {
    const b = deepClone(battle);
    if (!b.active) return b;
    const actor = currentActor(b);
    if (!alive(actor)) { advanceTurn(b); skipDead(b); return b; }
    actor.defending = false;

    if (applyStatusTicks(b, actor)) {
        b.log.push(`${actor.name} is stunned and loses the turn.`);
        endTurn(b, actor);
        return b;
    }
    if (!alive(actor)) { endTurn(b, actor); return b; }

    let skill = SKILLS[action?.skill] || SKILLS.attack;
    let key = SKILLS[action?.skill] ? action.skill : 'attack';
    if (actor.ap < skill.ap || actor.mp < skill.mp) {
        b.log.push(`${actor.name} lacks the ${actor.ap < skill.ap ? 'AP' : 'MP'} for ${skill.label} and attacks instead.`);
        skill = SKILLS.attack;
        key = 'attack';
    }
    actor.ap -= skill.ap;
    actor.mp -= skill.mp;

    const foes = Object.values(b.combatants).filter(c => c.side !== actor.side && alive(c));
    const allies = Object.values(b.combatants).filter(c => c.side === actor.side && alive(c));
    let target = b.combatants[action?.target];

    switch (key) {
        case 'defend':
            actor.defending = true;
            actor.ap = Math.min(actor.maxAp, actor.ap + 2);
            b.log.push(`${actor.name} braces for impact.`);
            break;
        case 'flee': {
            const ok = roll(b, 1, 10) + actor.spd / 2 >= 7;
            if (ok) { actor.fled = true; b.log.push(`${actor.name} flees the fight!`); }
            else b.log.push(`${actor.name} tries to flee but is cut off.`);
            break;
        }
        case 'heal':
        case 'item': {
            if (!target || target.side !== actor.side || !alive(target)) target = actor;
            const amount = key === 'item' ? clamp(num(action?.itemHeal, 20), 0, 999) : skill.heal + Math.round(actor.mag / 2);
            const before = target.hp;
            target.hp = clamp(target.hp + amount, 0, target.maxHp);
            b.log.push(key === 'item'
                ? `${actor.name} uses ${action?.itemName || 'an item'} on ${target.name} (+${target.hp - before} HP).`
                : `${actor.name} heals ${target.name} for ${target.hp - before} HP.`);
            break;
        }
        default: {
            if (!target || target.side === actor.side || !alive(target)) target = foes[0];
            if (!target) break;
            const { dmg, crit } = damage(b, actor, target, skill.mult, !!skill.magic);
            b.log.push(`${actor.name} uses ${skill.label} on ${target.name}: ${dmg} damage${crit ? ' (critical!)' : ''}.${target.hp <= 0 ? ` ${target.name} falls!` : ''}`);
            if (skill.status && target.hp > 0) {
                const ex = target.statuses.find(s => s.id === skill.status.id);
                if (ex) ex.turns = Math.max(ex.turns, skill.status.turns);
                else target.statuses.push({ ...skill.status });
                b.log.push(`${target.name} is ${STATUS[skill.status.id].label.toLowerCase()}.`);
            }
        }
    }
    void allies;
    endTurn(b, actor);
    return b;
}

function endTurn(b, actor) {
    actor.ap = Math.min(actor.maxAp, actor.ap + 1); // passive AP regen
    if (checkEnd(b)) return;
    advanceTurn(b);
    skipDead(b);
    if (b.log.length > 200) b.log = b.log.slice(-200);
}

/** Simple deterministic enemy AI: returns an action for the current actor. */
export function enemyChoice(b) {
    const actor = currentActor(b);
    const clone = { rngState: b.rngState };
    const foes = Object.values(b.combatants).filter(c => c.side !== actor.side && alive(c));
    if (!foes.length) return { skill: 'defend' };
    const weakest = [...foes].sort((x, y) => x.hp - y.hp || x.id.localeCompare(y.id))[0];
    const r = nextRand(clone);
    if (actor.hp < actor.maxHp * 0.3 && actor.mp >= SKILLS.heal.mp) return { skill: 'heal', target: actor.id };
    if (actor.ap >= SKILLS.power.ap && r < 0.45) return { skill: 'power', target: weakest.id };
    if (actor.mp >= SKILLS.spell.mp && r > 0.75) return { skill: 'spell', target: foes[Math.floor(r * foes.length) % foes.length].id };
    return { skill: 'attack', target: weakest.id };
}

/** Run enemy turns until it's a party member's turn or the battle ends. */
export function runEnemies(battle, maxSteps = 20) {
    let b = battle;
    let steps = 0;
    while (b.active && currentActor(b)?.side === 'enemy' && steps++ < maxSteps) {
        b = act(b, enemyChoice(b));
    }
    return b;
}

export function rewards(b) {
    const enemies = Object.values(b.combatants).filter(c => c.side === 'enemy');
    const xp = enemies.reduce((s, e) => s + Math.round(e.maxHp / 3 + e.atk), 0);
    const currency = enemies.reduce((s, e) => s + Math.round(e.maxHp / 5), 0);
    return b.result === 'victory' ? { xp, currency } : { xp: 0, currency: 0 };
}

export function summary(b) {
    const cs = Object.values(b.combatants);
    const party = cs.filter(c => c.side === 'party').map(c => `${c.name} ${c.hp}/${c.maxHp} HP`).join(', ');
    const enemies = cs.filter(c => c.side === 'enemy').map(c => c.name).join(', ');
    const r = rewards(b);
    const outcome = b.result === 'victory' ? 'won' : b.result === 'fled' ? 'fled from' : 'lost';
    return `[Battle] The party ${outcome} the fight against ${enemies} after ${b.round} round(s). ${party}.${r.xp ? ` Gained ${r.xp} XP and ${r.currency} currency.` : ''}`;
}
