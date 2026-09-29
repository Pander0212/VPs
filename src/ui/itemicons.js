// Emoji art for items (no image assets needed). Keyword match on the item name, then category.
import { CATEGORY_META } from '../engine/rules.js';

const MAP = [
    [/lemon ?tea|iced tea/, '🧋'], [/\btea\b/, '🍵'], [/coffee|latte|espresso/, '☕'], [/water/, '💧'], [/juice|orange/, '🧃'], [/milk/, '🥛'],
    [/beer|ale/, '🍺'], [/wine/, '🍷'], [/cocktail/, '🍸'], [/soda|cola/, '🥤'], [/potion|elixir|tonic/, '🧪'],
    [/bread|loaf|bun/, '🍞'], [/apple/, '🍎'], [/banana/, '🍌'], [/grape/, '🍇'], [/cheese/, '🧀'], [/egg/, '🥚'], [/steak|beef|meat|roast/, '🥩'],
    [/chicken|drumstick|poultry|duck/, '🍗'], [/sausage|hot ?dog/, '🌭'], [/burger/, '🍔'], [/pizza/, '🍕'], [/fish|salmon|tuna/, '🐟'], [/rice|onigiri/, '🍙'],
    [/noodle|ramen/, '🍜'], [/soup|stew/, '🍲'], [/cake/, '🍰'], [/cookie|biscuit/, '🍪'], [/chocolate|candy/, '🍫'], [/sandwich/, '🥪'], [/berry|strawberr/, '🍓'],
    [/sword|blade|katana/, '🗡️'], [/dagger|knife/, '🔪'], [/axe/, '🪓'], [/bow\b|arrow/, '🏹'], [/gun|pistol|rifle/, '🔫'], [/staff|wand/, '🪄'], [/hammer|mace/, '🔨'],
    [/shield/, '🛡️'], [/helm|helmet/, '⛑️'], [/armor|armour|mail/, '🦺'],
    [/hoodie|jacket|coat/, '🧥'], [/tee|shirt/, '👕'], [/dress/, '👗'], [/jeans|pants|trousers/, '👖'], [/boots|shoes|sneakers/, '👟'], [/hat|cap/, '🧢'], [/scarf/, '🧣'], [/gloves/, '🧤'],
    [/ring/, '💍'], [/necklace|amulet|pendant/, '📿'], [/crown/, '👑'], [/gem|crystal|jewel/, '💎'],
    [/key/, '🗝️'], [/card|pass|badge|ticket/, '🎫'], [/phone/, '📱'], [/map/, '🗺️'], [/letter|note|envelope/, '✉️'], [/scroll/, '📜'], [/book|tome|journal|grimoire/, '📕'],
    [/rope/, '🪢'], [/torch|lantern|lamp/, '🔦'], [/candle/, '🕯️'], [/compass/, '🧭'], [/pick|shovel/, '⛏️'], [/wrench|tool/, '🔧'], [/lockpick/, '🪛'],
    [/guitar/, '🎸'], [/microphone|mic\b/, '🎤'], [/flower|rose/, '🌹'], [/coin|gold|money/, '🪙'], [/bag|pouch|backpack/, '🎒'], [/umbrella/, '☂️'], [/camera/, '📷'],
];

export function itemEmoji(item) {
    if (item?.icon) return item.icon;
    const n = String(item?.name || '').toLowerCase();
    for (const [re, e] of MAP) if (re.test(n)) return e;
    return CATEGORY_META[item?.cat]?.icon || '📦';
}

export const CAT_COLOR = {
    food: '#e3a15a', drink: '#5ab7e3', clothing: '#c792ea', key: '#e3c15a', tool: '#9aa4b1',
    weapon: '#e36b5a', armor: '#6b9ae3', book: '#b98a5a', misc: '#a0a0a0',
};
