// Campaign state schema, defaults and migrations. Pure (no ST, no DOM).
// Collections are objects keyed by id (not arrays) so rollback patches stay per-entity.

import { deepClone, isPlainObject, num } from './util.js';
import { DEFAULT_TRACKERS } from './rules.js';

export const SCHEMA_VERSION = 2;

export const DEFAULT_BARS = {
    hp: { label: 'HP', value: 100, max: 100, color: '#e0565b', icon: 'fa-heart', visible: true },
    ap: { label: 'AP', value: 10, max: 10, color: '#4fa3e3', icon: 'fa-bolt', visible: true },
    mp: { label: 'MP', value: 20, max: 20, color: '#a46be0', icon: 'fa-wand-magic-sparkles', visible: true },
    xp: { label: 'XP', value: 0, max: 100, color: '#e3c15a', icon: 'fa-star', visible: true },
};

export function defaultCampaign() {
    return {
        v: SCHEMA_VERSION,
        created: Date.now(),
        newGameDone: false,
        clock: { t: 8 * 60 },              // minutes since epoch
        calendar: {
            epoch: { y: 2026, m: 7, d: 1 },
            dateFormat: 'long',
            h24: true,
            monthNames: [],
            dayMode: 'turn',               // 'turn' | 'realtime'
            realMinutesPerDay: 60,
            events: {},
        },
        weather: { kind: 'clear', temp: 20 },
        statuses: {},                      // id -> {name, desc, until?}
        player: {
            name: '', title: '', cls: '', level: 1, age: '',
            profile: 'hybrid',             // hybrid | ap | mp
            bars: deepClone(DEFAULT_BARS),
            currency: 100, currencyName: 'Gold', currencySymbol: '🪙',
            skills: {},
            appearance: '',
        },
        trackers: deepClone(DEFAULT_TRACKERS),
        inventory: {},                     // id -> item
        equipment: {},                     // slot -> itemId
        map: {
            style: 'fantasy',
            location: 'loc_start',
            nodes: {
                loc_world: { id: 'loc_world', name: 'The Known World', tier: 'world', parent: null, x: 50, y: 50, pin: 'place', kind: 'world', desc: 'The wider world.', explored: true, links: [] },
                loc_region: { id: 'loc_region', name: 'Home Region', tier: 'region', parent: 'loc_world', x: 50, y: 50, pin: 'place', kind: 'region', desc: 'The region around you.', explored: true, links: [] },
                loc_start: { id: 'loc_start', name: 'Starting Point', tier: 'local', parent: 'loc_region', x: 50, y: 55, pin: 'place', kind: 'town', desc: 'Where the story begins.', explored: true, links: [] },
            },
        },
        npcs: {},                          // id -> npc
        orgs: {},
        quests: {},
        databank: {},
        party: { members: {} },            // npcId -> {role, slots:{}}
        battle: null,
        phone: { threads: {}, number: '' },
        diary: { entries: [] },
        helper: { messages: [] },
        activityLog: [],
        log: [],                           // applied op entries (see engine/ledger.js)
        stash: {},                         // fingerprint -> ops (for swipe-back replays)
    };
}

/** Bring any older/partial state up to the current schema. Never throws. */
export function migrate(raw) {
    const base = defaultCampaign();
    if (!isPlainObject(raw)) return base;
    const s = deepClone(raw);
    const v = num(s.v, 0);

    // v0/v1: inventory and npcs used to be arrays; convert to keyed maps.
    if (v < 2) {
        for (const key of ['inventory', 'npcs', 'orgs', 'quests', 'databank']) {
            if (Array.isArray(s[key])) {
                const m = {};
                s[key].forEach((e, i) => {
                    if (!isPlainObject(e)) return;
                    const id = e.id || `${key}_${i}`;
                    m[id] = { ...e, id };
                });
                s[key] = m;
            }
        }
        if (typeof s.time === 'number' && !s.clock) s.clock = { t: s.time };
        delete s.time;
    }

    // Fill any missing top-level keys and nested defaults.
    const out = { ...base, ...s };
    for (const k of Object.keys(base)) {
        if (isPlainObject(base[k]) && !isPlainObject(out[k]) && k !== 'battle') out[k] = deepClone(base[k]);
    }
    out.clock = { ...base.clock, ...out.clock };
    out.calendar = { ...base.calendar, ...out.calendar, epoch: { ...base.calendar.epoch, ...(out.calendar?.epoch || {}) } };
    if (!isPlainObject(out.calendar.events)) out.calendar.events = {};
    out.player = { ...base.player, ...out.player };
    out.player.bars = isPlainObject(out.player.bars) ? out.player.bars : deepClone(DEFAULT_BARS);
    out.map = { ...base.map, ...out.map };
    if (!isPlainObject(out.map.nodes) || !Object.keys(out.map.nodes).length) out.map.nodes = deepClone(base.map.nodes);
    if (!out.map.nodes[out.map.location]) out.map.location = Object.keys(out.map.nodes)[0];
    out.party = isPlainObject(out.party) && isPlainObject(out.party.members) ? out.party : { members: {} };
    out.phone = { ...base.phone, ...out.phone };
    out.diary = isPlainObject(out.diary) && Array.isArray(out.diary.entries) ? out.diary : { entries: [] };
    if (!Array.isArray(out.log)) out.log = [];
    if (!Array.isArray(out.activityLog)) out.activityLog = [];
    if (!isPlainObject(out.stash)) out.stash = {};
    out.v = SCHEMA_VERSION;
    return out;
}

export const DEFAULT_SETTINGS = {
    enabled: true,
    trackerMode: 'pass',        // 'pass' | 'inline' | 'off'
    trackerContext: 2,          // last N messages sent to the tracker pass
    trackerTimeoutSec: 60,
    rerunOnEdit: true,
    trackGreeting: false,       // run the tracker on the character's first message
    injectEnabled: true,
    injectPosition: 1,          // extension_prompt_types.IN_CHAT
    injectDepth: 2,
    injectRole: 0,              // system
    injectBudget: 600,
    theme: 'glass',             // glass | parchment | auto
    accent: 'gold',
    launcherCorner: 'br',       // br | bl | tr | tl
    launcherOffset: 0,
    hud: {
        show: true, expanded: false,
        items: { time: true, weather: true, status: true, location: true, currency: true, hp: true, ap: true, mp: true, xp: true, trackers: true },
    },
    showChangeToasts: true,
    helperPet: { show: true, emoji: '🦊', name: 'Pip', x: null, y: null },
    atmosphere: true,
    vnMode: false,
    narratorNotes: true,
    prompts: {},                // overrides of ai/prompts.js keys
    personas: {},               // persona avatar id -> persona studio data (global)
};

export function migrateSettings(raw) {
    const s = isPlainObject(raw) ? deepClone(raw) : {};
    const out = { ...deepClone(DEFAULT_SETTINGS), ...s };
    out.hud = { ...DEFAULT_SETTINGS.hud, ...(s.hud || {}) };
    out.hud.items = { ...DEFAULT_SETTINGS.hud.items, ...(s.hud?.items || {}) };
    out.helperPet = { ...DEFAULT_SETTINGS.helperPet, ...(s.helperPet || {}) };
    if (!isPlainObject(out.prompts)) out.prompts = {};
    if (!isPlainObject(out.personas)) out.personas = {};
    return out;
}
