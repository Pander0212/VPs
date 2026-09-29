// Activities: timed actions (sleep, work, train, cook…) that advance the clock and adjust
// trackers deterministically. Optionally posts a narrator note so the story knows.

import { S, bus, userOps, settingsGet } from '../state.js';
import { st } from '../st-adapter.js';
import { openSheet } from './sheet.js';
import { esc, icon, reportError } from './dom.js';
import { ACTIVITIES } from '../engine/rules.js';
import { humanDuration, toParts, formatTime } from '../engine/time.js';

export function open() {
    const sheet = openSheet({ id: 'activities', title: 'Activities', icon: 'fa-person-running' });
    const render = () => {
        const s = S();
        const p = toParts(s.clock.t, s.calendar.epoch);
        sheet.body.innerHTML = `
            <div class="uie-pad uie-muted">${icon('fa-clock')} It is ${esc(formatTime(p, s.calendar.h24))}. Activities pass time and change your needs by fixed rules.</div>
            <div class="uie-list uie-list-2">${Object.entries(ACTIVITIES).map(([id, a]) => `
                <div class="uie-item">
                    <span class="uie-emoji" style="width:34px;text-align:center;color:var(--accent)">${icon(a.icon)}</span>
                    <div class="uie-grow">
                        <h4>${esc(a.label)} <small class="uie-muted">· ${esc(humanDuration(a.minutes))}</small></h4>
                        <p>${esc(a.desc)}</p>
                        <div class="uie-effects" style="margin:6px 0 0">${Object.entries(a.effects).map(([k, v]) => `<span class="uie-tag ${v >= 0 ? 'good' : 'bad'}">${esc(k)} ${v > 0 ? '+' : ''}${esc(v)}</span>`).join('')}${a.currency ? `<span class="uie-tag good">+${a.currency} ${esc(s.player.currencyName)}</span>` : ''}${a.xp ? `<span class="uie-tag good">+${a.xp} XP</span>` : ''}</div>
                    </div>
                    <button class="uie-btn uie-btn-sm uie-btn-primary" style="white-space:nowrap" data-act-id="${esc(id)}">Do it</button>
                </div>`).join('')}</div>
            ${s.activityLog.length ? `<div class="uie-section-h">${icon('fa-list')} Recent</div><div class="uie-pad" style="padding-top:0">${s.activityLog.slice(-6).reverse().map(l => `<div class="uie-muted">• ${esc(l)}</div>`).join('')}</div>` : ''}`;
    };
    render();
    sheet.onCleanup(bus.on(() => render()));
    sheet.body.addEventListener('click', (e) => {
        const b = e.target.closest('[data-act-id]');
        if (!b) return;
        try {
            const a = ACTIVITIES[b.dataset.actId];
            const res = userOps([{ op: 'activity.do', id: b.dataset.actId }]);
            const s = S();
            s.activityLog.push(`${a.label} (${humanDuration(a.minutes)})`);
            if (s.activityLog.length > 30) s.activityLog.splice(0, s.activityLog.length - 30);
            if (settingsGet().narratorNotes) st.narrate(`*${st.userName()} spends ${humanDuration(a.minutes)} to ${a.label.toLowerCase()}.* (${res.changes.filter(c => !/passed$/.test(c)).slice(0, 4).join(', ')})`);
            render();
        } catch (err) { reportError(err); }
    });
    return sheet;
}
