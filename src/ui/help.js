// Help: quick guide to every tool, tips for cheap/free APIs, and troubleshooting.

import { openSheet } from './sheet.js';
import { icon } from './dom.js';

const SECTIONS = [
    ['fa-compass', 'Getting started', `Tap the round compass button to open the <b>Command Deck</b>. Start with <b>New Game</b> to name your character, pick a starting place and seed items — or just chat: UIE tracks items, time, places and people from the story automatically. Tap the status strip at the top to expand it.`],
    ['fa-magnifying-glass-chart', 'How tracking works', `After each AI reply UIE reads the last messages and extracts <i>ops</i> (item gained, 20 minutes passed, met Tobias…). Code — not the model — applies them and keeps the numbers. Swiping, deleting or editing a message rolls its changes back automatically; swiping back restores them without another AI call.`],
    ['fa-coins', 'Cheap / free APIs', `Each reply normally costs one extra small call. To save quota: Settings → AI &amp; Tracking → Mode <b>Inline tags</b> (no extra call; works best with capable models) or <b>Off</b> (manual only). Lower the injection budget to ~300 tokens on small context models.`],
    ['fa-lock', 'Locked NPCs', `Lock an NPC in Game NPCs to stop the AI from changing their details or relationship. You can still edit them yourself.`],
    ['fa-map-location-dot', 'Map', `Tiers go World → Region → Local → Nearby → Area. Tap a pin for travel time and energy, then <b>Move To Area</b>. <b>Open Area</b> drills inside a place. <b>Ask AI To Expand</b> invents nearby places (shown as “Unknown Nearby” until you visit). Pinch or use +/− to zoom.`],
    ['fa-calendar-days', 'Time', `Turn-based by default: time moves when the story or your actions say so. Switch the calendar to real-time day length if you want the clock to run while you read.`],
    ['fa-floppy-disk', 'Backups', `Campaign data lives inside each chat file. Use Save / Export to download a JSON copy (works on phones) and Import to restore it into any chat.`],
    ['fa-terminal', 'Slash commands', `<code>/uie</code> deck · <code>/uie-map</code> · <code>/uie-inv</code> · <code>/uie-journal</code> · <code>/uie-diary</code> · <code>/uie-npcs</code> · <code>/uie-calendar</code> · <code>/uie-orgs</code> · <code>/uie-phone</code> · <code>/uie-battle</code> · <code>/uie-helper</code> · <code>/uie-settings</code> · <code>/uie-pass</code> (re-track last reply). Macros: <code>{{uie_location}}</code> <code>{{uie_time}}</code> <code>{{uie_date}}</code> <code>{{uie_weather}}</code> <code>{{uie_money}}</code> <code>{{uie_state}}</code>.`],
    ['fa-screwdriver-wrench', 'Troubleshooting', `Nothing tracked? Check Settings → AI &amp; Tracking and run “tracker on last message”. Something odd? Turn UIE off in the Extensions panel — SillyTavern keeps working normally. Errors are logged in the browser console with the prefix <code>[UIE]</code>.`],
];

export function open() {
    const sheet = openSheet({ id: 'help', title: 'Help', icon: 'fa-circle-question' });
    sheet.body.innerHTML = `<div class="uie-pad">${SECTIONS.map(([ic, t, b]) => `<div class="uie-card"><h4>${icon(ic)} ${t}</h4><p style="line-height:1.55;margin:0">${b}</p></div>`).join('')}
        <p class="uie-muted" style="font-size:.8rem">Universal Immersion Engine for SillyTavern — based on the design of GetfroggyHoe's <a href="https://github.com/GetfroggyHoe/Universal-Immersion-Engine-Fugue" target="_blank" rel="noopener" style="color:var(--accent)">Universal Immersion Engine (Fugue)</a>. Free to use; not for sale.</p></div>`;
    return sheet;
}
