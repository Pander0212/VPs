// Panel registry. Panels are lazy-loaded on first open (keeps phone boot light).
// A tile without a loader shows "coming soon" instead of throwing.

import { reportError } from './dom.js';

export const SECTIONS = [
    { id: 'story', label: 'Story Tools' },
    { id: 'character', label: 'Character Tools' },
    { id: 'world', label: 'World Tools' },
    { id: 'system', label: 'System' },
];

export const PANELS = {
    journal: { label: 'Journal', icon: 'fa-book-open', section: 'story', load: () => import('./journal.js') },
    diary: { label: 'Diary', icon: 'fa-book-bookmark', section: 'story', load: () => import('./diary.js') },
    map: { label: 'Map', icon: 'fa-map-location-dot', section: 'story', load: () => import('./map.js') },
    orgs: { label: 'Organizations', icon: 'fa-sitemap', section: 'story', load: () => import('./orgs.js') },
    activities: { label: 'Activities', icon: 'fa-person-running', section: 'story', load: () => import('./activities.js') },
    battle: { label: 'Battle', icon: 'fa-khanda', section: 'story', load: () => import('./battle.js') },

    persona: { label: 'Persona', icon: 'fa-masks-theater', section: 'character', load: () => import('./persona.js') },
    inventory: { label: 'Inventory', icon: 'fa-bag-shopping', section: 'character', load: () => import('./inventory.js') },
    characters: { label: 'Characters', icon: 'fa-id-card', section: 'character', load: () => import('./characters.js') },
    party: { label: 'Party', icon: 'fa-people-group', section: 'character', load: () => import('./party.js') },
    social: { label: 'Social', icon: 'fa-heart', section: 'character', load: () => import('./social.js') },

    databank: { label: 'Databank', icon: 'fa-database', section: 'world', load: () => import('./databank.js') },
    phone: { label: 'Phone', icon: 'fa-mobile-screen', section: 'world', load: () => import('./phone.js') },
    npcs: { label: 'Add NPC', icon: 'fa-user-plus', section: 'world', load: () => import('./npcs.js'), params: { add: true } },
    calendar: { label: 'Calendar', icon: 'fa-calendar-days', section: 'world', load: () => import('./calendar.js') },
    atmosphere: { label: 'Atmosphere', icon: 'fa-cloud-sun-rain', section: 'world', load: () => import('./atmosphere.js') },
    helper: { label: 'Helper', icon: 'fa-wand-magic-sparkles', section: 'world', load: () => import('./helper.js') },

    newgame: { label: 'New Game', icon: 'fa-dice-d20', section: 'system', load: () => import('./newgame.js') },
    settings: { label: 'Settings', icon: 'fa-sliders', section: 'system', load: () => import('./settings.js') },
    help: { label: 'Help', icon: 'fa-circle-question', section: 'system', load: () => import('./help.js') },
    save: { label: 'Save / Export', icon: 'fa-floppy-disk', section: 'system', load: () => import('./settings.js'), params: { tab: 'backup' } },
};

// Extra entries reachable from inside panels / slash commands (not deck tiles).
export const HIDDEN_PANELS = {
    npclist: { label: 'NPCs', icon: 'fa-users', load: () => import('./npcs.js') },
};

const loaded = new Map();

export async function openPanel(id, params = {}) {
    const def = PANELS[id] || HIDDEN_PANELS[id];
    if (!def) {
        globalThis.toastr?.info?.('Coming soon', 'UIE');
        return null;
    }
    if (!def.load) {
        globalThis.toastr?.info?.(`${def.label} — coming soon`, 'UIE');
        return null;
    }
    try {
        let mod = loaded.get(id);
        if (!mod) {
            try { mod = await def.load(); } catch (e) {
                console.warn('[UIE] panel not available', id, e);
                globalThis.toastr?.info?.(`${def.label} — coming soon`, 'UIE');
                return null;
            }
            loaded.set(id, mod);
        }
        if (typeof mod.open !== 'function') {
            globalThis.toastr?.info?.(`${def.label} — coming soon`, 'UIE');
            return null;
        }
        return await mod.open({ ...(def.params || {}), ...params });
    } catch (e) {
        reportError(e, `open ${id}`);
        return null;
    }
}
