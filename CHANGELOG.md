# Changelog & status

## 1.0.0 — first release

### Done
**Core (Tier 1)**
- SillyTavern third-party extension, no build step, no dependencies; installs from the Git URL.
- `src/st-adapter.js` wraps every ST call (generation, injection, macros, slash commands,
  metadata, character fields, TTS, image generation) with version fallbacks.
- Per-chat campaign state in `chatMetadata.uie` (schema v2 + migrations), global settings in
  `extensionSettings.uie`, export / import / reset.
- Tracker pass: separate quiet call (default) or inline `<uie>` tags, op whitelist + clamping,
  robust JSON extraction/repair with one repair retry, serial AI queue with timeouts.
- Per-message diff ledger: swipe / delete / edit roll back cleanly, swipe-back replays from
  history, manual edits are never clobbered (conflict guard).
- Context injection with token budget and relevance ranking; `{{uie_*}}` macros; `/uie*` commands.
- Command Deck, movable launcher, collapsible HUD, settings drawer + full settings sheet with a
  prompt-template editor, master Enable toggle.
- Inventory with categories, search, quick row, equipment, item sheet (use / equip / drop / give / edit).

**World (Tier 2)**
- Procedural SVG map (3 styles), 5 tiers, typed pins, legend, pinch/pan zoom, travel side panel,
  deterministic travel time/energy/fare, Move To Area, Open Area, AI expand, landmarks.
- NPC manager (lock, schedule, ST card import, AI generation, duplicate merge).
- Calendar (events, birthdays, reminders, formats, custom month names, turn / real-time day
  length) + NPC Schedules.
- Organizations atlas + dossier with code-computed standing labels.
- Journal (quests/objectives) and Databank (facts, tags, pinning, relevance-fed injection).

**Character & flavor (Tier 3)**
- Persona Studio (identity, expressions, lineage tree, engine overrides), Social meters & memories,
  Helper Pet with confirm-before-apply ops, Diary (book layout, rich text, stickers, polaroids),
  New Game wizard with AI fill, Characters panel (card fields + TTS voice), Phone texting,
  Atmosphere overlay, Party, deterministic Battle, Activities, optional VN stage, image
  generation hooks (portrait / scene / item icon) when ST's Image Generation extension is on.

**Tests**
- 28 unit tests (engine + AI parsing) with `node --test`.
- Playwright e2e against a real SillyTavern 1.19 server with mocked generation: ~90 checks per
  viewport (iPhone 390×844, Android 360×800, landscape 844×390, desktop 1280×800).

### Partial
- **Voice assignment:** writes the voice id to ST's TTS voice map; voice list is read from the
  TTS settings DOM (may be empty until that panel has been opened once). No voice preview.
- **Expressions:** uploaded images only; not wired to ST's Character Expressions extension.
- **Swipe-back replay** covers the last 3 messages (older swipes are not replayed).
- **iOS Safari:** tested with WebKit-like viewport sizes and touch emulation in Chromium; not on a
  real WebKit engine.
- **Real-time clock** ticks every 20 s while the tab is visible (no background ticking).

### Next ideas
- Drag-and-drop pin placement and path drawing on the map.
- Shops with prices and a trade screen; crafting from inventory items.
- Group-chat aware "present NPCs" from the active group members.
- Per-location lorebook activation (map node → World Info entry).
- A compact "turn summary" message option instead of toasts.
