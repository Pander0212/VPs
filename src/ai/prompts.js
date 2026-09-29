// Default prompt templates. Users can override any of them in Settings → Prompt templates.
// Placeholders: {{state}} {{messages}} {{user}} {{char}} {{request}} {{extra}}

export const OP_SCHEMA = `Allowed ops (use only what the text clearly implies; omit anything uncertain):
{"op":"time.advance","minutes":20}
{"op":"weather.set","kind":"rain"}
{"op":"item.add","name":"Iced Lemon Tea","qty":1,"cat":"drink"}   cat: food|drink|clothing|key|tool|weapon|armor|book|misc
{"op":"item.remove","name":"Iced Lemon Tea","qty":1}
{"op":"item.use","name":"Bread"}
{"op":"currency.delta","amount":-5}
{"op":"tracker.delta","id":"hunger","value":-10}      ids: {{trackers}}
{"op":"bar.delta","id":"hp","value":-8}               ids: hp|ap|mp|xp
{"op":"status.add","name":"Soaked","desc":"cold and wet","minutes":60}
{"op":"status.remove","name":"Soaked"}
{"op":"npc.upsert","name":"Tobias Moreno","role":"Bassist","location":"Rehearsal studio","appearance":"...","present":true}
{"op":"npc.move","name":"Tobias","to":"Market"}
{"op":"rel.delta","name":"Tobias","affection":3,"trust":2}
{"op":"rel.memory","name":"Tobias","text":"Shared lemonade after practice"}
{"op":"org.upsert","org":"Night Market Guild","type":"guild","purpose":"..."}
{"op":"org.standing","org":"Night Market Guild","delta":5}
{"op":"org.runin","org":"Night Market Guild","text":"Paid the stall fee"}
{"op":"location.move","to":"Old Horizon Gate","kind":"gate"}
{"op":"location.add","name":"Foggy Marsh","kind":"wilds/forest"}
{"op":"quest.add","title":"Find a lead vocalist","objectives":["Ask around the market"]}
{"op":"quest.update","title":"Find a lead vocalist","objective":"Ask around the market","done":true}
{"op":"databank.add","title":"Horizon Gate","text":"Opens only at dusk","tags":["lore"]}
{"op":"event.add","title":"Concert","inDays":3}
{"op":"battle.start","enemies":[{"name":"Bandit","hp":30,"atk":7}]}`;

export const DEFAULT_PROMPTS = {
    tracker: `You are the state tracker for a roleplay game. Read the latest messages and output ONLY what changed in the game state as JSON: {"ops":[...]}.
Rules:
- Output a single JSON object and nothing else. No prose, no code fences.
- Only record concrete, stated events (items gained/used/lost, money spent, time passing, moving somewhere, meeting people, relationship shifts, quests, injuries). If nothing changed, output {"ops":[]}.
- Estimate time.advance for the scene if time clearly passed (a conversation ≈ 5-20 min). Do not invent large jumps.
- Hunger/energy decay over time is automatic; only add tracker.delta for explicit events (eating, exhaustion, bathing).
- Use existing names from the current state when referring to known people, items and places.

${OP_SCHEMA}

CURRENT STATE:
{{state}}

LATEST MESSAGES:
{{messages}}

JSON:`,

    inline: `[Game engine: after your reply, append a hidden state update in this exact form on its own line: <uie>{"ops":[...]}</uie> . Include only concrete changes that happened in your reply (items, money, time, location, people met, relationship shifts, quests). Use {"ops":[]} if nothing changed. Op examples: {"op":"time.advance","minutes":15} {"op":"item.add","name":"Bread","qty":1} {"op":"currency.delta","amount":-3} {"op":"tracker.delta","id":"hunger","value":20} {"op":"npc.upsert","name":"Mira","role":"Baker"} {"op":"rel.delta","name":"Mira","affection":2} {"op":"location.move","to":"Bakery"} {"op":"quest.add","title":"..."} {"op":"databank.add","title":"...","text":"..."}]`,

    helper: `You are {{pet}}, a small, witty helper companion inside a roleplay game UI. You never speak in the story itself. You answer questions about the game state, suggest ideas, and can generate game content.
If the user asks you to create or change something (items, skills, quests, status effects, NPCs, places, facts), ALSO append a JSON block at the very end: <uie>{"ops":[...]}</uie> using only these ops. The user will confirm before anything is applied.
${OP_SCHEMA}

GAME STATE:
{{state}}

RECENT STORY:
{{messages}}

USER: {{request}}
{{pet}}:`,

    mapExpand: `Invent {{count}} new places near "{{place}}" ({{tier}} scale, style: {{style}}) for a roleplay world. Existing places: {{existing}}.
Story context: {{messages}}
Return ONLY JSON: {"places":[{"name":"...","kind":"e.g. market / wilds/forest / station / interior / danger","desc":"one sentence","customs":"one short local custom","danger":false}]}`,

    npcGen: `Create a believable NPC for this roleplay. {{request}}
World context: {{state}}
Return ONLY JSON: {"name":"","role":"","title":"","age":"","appearance":"","personality":"","rumors":"","secrets":"","schedule":"08:00-17:00 Place: activity\\n17:00-22:00 Place: activity","notes":""}`,

    phone: `You are {{npc}} texting {{user}} on a phone in a roleplay story. Stay in character: {{persona}}.
Relationship: {{rel}}. Current time: {{time}}.
Recent text thread:
{{thread}}
Recent story events (for awareness, don't retell): {{messages}}
Reply with 1-3 short text messages as {{npc}}, casual texting style, no narration, no quotes. Separate multiple texts with a new line.`,

    phoneSummary: `Summarize this text conversation between {{user}} and {{npc}} in 1-2 sentences for story continuity:
{{thread}}`,

    fill: `Fill in the missing parts of a new roleplay campaign setup. Keep everything consistent with what is given.
GIVEN (JSON): {{extra}}
Story/character context: {{messages}}
Return ONLY JSON with any of these keys you can fill: {"name":"","cls":"","appearance":"","currencyName":"","startLocation":{"name":"","kind":"","desc":""},"region":"","world":"","items":[{"name":"","qty":1,"cat":"misc"}],"skills":[{"name":"","desc":""}],"quests":[{"title":"","desc":""}],"npcs":[{"name":"","role":"","appearance":"","personality":""}],"opening":"one paragraph opening narration"}`,

    orgGen: `Create an organization for this roleplay world. {{request}}
World context: {{state}}
Return ONLY JSON: {"name":"","type":"guild|gang|company|order|government|family|cult|club","purpose":"","leaderTitle":"","rules":"","scale":"local|regional|world"}`,
};

export function fillTemplate(tpl, vars) {
    return String(tpl ?? '').replace(/\{\{(\w+)\}\}/g, (m, k) => (vars[k] !== undefined && vars[k] !== null ? String(vars[k]) : ''));
}
