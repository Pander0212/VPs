// Calendar (parchment): month grid with events/birthdays/reminders, settings (date format,
// custom month names, day length / real-time mode, set clock), and NPC Schedules tab.

import { S, bus, mutate, userOps } from '../state.js';
import { openSheet, formDialog, confirmDialog } from './sheet.js';
import { esc, icon, opt, reportError } from './dom.js';
import { toParts, daysInMonth, monthName, WEEKDAYS, isoDate, formatTime, formatDate, dateToMinutes, pad2, parseHHMM, humanDuration } from '../engine/time.js';
import { npcWhereabouts, activeBlock } from '../engine/schedules.js';
import { uid, str } from '../engine/util.js';
import { startRealtime } from '../core.js';
import { editNpc } from './npcs.js';

export function open(params = {}) {
    const sheet = openSheet({ id: 'calendar', title: 'Calendar', icon: 'fa-calendar-days', theme: 'parchment' });
    const p0 = toParts(S().clock.t, S().calendar.epoch);
    const view = { tab: params.tab || 'calendar', y: p0.y, m: p0.m, sel: isoDate(p0) };

    const render = () => {
        const s = S();
        const cal = s.calendar;
        const now = toParts(s.clock.t, cal.epoch);
        const here = s.map.nodes[s.map.location];
        sheet.setTitle(`${monthName(view.m, cal.monthNames)} ${view.y}`);
        let body = `
            <div class="uie-cal-sub"><span>${icon('fa-globe')} ${esc(here?.name || '')}</span><span>${icon('fa-clock')} ${esc(formatDate(now, cal.dateFormat, cal.monthNames))} ${esc(formatTime(now, cal.h24))} · Day length: ${cal.dayMode === 'realtime' ? `${esc(cal.realMinutesPerDay)}m real time` : 'turn-based'}</span></div>
            <nav class="uie-tabs"><button class="uie-tab ${view.tab === 'calendar' ? 'active' : ''}" data-tab="calendar">${icon('fa-calendar')} Calendar</button><button class="uie-tab ${view.tab === 'schedules' ? 'active' : ''}" data-tab="schedules">${icon('fa-list-check')} Schedules</button><button class="uie-tab ${view.tab === 'settings' ? 'active' : ''}" data-tab="settings">${icon('fa-gear')} Settings</button></nav>`;

        if (view.tab === 'calendar') {
            const first = new Date(Date.UTC(view.y, view.m - 1, 1)).getUTCDay();
            const dim = daysInMonth(view.y, view.m);
            const prevDim = daysInMonth(view.m === 1 ? view.y - 1 : view.y, view.m === 1 ? 12 : view.m - 1);
            const events = Object.values(cal.events || {});
            const eventsOn = (iso) => events.filter(e => e.date === iso || (e.type === 'birthday' && e.date.slice(5) === iso.slice(5)));
            const cells = [];
            for (let i = 0; i < first; i++) cells.push({ d: prevDim - first + 1 + i, other: true });
            for (let d = 1; d <= dim; d++) cells.push({ d, iso: `${view.y}-${pad2(view.m)}-${pad2(d)}` });
            while (cells.length % 7) cells.push({ d: cells.length - dim - first + 1, other: true });
            const selEvents = eventsOn(view.sel);
            body += `
                <div class="uie-cal-head">
                    <button class="uie-icon-btn" data-c="prev" aria-label="Previous month">${icon('fa-chevron-left')}</button>
                    <h3>${esc(monthName(view.m, cal.monthNames))} ${esc(view.y)}</h3>
                    <button class="uie-icon-btn" data-c="today" aria-label="Today">${icon('fa-crosshairs')}</button>
                    <button class="uie-icon-btn" data-c="next" aria-label="Next month">${icon('fa-chevron-right')}</button>
                </div>
                <div class="uie-cal-grid">
                    ${WEEKDAYS.map(w => `<div class="uie-cal-dow">${esc(w.slice(0, 3))}</div>`).join('')}
                    ${cells.map(c => c.other ? `<div class="uie-cal-day other" aria-hidden="true">${c.d}</div>` : `<button class="uie-cal-day ${c.iso === isoDate(now) ? 'today' : ''} ${c.iso === view.sel ? 'sel' : ''}" data-day="${c.iso}" aria-label="${esc(c.iso)}"><b>${c.d}</b>${eventsOn(c.iso).slice(0, 3).map(e => `<span class="uie-cal-dot ${esc(e.type)}">${esc(e.title)}</span>`).join('')}</button>`).join('')}
                </div>
                <div class="uie-pad">
                    <div class="uie-row uie-between"><h4 style="margin:0">${esc(view.sel)}${view.sel === isoDate(now) ? ' · Today' : ''}</h4><button class="uie-btn uie-btn-sm uie-btn-primary" data-c="add">${icon('fa-plus')} Add</button></div>
                    ${selEvents.length ? selEvents.map(e => `<div class="uie-item" style="margin-top:8px"><span class="uie-emoji">${e.type === 'birthday' ? '🎂' : e.type === 'reminder' ? '🔔' : '📌'}</span><div class="uie-grow"><h4>${esc(e.title)}</h4><p>${esc(e.type)}${e.time ? ` · ${esc(e.time)}` : ''}${e.note ? ` · ${esc(e.note)}` : ''}</p></div><button class="uie-icon-btn" data-delev="${esc(e.id)}" aria-label="Delete">${icon('fa-trash')}</button></div>`).join('') : '<p class="uie-muted">Nothing planned.</p>'}
                </div>`;
        } else if (view.tab === 'schedules') {
            const npcs = Object.values(s.npcs).sort((a, b) => a.name.localeCompare(b.name));
            body += `<div class="uie-pad"><p class="uie-muted">${icon('fa-users')} Character routines for the current game time (${esc(formatTime(now, cal.h24))}, ${esc(WEEKDAYS[now.dow])}). Schedules decide where NPCs are; that feeds the map and the AI context.</p>
                ${npcs.length ? npcs.map(n => {
                    const w = npcWhereabouts(n, now);
                    const b = activeBlock(n.schedule, now.minuteOfDay, now.dow);
                    return `<div class="uie-sched" style="margin-bottom:10px">
                        <div class="uie-row uie-between uie-wrap"><h4>${esc(n.name)}</h4><span class="loc">${esc(w.loc || 'Unknown')}</span></div>
                        <div><b>${esc(b ? `${b.from}–${b.to}` : 'No current activity')}</b></div>
                        <div class="uie-muted">${esc(w.activity ? `: ${w.activity}` : n.schedule?.length ? `${n.schedule.length} block(s) planned` : 'No schedule set')}</div>
                        <button class="uie-btn uie-btn-sm" style="margin-top:6px" data-npcedit="${esc(n.id)}">${icon('fa-pen')} Edit schedule</button>
                    </div>`;
                }).join('') : '<div class="uie-empty">No NPCs yet.</div>'}</div>`;
        } else {
            body += `<form class="uie-pad" data-calform>
                <div class="uie-card"><h4>Clock</h4>
                    <div class="uie-grid2">
                        <label class="uie-field"><span>Date</span><input type="date" name="date" value="${esc(isoDate(now))}"></label>
                        <label class="uie-field"><span>Time</span><input type="time" name="time" value="${esc(`${pad2(now.hh)}:${pad2(now.mm)}`)}"></label>
                    </div>
                    <div class="uie-row uie-wrap">${[15, 60, 240, 480, 1440].map(m => `<button type="button" class="uie-pill" data-adv="${m}">+${esc(humanDuration(m))}</button>`).join('')}</div>
                </div>
                <div class="uie-card"><h4>Format</h4>
                    <div class="uie-grid2">
                        <label class="uie-field"><span>Date format</span><select name="dateFormat">${opt('long', 'Wed, 1 July 2026', cal.dateFormat === 'long')}${opt('dmy', '01.07.2026', cal.dateFormat === 'dmy')}${opt('mdy', '07/01/2026', cal.dateFormat === 'mdy')}${opt('iso', '2026-07-01', cal.dateFormat === 'iso')}</select></label>
                        <label class="uie-field"><span>Clock</span><select name="h24">${opt('1', '24-hour', cal.h24)}${opt('0', '12-hour', !cal.h24)}</select></label>
                    </div>
                    <label class="uie-field"><span>Custom month names (12, comma separated)</span><input name="monthNames" value="${esc((cal.monthNames || []).join(', '))}" placeholder="Frostmoon, Thawmoon, …"></label>
                </div>
                <div class="uie-card"><h4>Day length</h4>
                    <label class="uie-field"><span>Mode</span><select name="dayMode">${opt('turn', 'Turn-based — time only advances with the story / actions', cal.dayMode !== 'realtime')}${opt('realtime', 'Real time — the clock runs while the chat is open', cal.dayMode === 'realtime')}</select></label>
                    <label class="uie-field"><span>Real-time minutes per game day</span><input type="number" name="realMinutesPerDay" min="1" max="1440" value="${esc(cal.realMinutesPerDay)}"></label>
                </div>
                <button type="submit" class="uie-btn uie-btn-primary uie-btn-block">${icon('fa-floppy-disk')} Save calendar settings</button>
            </form>`;
        }
        sheet.body.innerHTML = body;
    };
    render();
    sheet.onCleanup(bus.on(() => { if (view.tab !== 'settings') render(); }));

    sheet.body.addEventListener('click', async (e) => {
        try {
            const tab = e.target.closest('[data-tab]');
            if (tab) { view.tab = tab.dataset.tab; render(); return; }
            const day = e.target.closest('[data-day]');
            if (day) { view.sel = day.dataset.day; render(); return; }
            const ne = e.target.closest('[data-npcedit]');
            if (ne) { editNpc(ne.dataset.npcedit); return; }
            const adv = e.target.closest('[data-adv]');
            if (adv) { userOps([{ op: 'time.advance', minutes: Number(adv.dataset.adv) }]); render(); return; }
            const del = e.target.closest('[data-delev]');
            if (del) {
                if (await confirmDialog('Delete event', 'Remove this event?', { okLabel: 'Delete', danger: true })) mutate(s => { delete s.calendar.events[del.dataset.delev]; });
                return;
            }
            const c = e.target.closest('[data-c]')?.dataset.c;
            if (c === 'prev') { view.m--; if (view.m < 1) { view.m = 12; view.y--; } render(); }
            if (c === 'next') { view.m++; if (view.m > 12) { view.m = 1; view.y++; } render(); }
            if (c === 'today') { const p = toParts(S().clock.t, S().calendar.epoch); view.y = p.y; view.m = p.m; view.sel = isoDate(p); render(); }
            if (c === 'add') {
                const v = await formDialog(`Add on ${view.sel}`, `
                    <label class="uie-field"><span>Title</span><input name="title" maxlength="120" required></label>
                    <div class="uie-grid2"><label class="uie-field"><span>Type</span><select name="type">${opt('event', 'Event', true)}${opt('birthday', 'Birthday (yearly)')}${opt('reminder', 'Reminder')}</select></label>
                    <label class="uie-field"><span>Time (optional)</span><input name="time" type="time"></label></div>
                    <label class="uie-field"><span>Note</span><input name="note" maxlength="200"></label>`, { theme: 'parchment', okLabel: 'Add' });
                if (!v?.title?.trim()) return;
                mutate(s => { const id = uid('ev'); s.calendar.events[id] = { id, title: str(v.title, 120), type: v.type, date: view.sel, time: v.time || '', note: str(v.note, 200) }; });
            }
        } catch (err) { reportError(err); }
    });
    sheet.body.addEventListener('submit', (e) => {
        if (!e.target.matches('[data-calform]')) return;
        e.preventDefault();
        const f = e.target;
        const g = (n) => f.querySelector(`[name=${n}]`).value;
        mutate(s => {
            const cal = s.calendar;
            cal.dateFormat = g('dateFormat');
            cal.h24 = g('h24') === '1';
            const names = g('monthNames').split(',').map(x => x.trim()).filter(Boolean);
            cal.monthNames = names.length === 12 ? names : [];
            cal.dayMode = g('dayMode');
            cal.realMinutesPerDay = Math.max(1, Math.min(1440, Number(g('realMinutesPerDay')) || 60));
            const [y, m, d] = g('date').split('-').map(Number);
            const tm = parseHHMM(g('time')) ?? 0;
            if (y && m && d) {
                const target = dateToMinutes(y, m, d, cal.epoch) + tm;
                if (target < 0) cal.epoch = { y, m, d };
                s.clock.t = Math.max(0, dateToMinutes(y, m, d, cal.epoch) + tm);
            }
        });
        startRealtime();
        globalThis.toastr?.success?.('Calendar saved.', 'UIE');
        view.tab = 'calendar';
        const p = toParts(S().clock.t, S().calendar.epoch);
        view.y = p.y; view.m = p.m; view.sel = isoDate(p);
        render();
    });
    return sheet;
}
