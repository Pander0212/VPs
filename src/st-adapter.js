// The ONLY module that touches SillyTavern internals. Everything goes through
// SillyTavern.getContext(); version-sensitive calls are wrapped with fallbacks.
// Tests replace functions on the exported `st` object (st.generateRaw = mock).

export const EXT_ID = 'uie';
export const LOG = '[UIE]';

function ctx() {
    try {
        return globalThis.SillyTavern?.getContext?.() ?? null;
    } catch (e) {
        console.error(LOG, 'getContext failed', e);
        return null;
    }
}

const PROMPT_KEY = 'uie_state';
let metaDirty = false;
let metaChat = null;
let metaTimer = null;
const INLINE_KEY = 'uie_inline';

export const st = {
    ctx,
    log: (...a) => console.log(LOG, ...a),
    warn: (...a) => console.warn(LOG, ...a),
    error: (...a) => console.error(LOG, ...a),

    get ready() { return !!ctx(); },

    /** Extension base URL (for loading nothing heavy; kept for completeness). */
    folder() {
        try {
            const url = new URL(import.meta.url);
            return url.pathname.replace(/\/src\/st-adapter\.js$/, '');
        } catch { return ''; }
    },

    // ---------------------------------------------------------------- events
    eventTypes() { return ctx()?.eventTypes ?? ctx()?.event_types ?? {}; },

    /** Subscribe; handler errors are caught so ST never breaks. Returns unsubscribe. */
    on(name, handler) {
        const c = ctx();
        const type = c?.eventTypes?.[name] ?? name;
        if (!c?.eventSource || !type) return () => {};
        const wrapped = async (...args) => {
            try { return await handler(...args); } catch (e) { st.error(`handler ${name} failed`, e); }
        };
        c.eventSource.on(type, wrapped);
        return () => { try { c.eventSource.removeListener?.(type, wrapped); } catch { /* ignore */ } };
    },

    // ---------------------------------------------------------------- chat
    chat() { return ctx()?.chat ?? []; },
    chatId() {
        const c = ctx();
        try { return c?.getCurrentChatId?.() ?? c?.chatId ?? null; } catch { return c?.chatId ?? null; }
    },
    meta() { return ctx()?.chatMetadata ?? null; },
    /**
     * Save chat metadata soon. ST's own saveMetadataDebounced() is cancelled by clearChat() when
     * the user switches chats, which silently drops the last edit. We use a short debounce with
     * an immediate save instead, and flush on the next tap anywhere outside UIE (see flushOnTap).
     */
    saveMeta() {
        metaDirty = true;
        metaChat = st.chatId();
        clearTimeout(metaTimer);
        metaTimer = setTimeout(() => st.flushMeta(), 400);
    },
    flushMeta() {
        clearTimeout(metaTimer);
        if (!metaDirty) return;
        metaDirty = false;
        if (st.chatId() !== metaChat) { st.warn('chat changed before save; skipped'); return; }
        const c = ctx();
        try {
            const r = c?.saveMetadata ? c.saveMetadata() : c?.saveMetadataDebounced?.();
            if (r?.catch) r.catch(e => st.error('saveMetadata failed', e));
        } catch (e) { st.error('saveMetadata failed', e); }
    },
    /** Capture-phase listener: any tap on ST's own UI flushes pending UIE saves first. */
    flushOnTap(e) {
        if (!metaDirty) return;
        const t = e.target;
        if (t?.closest?.('.uie-scope, .uie-sheet, .uie-dialog, #uie-overlay')) return;
        st.flushMeta();
    },
    async saveMetaNow() {
        try { await ctx()?.saveMetadata?.(); } catch (e) { st.error('saveMetadata failed', e); }
    },
    async saveChat() {
        try { await ctx()?.saveChat?.(); } catch (e) { st.error('saveChat failed', e); }
    },
    rerenderMessage(id) {
        const c = ctx();
        try {
            const msg = c?.chat?.[id];
            if (msg && c?.updateMessageBlock) c.updateMessageBlock(id, msg);
        } catch (e) { st.error('updateMessageBlock failed', e); }
    },
    userName() { return ctx()?.name1 ?? 'You'; },
    charName() { return ctx()?.name2 ?? ''; },
    characterId() { return ctx()?.characterId; },
    groupId() { return ctx()?.groupId ?? null; },
    characters() { return ctx()?.characters ?? []; },
    currentCharacter() {
        const c = ctx();
        const id = c?.characterId;
        return id !== undefined && id !== null ? c.characters?.[id] ?? null : null;
    },
    isMobile() {
        try { return !!ctx()?.isMobile?.() || matchMedia('(max-width: 768px)').matches; } catch { return false; }
    },

    // ---------------------------------------------------------------- settings
    settingsRoot() {
        const c = ctx();
        if (!c?.extensionSettings) return null;
        if (!c.extensionSettings[EXT_ID]) c.extensionSettings[EXT_ID] = {};
        return c.extensionSettings[EXT_ID];
    },
    setSettings(obj) {
        const c = ctx();
        if (c?.extensionSettings) c.extensionSettings[EXT_ID] = obj;
    },
    saveSettings() {
        try { ctx()?.saveSettingsDebounced?.(); } catch (e) { st.error('saveSettings failed', e); }
    },

    // ---------------------------------------------------------------- generation
    /** Raw generation without chat history (cheap). Signature changed in ST 1.12 -> object form. */
    async generateRaw(prompt, systemPrompt = '', { responseLength = 400 } = {}) {
        const c = ctx();
        if (!c?.generateRaw) throw new Error('generateRaw unavailable');
        try {
            return await c.generateRaw({ prompt, systemPrompt, responseLength });
        } catch (e) {
            // Older builds: positional (prompt, api, instructOverride, quietToLoud, systemPrompt, responseLength)
            if (/positional|not a function|undefined/i.test(String(e?.message))) {
                return await c.generateRaw(prompt, null, false, false, systemPrompt, responseLength);
            }
            throw e;
        }
    },

    /** Quiet generation WITH chat context. Newer builds take an options object. */
    async generateQuiet(quietPrompt, { responseLength = 400, skipWIAN = false } = {}) {
        const c = ctx();
        if (!c?.generateQuietPrompt) throw new Error('generateQuietPrompt unavailable');
        try {
            return await c.generateQuietPrompt({ quietPrompt, skipWIAN, responseLength, removeReasoning: true });
        } catch (e) {
            if (/positional|not a function/i.test(String(e?.message))) return await c.generateQuietPrompt(quietPrompt, false, skipWIAN);
            throw e;
        }
    },

    // ---------------------------------------------------------------- injection
    promptTypes() {
        return { NONE: -1, IN_PROMPT: 0, IN_CHAT: 1, BEFORE_PROMPT: 2 };
    },
    injectPrompt(text, { position = 1, depth = 2, role = 0, key = PROMPT_KEY } = {}) {
        const c = ctx();
        try { c?.setExtensionPrompt?.(key, String(text ?? ''), Number(position), Number(depth), false, Number(role)); } catch (e) { st.error('setExtensionPrompt failed', e); }
    },
    clearPrompts() {
        st.injectPrompt('', { key: PROMPT_KEY });
        st.injectPrompt('', { key: INLINE_KEY });
    },
    injectInline(text, { depth = 0, role = 0 } = {}) {
        st.injectPrompt(text, { key: INLINE_KEY, position: 1, depth, role });
    },
    readInjected(key = PROMPT_KEY) {
        return ctx()?.extensionPrompts?.[key]?.value ?? '';
    },

    // ---------------------------------------------------------------- macros + slash commands
    registerMacro(name, fn, description = '') {
        const c = ctx();
        try {
            if (c?.macros?.register) {
                c.macros.register(name, { handler: () => String(fn() ?? ''), description });
                return true;
            }
            if (c?.registerMacro) { c.registerMacro(name, () => String(fn() ?? ''), description); return true; }
        } catch (e) { st.warn('macro registration failed', name, e); }
        return false;
    },

    registerSlash(name, callback, helpString, aliases = []) {
        const c = ctx();
        try {
            if (c?.SlashCommandParser?.addCommandObject && c?.SlashCommand?.fromProps) {
                const args = c.SlashCommandArgument?.fromProps
                    ? [c.SlashCommandArgument.fromProps({ description: 'optional argument', typeList: [c.ARGUMENT_TYPE?.STRING ?? 'string'], isRequired: false })]
                    : [];
                c.SlashCommandParser.addCommandObject(c.SlashCommand.fromProps({
                    name, aliases, helpString, returns: 'nothing',
                    unnamedArgumentList: args,
                    callback: async (_named, unnamed) => { try { await callback(String(unnamed ?? '')); } catch (e) { st.error(`/${name} failed`, e); } return ''; },
                }));
                return true;
            }
            if (c?.registerSlashCommand) { c.registerSlashCommand(name, (_a, v) => { callback(String(v ?? '')); return ''; }, aliases, helpString); return true; }
        } catch (e) { st.warn('slash registration failed', name, e); }
        return false;
    },

    async runSlash(command) {
        const c = ctx();
        if (c?.executeSlashCommandsWithOptions) return await c.executeSlashCommandsWithOptions(command, { handleParserErrors: true, handleExecutionErrors: true });
        if (c?.executeSlashCommands) return await c.executeSlashCommands(command);
        throw new Error('slash commands unavailable');
    },

    hasSlash(name) {
        try { return !!ctx()?.SlashCommandParser?.commands?.[name]; } catch { return false; }
    },

    /** Post a narrator (system) note into chat. */
    async narrate(text) {
        const safe = String(text ?? '').replace(/\|/g, '/').replace(/[{}]{2}/g, '');
        try { await st.runSlash(`/sys ${safe}`); } catch (e) { st.error('narrate failed', e); }
    },

    // ---------------------------------------------------------------- characters / personas
    async writeCharField(key, value, charId = ctx()?.characterId) {
        const c = ctx();
        if (charId === undefined || charId === null) throw new Error('No character selected');
        if (!c?.writeExtensionField) throw new Error('writeExtensionField unavailable');
        await c.writeExtensionField(charId, key, value);
    },
    readCharField(key, charId = ctx()?.characterId) {
        return ctx()?.characters?.[charId]?.data?.extensions?.[key];
    },
    avatarUrl(char) {
        const c = ctx();
        if (!char?.avatar) return '';
        try { return c?.getThumbnailUrl ? c.getThumbnailUrl('avatar', char.avatar) : `/characters/${encodeURIComponent(char.avatar)}`; } catch { return ''; }
    },
    personas() {
        const pu = ctx()?.powerUserSettings;
        return { names: pu?.personas ?? {}, descriptions: pu?.persona_descriptions ?? {} };
    },
    /** Active persona avatar id (best effort; ST does not expose it via getContext). */
    activePersonaId() {
        try {
            const sel = document.querySelector('#user_avatar_block .avatar-container.selected');
            if (sel?.getAttribute('data-avatar-id')) return sel.getAttribute('data-avatar-id');
        } catch { /* ignore */ }
        const { names } = st.personas();
        const n = st.userName();
        return Object.keys(names).find(k => names[k] === n) || '';
    },
    personaAvatarUrl(id = st.activePersonaId()) {
        if (!id) return '';
        try { return ctx()?.getThumbnailUrl?.('persona', id) ?? `/User Avatars/${encodeURIComponent(id)}`; } catch { return ''; }
    },
    worldNames() {
        try { return ctx()?.getWorldInfoNames?.() ?? []; } catch { return []; }
    },

    // ---------------------------------------------------------------- other extensions
    extensionActive(name) {
        const c = ctx();
        const disabled = c?.extensionSettings?.disabledExtensions ?? [];
        return !disabled.includes(name);
    },
    sdAvailable() {
        return st.extensionActive('stable-diffusion') && (st.hasSlash('sd') || st.hasSlash('imagine'));
    },
    /** Generate an image through ST's Image Generation extension. Returns an image URL or ''. */
    async generateImage(prompt, { quiet = true } = {}) {
        const cmd = st.hasSlash('sd') ? 'sd' : 'imagine';
        const safe = String(prompt ?? '').replace(/\|/g, ' ').replace(/[{}]{2}/g, '').slice(0, 900);
        const res = await st.runSlash(`/${cmd} quiet=${quiet ? 'true' : 'false'} ${safe}`);
        const out = typeof res === 'string' ? res : res?.pipe;
        return typeof out === 'string' ? out.trim() : '';
    },
    ttsInfo() {
        const tts = ctx()?.extensionSettings?.tts;
        if (!tts) return null;
        const provider = tts.currentProvider;
        return { provider, map: tts[provider]?.voiceMap ?? {}, enabled: !!tts.enabled };
    },
    /** Voice ids that the TTS settings UI currently lists (best effort, read from DOM). */
    ttsVoices() {
        const out = new Set();
        try {
            document.querySelectorAll('#tts_voicemap_block select option, .tts_voicemap_block_char select option').forEach(o => { if (o.value && o.value !== 'disabled') out.add(o.value); });
        } catch { /* ignore */ }
        const info = st.ttsInfo();
        if (info?.map && typeof info.map === 'object') Object.values(info.map).forEach(v => { if (typeof v === 'string' && v) out.add(v); });
        return [...out].filter(v => !/^\[.*\]$/.test(v));
    },
    setTtsVoice(charName, voiceId) {
        const c = ctx();
        const tts = c?.extensionSettings?.tts;
        if (!tts?.currentProvider) throw new Error('TTS extension is not configured');
        const p = tts.currentProvider;
        tts[p] = tts[p] || {};
        if (typeof tts[p].voiceMap !== 'object' || !tts[p].voiceMap) tts[p].voiceMap = {};
        tts[p].voiceMap[charName] = voiceId;
        st.saveSettings();
    },
};

export default st;
