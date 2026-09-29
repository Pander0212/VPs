// Deterministic game rules: standing labels, tracker decay, item effects, activities.
// The model narrates; these functions decide the numbers.

import { clamp, num } from './util.js';

// ---------- Standing ----------
export function standingLabel(v) {
    const n = clamp(v, 0, 100);
    if (n < 15) return 'Enemy';
    if (n < 35) return 'Hostile';
    if (n < 65) return 'Neutral';
    return 'Friendly';
}

export function standingTone(v) {
    const l = standingLabel(v);
    return l === 'Friendly' ? 'good' : l === 'Neutral' ? 'neutral' : 'bad';
}

export function relationshipLabel(rel) {
    const a = num(rel?.affection, 0), t = num(rel?.trust, 0);
    const s = (a + t) / 2;
    if (a >= 85 && t >= 70) return 'Devoted';
    if (a >= 70) return 'Close';
    if (s >= 55) return 'Friend';
    if (s >= 35) return 'Acquaintance';
    if (s >= 15) return 'Wary';
    return 'Hostile';
}

// ---------- Trackers ----------
export const DEFAULT_TRACKERS = {
    hunger: { label: 'Hunger', icon: 'fa-utensils', color: '#e0a64b', value: 80, min: 0, max: 100, decayPerHour: 4, visible: true },
    energy: { label: 'Energy', icon: 'fa-bolt', color: '#6cc3e8', value: 80, min: 0, max: 100, decayPerHour: 3, visible: true },
    hygiene: { label: 'Hygiene', icon: 'fa-soap', color: '#8fd6a8', value: 80, min: 0, max: 100, decayPerHour: 2, visible: true },
};

/**
 * Compute tracker values after `minutes` pass. Sleeping (activity) is handled by activities.
 * Returns {id: newValue} for trackers that changed.
 */
export function decayTrackers(trackers, minutes) {
    const out = {};
    const hours = Math.max(0, num(minutes)) / 60;
    for (const [id, t] of Object.entries(trackers || {})) {
        const rate = num(t?.decayPerHour, 0);
        if (!rate) continue;
        const next = clamp(Math.round((num(t.value) - rate * hours) * 10) / 10, num(t.min, 0), num(t.max, 100));
        if (next !== num(t.value)) out[id] = next;
    }
    return out;
}

export function trackerState(t) {
    const max = num(t?.max, 100), min = num(t?.min, 0);
    const pct = max > min ? (num(t?.value) - min) / (max - min) : 0;
    if (pct <= 0.15) return 'critical';
    if (pct <= 0.35) return 'low';
    return 'ok';
}

// ---------- Items ----------
export const ITEM_CATEGORIES = ['food', 'drink', 'clothing', 'key', 'tool', 'weapon', 'armor', 'book', 'misc'];

export const CATEGORY_META = {
    food: { icon: '🍖', fa: 'fa-drumstick-bite', label: 'Food' },
    drink: { icon: '🥤', fa: 'fa-mug-hot', label: 'Drink' },
    clothing: { icon: '👕', fa: 'fa-shirt', label: 'Clothing' },
    key: { icon: '🗝️', fa: 'fa-key', label: 'Key' },
    tool: { icon: '🛠️', fa: 'fa-screwdriver-wrench', label: 'Tool' },
    weapon: { icon: '🗡️', fa: 'fa-khanda', label: 'Weapon' },
    armor: { icon: '🛡️', fa: 'fa-shield-halved', label: 'Armor' },
    book: { icon: '📖', fa: 'fa-book', label: 'Book' },
    misc: { icon: '📦', fa: 'fa-box', label: 'Misc' },
};

const FOOD_WORDS = /(bread|meat|steak|chicken|apple|soup|stew|rice|noodle|cake|pie|cookie|sandwich|burger|pizza|fish|salmon|egg|cheese|fruit|berry|ration|jerky|candy|chocolate|snack|meal|sausage|roast)/i;
const DRINK_WORDS = /(tea|coffee|water|juice|milk|ale|beer|wine|soda|potion|elixir|lemonade|drink|cola|brew|tonic)/i;
const WEAPON_WORDS = /(sword|dagger|knife|axe|bow|spear|gun|pistol|rifle|staff|wand|mace|hammer|blade|katana)/i;
const ARMOR_WORDS = /(armor|armour|shield|helm|helmet|gauntlet|greave|breastplate|mail)/i;
const CLOTH_WORDS = /(shirt|tee|jacket|hoodie|dress|coat|cloak|pants|jeans|skirt|shoes|boots|hat|scarf|gloves|robe|uniform)/i;
const KEY_WORDS = /(key|keycard|pass|badge|token)/i;
const BOOK_WORDS = /(book|tome|journal|scroll|letter|map|note|manual|grimoire)/i;
const TOOL_WORDS = /(rope|torch|lantern|kit|pick|shovel|phone|lighter|compass|lockpick|tool|wrench|hammer)/i;

export function guessCategory(name) {
    const n = String(name ?? '');
    if (DRINK_WORDS.test(n)) return 'drink';
    if (FOOD_WORDS.test(n)) return 'food';
    if (WEAPON_WORDS.test(n)) return 'weapon';
    if (ARMOR_WORDS.test(n)) return 'armor';
    if (CLOTH_WORDS.test(n)) return 'clothing';
    if (KEY_WORDS.test(n)) return 'key';
    if (BOOK_WORDS.test(n)) return 'book';
    if (TOOL_WORDS.test(n)) return 'tool';
    return 'misc';
}

/** Default effects when using an item of a category (can be overridden per item). */
export function defaultEffects(cat, name = '') {
    const n = String(name).toLowerCase();
    switch (cat) {
        case 'food': return { hunger: 25, energy: 3 };
        case 'drink':
            if (/potion|elixir|tonic/.test(n)) return { hp: 25 };
            if (/coffee|espresso|energy/.test(n)) return { energy: 12, hunger: 2 };
            if (/\btea\b/.test(n)) return { hunger: 8, energy: 6 };
            if (/ale|beer|wine/.test(n)) return { hunger: 5, energy: -3 };
            return { hunger: 8, energy: 2 };
        default: return {};
    }
}

export function isConsumable(item) {
    return ['food', 'drink'].includes(item?.cat) || !!item?.consumable;
}

export function isEquippable(item) {
    return ['weapon', 'armor', 'clothing', 'tool'].includes(item?.cat) || !!item?.slot;
}

export function defaultSlot(item) {
    if (item?.slot) return item.slot;
    switch (item?.cat) {
        case 'weapon': return 'hand';
        case 'armor': return /shield/i.test(item?.name) ? 'offhand' : 'body';
        case 'clothing': return /shoe|boot/i.test(item?.name) ? 'feet' : /hat|helm/i.test(item?.name) ? 'head' : 'outfit';
        case 'tool': return 'tool';
        default: return 'misc';
    }
}

// ---------- Activities ----------
export const ACTIVITIES = {
    sleep: { label: 'Sleep', icon: 'fa-bed', minutes: 480, effects: { energy: 70, hunger: -12, hygiene: -6, hp: 20 }, desc: 'Rest for the night. Restores energy and some HP.' },
    nap: { label: 'Nap', icon: 'fa-couch', minutes: 60, effects: { energy: 15, hunger: -3 }, desc: 'A short rest.' },
    work: { label: 'Work', icon: 'fa-briefcase', minutes: 240, effects: { energy: -20, hunger: -12, hygiene: -8 }, currency: 40, desc: 'Earn some money.' },
    train: { label: 'Train', icon: 'fa-dumbbell', minutes: 120, effects: { energy: -25, hunger: -10, hygiene: -15 }, xp: 15, desc: 'Gain experience.' },
    cook: { label: 'Cook', icon: 'fa-fire-burner', minutes: 45, effects: { hunger: 30, energy: -3 }, desc: 'Prepare and eat a meal.' },
    bathe: { label: 'Bathe', icon: 'fa-bath', minutes: 30, effects: { hygiene: 60, energy: 3 }, desc: 'Get clean.' },
    study: { label: 'Study', icon: 'fa-book-open', minutes: 90, effects: { energy: -10, hunger: -5 }, xp: 8, desc: 'Read and learn.' },
    explore: { label: 'Explore', icon: 'fa-compass', minutes: 60, effects: { energy: -10, hunger: -5 }, xp: 5, desc: 'Look around the area.' },
};

// ---------- Leveling ----------
export function xpForLevel(level) {
    return Math.round(100 * Math.pow(1.25, Math.max(0, num(level, 1) - 1)));
}
