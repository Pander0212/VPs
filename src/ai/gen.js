// Generation helpers: prompt templates (with user overrides), JSON generation with a
// single repair retry, and recent-chat formatting.

import { st } from '../st-adapter.js';
import { enqueue } from './queue.js';
import { extractJson } from './json.js';
import { DEFAULT_PROMPTS, fillTemplate } from './prompts.js';
import { settingsGet } from '../state.js';
import { stripTags } from '../engine/ledger.js';

export function template(key) {
    const o = settingsGet().prompts?.[key];
    return typeof o === 'string' && o.trim() ? o : DEFAULT_PROMPTS[key];
}

export function render(key, vars) {
    return fillTemplate(template(key), { user: st.userName(), char: st.charName(), ...vars });
}

/** Last `n` visible messages up to index `upTo` (inclusive), formatted "Name: text". */
export function recentMessages(n = 3, upTo = null, maxChars = 1800) {
    const chat = st.chat();
    const end = upTo === null ? chat.length - 1 : Math.min(upTo, chat.length - 1);
    const out = [];
    for (let i = end; i >= 0 && out.length < n; i--) {
        const m = chat[i];
        if (!m || m.is_system && !m.extra?.type) continue;
        const body = stripTags(m.mes).replace(/\s+/g, ' ').trim();
        if (!body) continue;
        out.unshift(`${m.name || (m.is_user ? st.userName() : st.charName())}: ${body}`);
    }
    let txt = out.join('\n\n');
    if (txt.length > maxChars * n) txt = txt.slice(-maxChars * n);
    return txt;
}

function timeoutMs() {
    return Math.max(10, Number(settingsGet().trackerTimeoutSec) || 60) * 1000;
}

/** Plain text generation through the queue. */
export function genText(prompt, { system = '', responseLength = 400, label = 'AI call', withChat = false } = {}) {
    return enqueue(async () => {
        const out = withChat ? await st.generateQuiet(prompt, { responseLength }) : await st.generateRaw(prompt, system, { responseLength });
        return String(out ?? '');
    }, { timeoutMs: timeoutMs(), label });
}

/**
 * Generate and parse JSON; one repair retry if the first answer is unparseable.
 * @returns {Promise<{value:any, raw:string}>}
 */
export async function genJson(prompt, { system = '', responseLength = 600, label = 'AI call' } = {}) {
    const raw = await genText(prompt, { system, responseLength, label });
    let value = extractJson(raw);
    if (value !== undefined) return { value, raw };
    const fix = `The following text was supposed to be a single valid JSON value but is malformed. Output ONLY the corrected JSON, nothing else.\n\n${String(raw).slice(0, 3000)}`;
    const raw2 = await genText(fix, { responseLength, label: `${label} (repair)` });
    value = extractJson(raw2);
    if (value === undefined) throw new Error('Model did not return valid JSON');
    return { value, raw: raw2 };
}
