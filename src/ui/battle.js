// Battle: deterministic turn-based combat (engine/battle.js). Initiative, attack / skills /
// items / defend / flee, HP-AP-MP costs, status effects, log. The AI can start a battle with
// the battle.start op; the result is posted back to chat as a narrator summary.

import { S, bus, mutate, settingsGet, userOps } from '../state.js';
import { st } from '../st-adapter.js';
import { openSheet, formDialog, choiceDialog } from './sheet.js';
import { esc, icon, bar, reportError } from './dom.js';
import { SKILLS, STATUS, act, runEnemies, currentActor, alive, rewards, summary, createBattle } from '../engine/battle.js';
import { playerCombatant } from '../engine/ops.js';
import { isConsumable, defaultEffects } from '../engine/rules.js';
import { str, clamp, num } from '../engine/util.js';

const PLAYER_SKILLS = ['attack', 'power', 'spell', 'heal', 'poison', 'stun', 'defend', 'item', 'flee'];

function fighter(c, { turn, target, pick }) {
    return `<button class="uie-fighter ${turn ? 'turn' : ''} ${target ? 'target' : ''} ${alive(c) ? '' : 'down'}" ${pick ? `data-target="${esc(c.id)}"` : ''} aria-label="${esc(c.name)}">
        <span class="uie-avatar" style="width:40px;height:40px;flex-basis:40px;font-size:1.3rem">${c.side === 'enemy' ? '👹' : c.id === 'player' ? '⭐' : '🛡️'}</span>
        <div class="uie-grow">
            <div class="uie-row uie-between"><b>${esc(c.name)}</b><small class="uie-muted">${c.statuses.map(s => STATUS[s.id]?.icon || '').join('')} ${c.defending ? '🛡' : ''} ${c.fled ? 'fled' : ''}</small></div>
            <div>${bar(c.hp, c.maxHp, '#e0565b', { label: 'HP' })}</div>
            <div class="uie-row" style="gap:6px;font-size:.72rem;color:var(--muted)"><span>HP ${c.hp}/${c.maxHp}</span><span>AP ${c.ap}</span><span>MP ${c.mp}</span></div>
        </div>
    </button>`;
}

export function open() {
    const sheet = openSheet({ id: 'battle', title: 'Battle', icon: 'fa-khanda' });
    const view = { target: null };

    const finish = () => {
        const b = S().battle;
        if (!b || b.active || b.settled) return;
        const r = rewards(b);
        const hp = b.combatants.player?.hp;
        mutate(s => {
            s.battle.settled = true;
            // Losing knocks you out (1 HP + Wounded) instead of ending the campaign.
            if (hp !== undefined && s.player.bars.hp) s.player.bars.hp.value = clamp(b.result === 'defeat' ? Math.max(1, hp) : hp, 0, s.player.bars.hp.max);
            if (b.result === 'defeat') s.statuses[`st_wounded`] = { name: 'Wounded', desc: 'knocked out in battle; needs rest', until: s.clock.t + 480 };
            for (const [id, m] of Object.entries(s.party.members)) if (b.combatants[id]) m.hp = b.combatants[id].hp;
        });
        if (r.xp || r.currency) userOps([{ op: 'bar.delta', id: 'xp', value: r.xp }, ...(r.currency ? [{ op: 'currency.delta', amount: r.currency }] : [])]);
        if (settingsGet().narratorNotes) st.narrate(summary(b));
    };

    const render = () => {
        const s = S();
        const b = s.battle;
        if (!b) {
            sheet.body.innerHTML = `<div class="uie-empty">${icon('fa-khanda')}No battle in progress.<br><small>The story can start one (battle.start), or set one up yourself.</small></div>
                <div class="uie-center" style="display:grid;gap:10px;padding:0 20px">
                    <button class="uie-btn uie-btn-primary" data-b="setup">${icon('fa-khanda')} Set up a battle</button>
                    <button class="uie-btn" data-b="quick">${icon('fa-dice')} Quick skirmish (practice)</button>
                </div>`;
            return;
        }
        const actor = currentActor(b);
        const myTurn = b.active && actor?.side === 'party';
        const party = Object.values(b.combatants).filter(c => c.side === 'party');
        const enemies = Object.values(b.combatants).filter(c => c.side === 'enemy');
        if (!view.target || !alive(b.combatants[view.target])) view.target = enemies.find(alive)?.id;
        const items = Object.values(s.inventory).filter(i => isConsumable(i));
        sheet.body.innerHTML = `
            <div class="uie-pad" style="padding-bottom:0"><div class="uie-row uie-between"><b>Round ${esc(b.round)}</b><span class="uie-tag ${b.active ? 'neutral' : b.result === 'victory' ? 'good' : 'bad'}">${b.active ? (myTurn ? `${esc(actor.name)}'s turn` : 'Enemy turn') : esc(String(b.result).toUpperCase())}</span></div></div>
            <div class="uie-battle-field">
                <div><div class="uie-side-h">Party</div>${party.map(c => fighter(c, { turn: actor?.id === c.id && b.active })).join('')}</div>
                <div><div class="uie-side-h">Enemies — tap to target</div>${enemies.map(c => fighter(c, { turn: actor?.id === c.id && b.active, target: view.target === c.id, pick: alive(c) })).join('')}</div>
            </div>
            ${b.active ? `<div class="uie-battle-actions">${PLAYER_SKILLS.map(k => {
                const sk = SKILLS[k];
                const can = myTurn && actor.ap >= sk.ap && actor.mp >= sk.mp && (k !== 'item' || items.length);
                return `<button class="uie-btn" data-sk="${k}" ${can ? '' : 'disabled'}>${icon(sk.icon)}<span>${esc(sk.label)}</span>${sk.ap || sk.mp ? `<small>${sk.ap ? `${sk.ap} AP` : ''}${sk.mp ? `${sk.mp} MP` : ''}</small>` : ''}</button>`;
            }).join('')}</div>` : `<div class="uie-pad"><div class="uie-card" style="text-align:center"><h4>${b.result === 'victory' ? '🏆 Victory' : b.result === 'fled' ? '🏃 Escaped' : '💀 Defeat'}</h4><p>${esc(summary(b))}</p><button class="uie-btn uie-btn-primary" data-b="close">${icon('fa-check')} End battle</button></div></div>`}
            <div class="uie-battle-log" aria-live="polite">${b.log.slice(-30).map(l => `<div>${esc(l)}</div>`).join('')}</div>`;
        const log = sheet.body.querySelector('.uie-battle-log');
        log.scrollTop = log.scrollHeight;
    };

    const step = (action) => {
        let b = S().battle;
        if (!b?.active) return;
        b = act(b, action);
        b = runEnemies(b);
        mutate(s => { s.battle = b; }, 'battle');
        if (!b.active) finish();
    };

    // If an AI-started battle opens on an enemy turn, let the enemies act first.
    const b0 = S().battle;
    if (b0?.active && currentActor(b0)?.side === 'enemy') { mutate(s => { s.battle = runEnemies(b0); }, 'battle'); if (!S().battle.active) finish(); }
    render();
    sheet.onCleanup(bus.on(() => render()));

    sheet.body.addEventListener('click', async (e) => {
        try {
            const t = e.target.closest('[data-target]');
            if (t) { view.target = t.dataset.target; render(); return; }
            const sk = e.target.closest('[data-sk]')?.dataset.sk;
            if (sk) {
                const b = S().battle;
                const actor = currentActor(b);
                if (sk === 'item') {
                    const items = Object.values(S().inventory).filter(i => isConsumable(i));
                    const iid = await choiceDialog('Use item', items.map(i => ({ label: `${i.name} ×${i.qty}`, value: i.id, icon: 'fa-flask' })));
                    if (!iid) return;
                    const it = S().inventory[iid];
                    const eff = Object.keys(it.effects || {}).length ? it.effects : defaultEffects(it.cat, it.name);
                    const heal = num(eff.hp, 0) || Math.max(10, num(eff.hunger, 0));
                    userOps([{ op: 'item.remove', name: it.name, id: iid, qty: 1 }], { toast: false });
                    step({ skill: 'item', target: actor.id, itemHeal: heal, itemName: it.name });
                    return;
                }
                const target = ['heal', 'defend', 'flee'].includes(sk) ? actor.id : view.target;
                step({ skill: sk, target });
                return;
            }
            const a = e.target.closest('[data-b]')?.dataset.b;
            if (a === 'close') { mutate(s => { s.battle = null; }, 'battle'); render(); }
            if (a === 'quick') startBattle([{ name: 'Feral Wolf', hp: 22, atk: 5, def: 1, spd: 6 }]);
            if (a === 'setup') {
                const v = await formDialog('Set up a battle', `
                    <p class="uie-muted">One enemy per line: <code>Name, HP, ATK, DEF, SPD</code></p>
                    <label class="uie-field"><span>Enemies</span><textarea name="enemies" rows="4">Goblin, 24, 6, 2, 6\nGoblin Archer, 18, 7, 1, 7</textarea></label>`, { okLabel: 'Fight!' });
                if (!v) return;
                const enemies = String(v.enemies || '').split('\n').map(l => l.split(',').map(x => x.trim())).filter(p => p[0]).slice(0, 6)
                    .map(([name, hp, atk, def, spd]) => ({ name: str(name, 40), hp: clamp(Number(hp) || 20, 1, 999), atk: clamp(Number(atk) || 6, 0, 99), def: clamp(Number(def) || 2, 0, 99), spd: clamp(Number(spd) || 5, 0, 99) }));
                if (enemies.length) startBattle(enemies);
            }
        } catch (err) { reportError(err); }
    });

    function startBattle(enemies) {
        const s = S();
        const party = [playerCombatant(s), ...Object.entries(s.party.members).map(([id, m]) => s.npcs[id] ? { id, name: s.npcs[id].name, hp: m.hp ?? 60, maxHp: m.maxHp ?? 60, atk: m.atk ?? 8, def: m.def ?? 3, spd: m.spd ?? 5 } : null).filter(Boolean)];
        let b = createBattle({ party, enemies, seed: `${Date.now()}`, t: s.clock.t });
        b = runEnemies(b);
        mutate(st2 => { st2.battle = b; }, 'battle');
        if (!b.active) finish();
        render();
    }
    return sheet;
}
