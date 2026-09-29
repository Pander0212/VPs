# Universal Immersion Engine for SillyTavern

An RPG / visual-novel game layer for normal SillyTavern roleplay chats — built for **phones first**.
Inventory, map & travel, NPCs, organizations, calendar & schedules, quests, a diary, a phone,
battles, a helper pet and more. The AI narrates; **the extension keeps the numbers**, and
everything **rolls back correctly when you swipe, edit or delete** a message.

- Plain SillyTavern extension: no build step, no npm packages, no external CDNs, no Python backend.
- Uses SillyTavern's own model connection, TTS and Image Generation extensions.
- Every campaign is saved **inside its chat** — switching chats switches campaigns.
- One switch turns the whole thing off; SillyTavern keeps working normally.

Based on the design of GetfroggyHoe's [Universal Immersion Engine (Fugue)](https://github.com/GetfroggyHoe/Universal-Immersion-Engine-Fugue) — see [Credits & license](#credits--license).

---

## Install (on your phone)

You need SillyTavern **1.12 or newer** (tested on 1.19).

1. Open SillyTavern and tap the **Extensions** icon (the stacked cubes 🧊 in the top bar).
2. Tap **Install extension**.
3. Paste this URL:
   ```
   https://github.com/Pander0212/VPs
   ```
4. In **Branch or tag name (optional)** type:
   ```
   uie
   ```
5. Tap **Install just for me** (or **Install**), then confirm **Yes, install it**.
6. Wait for the "installed successfully" message, then **reload the page**.
7. A round compass button appears above the send bar. Tap it. 🎉

No other steps are needed. Updates install automatically when SillyTavern checks for
extension updates (or tap *Manage extensions → Update*).

> If the branch is later merged into `main`, step 4 can be left empty. The extension folder will
> be called `VPs` — that's fine, nothing depends on the folder name.

## First steps

1. Open (or start) a chat with a character. Each chat is its own campaign.
2. Tap the compass → **New Game** (optional): name, class, bars, trackers, items, quests,
   NPCs, starting location, lorebook. Leave anything empty and tap **AI fill the rest**.
3. Just roleplay. After every AI reply UIE works out what changed and shows a small toast like
   `+1 Iced Lemon Tea · 20 min passed · Hunger −10`.
4. Tap the thin **status strip** at the top to expand it (bars, trackers, status, quick links).

## The tools

Open everything from the **Command Deck** (compass button, the wand menu entry
*Immersion Engine*, or `/uie`).

| Section | Tool | What it does |
|---|---|---|
| Story | **Journal** | Quests with objectives; active / completed / failed. |
| | **Diary** | Open-book diary (two pages in landscape, one column in portrait): fonts incl. a script font, bold/italic/underline, size, colour, emoji stickers, polaroid photos (compressed uploads or images SillyTavern generated in the chat), previous/next/new page, copy, clear. |
| | **Map** | World / Region / Local / Nearby / Area tiers, procedural SVG maps in Fantasy / Modern City / Sci-fi style, colour-coded pins (You, Target, Station/Dock, Vehicle/Ship, Danger, Service, Interior), pinch-zoom & pan. Tap a pin for description, customs, reputation, travel mode, "About 7 min away / 3 energy", **Move To Area**, **Open Area**, paths from here. **Ask AI To Expand** invents nearby places ("Unknown Nearby" until visited), **Place a Landmark** adds your own. |
| | **Organizations** | Atlas + dossier (Info / Members / Influence / Rules / Run-ins). Standing labels are computed: <15 Enemy, <35 Hostile, <65 Neutral, ≥65 Friendly. |
| | **Activities** | Sleep, nap, work, train, cook, bathe, study, explore — advance time and change needs by fixed rules. |
| | **Battle** | Deterministic turn-based combat: initiative, attack, power strike, spells, heal, poison, stun, defend, items, flee; HP/AP/MP costs; status effects; log. The story can start a battle; the result is posted back to chat. |
| Character | **Persona** | Extends your ST persona: title, age, age stage, phone number, portrait, expressions, **lineage** (family tree), engine overrides (bar maxima, visible trackers). |
| | **Inventory** | Category filter, search, pinned equipped/quick row, item cards with quantity badges, item sheet with Use / Equip / Drop / Give / Edit. Using food/drink applies its effects (e.g. Hunger +25). |
| | **Characters** | Data stored on the ST character card: drives, organizations, per-character chat rules (injected while you chat with them) and a TTS voice id. |
| | **Party** | Companions with roles, stats and equipment slots; they fight with you. |
| | **Social** | Affection / trust / standing meters, relationship label, shared memories. |
| World | **Databank** | Facts learned during the campaign; searchable, taggable; the most relevant ones are reminded to the AI. |
| | **Phone** | Contacts are your NPCs. Text them — replies are generated in character and stay on the phone. *Summarize* puts a summary into the Databank so the story knows. |
| | **Add NPC** | NPC manager (parchment cards): name, role, title, age, map location, appearance, personality, organizations, rumors, secrets, schedule, notes, **lock** (the AI never changes a locked NPC), import from a character card, AI generate, merge duplicates. |
| | **Calendar** | Month grid with events, birthdays and reminders; date format, custom month names, day length (turn-based or real-time); **Schedules** tab shows where every NPC is right now. |
| | **Atmosphere** | Weather and time-of-day tint + light CSS rain/snow behind the chat (can be turned off). |
| | **Helper** | A little helper pet (🦊 by default). Ask it anything about your game; it can propose items, quests, status effects… which are only applied after you tap **Apply**. It never posts into the main chat. |
| System | **New Game**, **Settings**, **Help**, **Save / Export** | |

Optional extras (Settings → General): **visual-novel stage** for the last AI message, narrator
notes when you travel or do activities, launcher position, theme (dark glass, parchment, midnight).
If SillyTavern's Image Generation extension is active you also get *Portrait*, *Scene image* and
*Item icon* buttons.

## How tracking works

- **Separate pass (default):** after each AI reply UIE makes one small extra call with the last
  1–3 messages and asks only for a JSON list of *ops* (`item.add`, `time.advance`,
  `tracker.delta`, `npc.upsert`, `location.move`, `quest.update`…). Every op is checked against a
  whitelist, numbers are clamped, and code applies it.
- **Inline tags:** the model appends `<uie>{…}</uie>` to its reply; UIE removes the tag from the
  message before you see it and applies it. No extra call.
- **Off:** nothing automatic — you manage things by hand.
- **Rules live in code:** the clock, need decay over time, travel time and energy, standing labels,
  item quantities, battle math and schedule-based NPC locations.
- **Swipes / edits / deletes:** each message's changes are recorded. Swipe → rolled back.
  Swipe back → restored from history without another AI call. Delete → rolled back. Edit →
  rolled back and re-tracked. If you changed something by hand in between, your edit is kept.
- **Name dedupe:** "Tobias" and "Tobias Moreno" are the same person (first names, case,
  accents, small typos).
- Before every generation UIE injects a compact state summary (time, weather, place and exits,
  vitals, people present, party, quests, relevant organizations and facts) within a token budget
  (default 600).

## Recommended settings for cheap / free APIs

| Situation | Setting |
|---|---|
| Rate-limited free API | Settings → AI & Tracking → **Mode: Inline tags** (no extra call) |
| Very small / weak model | **Mode: Off**, use the tools by hand; keep injection on |
| Small context (4–8k) | **Token budget: 300–400** |
| Slow backend | Raise **AI call timeout** to 90–120 s |
| Anything | **Messages sent to the tracker pass: 1** is cheapest; 2 is a good balance |

## Back up your campaign

The campaign is stored inside the chat file, so SillyTavern's own chat backups include it.
For an extra copy: **Command Deck → Save / Export → Export JSON** (downloads a file on your
phone). **Import JSON** restores it into any chat. The Extensions panel drawer has the same
buttons.

## Slash commands & macros

`/uie` · `/uie-map` · `/uie-inv` · `/uie-journal` · `/uie-diary` · `/uie-npcs` · `/uie-calendar` ·
`/uie-orgs` · `/uie-phone` · `/uie-battle` · `/uie-helper` · `/uie-settings` · `/uie-pass`
(re-run the tracker on the last AI reply)

Macros for your prompts / character cards: `{{uie_location}}` `{{uie_time}}` `{{uie_date}}`
`{{uie_weather}}` `{{uie_money}}` `{{uie_state}}`

## Known limits

- The tracker is only as good as your model. Weak models may miss things — everything is
  editable by hand, and inline mode needs a model that follows formatting instructions.
- Rollback covers AI-made changes. Your own manual edits are never undone.
- Swipe history replay covers the last few messages; very old swipes are not replayed.
- If you switch chats within ~0.4 s of changing something, that last change can be lost
  (SillyTavern cancels pending saves on chat switch; UIE saves immediately on the next tap
  anywhere in SillyTavern to avoid this).
- Diary photos are compressed to ≤200 KB each (max 6 per page) to keep chat files small.
- Voice assignment writes the voice id into SillyTavern's TTS voice map; the list of voices is
  read from the TTS settings panel (open it once if the list is empty) — or type the id.
- Maps are procedural art, not real geography.
- No local AI models are bundled (no Kokoro / ONNX); use SillyTavern's TTS and image extensions.

## Troubleshooting

- **No compass button:** Extensions panel → *Universal Immersion Engine* → make sure **Enable
  UIE** is on; reload the page.
- **Nothing gets tracked:** Settings → AI & Tracking → run *tracker on last AI message now*.
  Make sure an API is connected. With inline mode, check that your model actually writes the tag.
- **Too many toasts:** Settings → General → turn off *Show a toast listing state changes*.
- **Something looks wrong:** turn UIE off — SillyTavern returns to normal. Errors are logged in
  the browser console with the prefix `[UIE]`.
- **Start over for one chat:** Settings → General → *Reset this chat's campaign*.

## Development

```
npm test                        # unit tests (node --test), no dependencies
ST_URL=http://127.0.0.1:8000/ PW_DIR=/path/to/dir/with/playwright npm run e2e
```

The e2e suite runs against a real SillyTavern server with the extension installed, mocks the
model inside the page (valid JSON, messy JSON, garbage, errors), simulates swipes / edits /
deletes / chat switches, and checks four viewports (iPhone 390×844, Android 360×800,
landscape 844×390, desktop 1280×800). Layout:

```
index.js            boot (waits for APP_READY), settings drawer, wand entry, master toggle
style.css           all styles; dark glass + parchment themes
src/st-adapter.js   the only file that touches SillyTavern internals
src/state.js        per-chat campaign store + global settings
src/core.js         event wiring, rollback reconciliation, prompt injection, macros, slash commands
src/engine/         pure deterministic rules (time, map/travel, ops, ledger, battle, schedules, dedupe)
src/ai/             prompts, JSON extraction/repair, context compiler, tracker pass, queue
src/ui/             one file per panel + sheet/dialog components
tests/              unit tests + Playwright e2e
```

## Credits & license

Design, feature set and look are based on **Universal Immersion Engine (Fugue)** by
**GetfroggyHoe** — <https://github.com/GetfroggyHoe/Universal-Immersion-Engine-Fugue>.
This SillyTavern extension is a separate re-implementation and is **not** an official
GetfroggyHoe release.

Distributed under the **GetfroggyHoe Free Frontend License 1.0** (full text in
[LICENSE.md](LICENSE.md)): free to use, modify and share; **selling or paywalling it is not
allowed**. Copyright (c) 2026 GetfroggyHoe.
