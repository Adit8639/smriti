// Weekly review (#/weekly), about 15 minutes on Sunday: what moved this week against the
// last, the five weakest high-weight topics, plan adjustments and a backup reminder.

import { h, toast } from './ui.js';
import { app, activeProfile, appendEvents, emit } from './store.js';
import { call } from './data.js';
import { reviewWeek, currentStreak } from './view-mission.js';
import { currentRules } from './study.js';
import { exportNow } from './view-data.js';
import { canShareFiles } from './ui.js';
import { DEFAULT_NEW } from './queue.js';
import * as clock from './clock.js';
import { addDays, formatDate, localDate, daysBetween, plural } from './util.js';

function weekTotals(monday) {
  const t = { rev: 0, stmt: 0, active: 0, loops: 0, writes: 0, days: 0 };
  for (let i = 0; i < 7; i++) {
    const d = app.state.days[addDays(monday, i)];
    if (!d) continue;
    t.rev += d.rev; t.stmt += d.stmt; t.active += d.active; t.loops += d.loops; t.writes += d.writes;
    if (d.rev || d.stmt || d.active) t.days++;
  }
  const from = new Date(`${monday}T00:00:00`).getTime();
  const to = from + 7 * 86400000;
  const obj = app.state.objective.filter((x) => x.t >= from && x.t < to);
  t.acc = obj.length ? obj.filter((x) => x.ok).length / obj.length : null;
  t.mocks = Object.values(app.state.mocks).filter((m) => m.submittedTs >= from && m.submittedTs < to && m.unlocked);
  const skips = {};
  for (let i = 0; i < 7; i++) { const ms = app.state.missions[addDays(monday, i)]; if (ms) for (const r of Object.values(ms.skips)) skips[r] = (skips[r] || 0) + 1; }
  t.skips = skips;
  return t;
}

export async function render() {
  const w = reviewWeek();
  const done = app.state.weekly[w.monday];
  const cur = weekTotals(w.monday);
  const prev = weekTotals(addDays(w.monday, -7));
  const delta = (a, b, fmt = (x) => String(x)) => h('span', { class: `delta ${a > b ? 'up' : a < b ? 'down' : ''}`, text: a === b ? '=' : `${a > b ? '▲' : '▼'} ${fmt(Math.abs(a - b))}` });
  const row = (label, a, b, fmt = (x) => String(x)) => h('tr', null, h('th', { text: label }), h('td', { text: fmt(a) }), h('td', { class: 'muted', text: fmt(b) }), h('td', null, delta(a, b, fmt)));
  const mins = (ms) => `${Math.round(ms / 60000)} min`;
  const weakBox = h('div', null, h('p', { class: 'small muted', text: 'Finding your weakest high-weight topics…' }));
  const mine = app.state.devices[app.device.deviceId];
  const lastExport = mine && mine.lastExportTs;
  const backupAge = lastExport ? daysBetween(localDate(lastExport), localDate(clock.now())) : null;
  const newSel = h('select', { 'aria-label': 'New atoms per day' }, [10, 20, 30, 40, 50].map((n) => h('option', { value: String(n), text: `${n} new atoms a day`, selected: (Number.isInteger(app.state.settings.newPerDay) ? app.state.settings.newPerDay : DEFAULT_NEW) === n ? true : null })));
  const notes = h('textarea', { class: 'field-input', rows: '3', placeholder: 'One or two changes for next week (e.g. "two timed answers", "Environment Learn Loops")', 'aria-label': 'Plan changes' });
  const root = h('div', { class: 'weekly' },
    h('section', { class: 'card hero' },
      h('h2', { text: `Weekly review: ${formatDate(w.monday)} – ${formatDate(w.sunday)}` }),
      done ? h('p', { class: 'ok-text', text: `Done on ${formatDate(localDate(done.ts))}.${done.notes ? ` Your plan: ${done.notes}` : ''}` }) : h('p', { class: 'small muted', text: 'About 15 minutes. Look at what moved, pick the topics to fix, adjust the plan, back up.' })),
    h('section', { class: 'card' },
      h('h3', { text: '1 · What moved' }),
      h('table', { class: 'counts-table compact' },
        h('thead', null, h('tr', null, ['', 'This week', 'Last week', ''].map((x) => h('th', { text: x })))),
        h('tbody', null,
          row('Days studied', cur.days, prev.days), row('Reviews', cur.rev, prev.rev), row('PYQ-style answers', cur.stmt, prev.stmt),
          row('Learn Loops done', cur.loops, prev.loops), row('Writing attempts', cur.writes, prev.writes), row('Active time', cur.active, prev.active, mins),
          row('Objective accuracy', Math.round((cur.acc || 0) * 100), Math.round((prev.acc || 0) * 100), (x) => `${x}%`))),
      h('p', { class: 'small', text: `Streak: ${plural(currentStreak(), 'day')}.${cur.mocks.length ? ` Mocks: ${cur.mocks.map((m) => `${m.score}/${m.max}`).join(', ')}.` : ''}${Object.keys(cur.skips).length ? ` Skipped blocks: ${Object.entries(cur.skips).map(([r, n]) => `${n} × ${r.replace('-', ' ')}`).join(', ')}.` : ''}` })),
    h('section', { class: 'card' }, h('h3', { text: '2 · Five weakest high-weight topics' }), weakBox),
    h('section', { class: 'card' },
      h('h3', { text: '3 · Plan for next week' }),
      h('label', { class: 'field' }, h('span', { text: 'New atoms a day' }), newSel),
      h('p', { class: 'small' }, 'Daily time budget per weekday: ', h('a', { href: '#/settings' }, 'Settings → Study')),
      notes),
    h('section', { class: 'card' },
      h('h3', { text: '4 · Backup' }),
      h('p', { class: backupAge === null || backupAge > 7 ? 'warn-text' : '', text: lastExport ? `Last backup from this device: ${formatDate(localDate(lastExport))} (${plural(backupAge, 'day')} ago).` : 'No backup from this device yet.' }),
      h('p', { class: 'small muted', text: 'Export on both devices and import each other\'s file: the merge keeps everything.' }),
      h('button', { class: 'btn', type: 'button', onclick: () => exportNow(canShareFiles()) }, 'Back up now')),
    h('div', { class: 'button-row' }, h('button', {
      class: 'btn primary', type: 'button',
      onclick: async () => {
        const ev = [['weekly.done', { week: w.monday, notes: notes.value.trim(), changes: { newPerDay: Number(newSel.value) } }]];
        if (Number(newSel.value) !== app.state.settings.newPerDay) ev.push(['settings.set', { key: 'newPerDay', value: Number(newSel.value) }]);
        await appendEvents(ev);
        toast('Weekly review saved.', { kind: 'ok' });
        location.hash = '#/today';
      },
    }, done ? 'Save again' : 'Done')));
  call('dash.data', { profile: activeProfile(), today: localDate(clock.now()), rules: currentRules(), now: clock.now() }).then((d) => {
    weakBox.textContent = '';
    if (!d.weakest.length) { weakBox.append(h('p', { class: 'small muted', text: 'No weak topics with atoms yet.' })); return; }
    weakBox.append(h('ol', { class: 'weak-list' }, d.weakest.map((p) => h('li', null, h('a', { href: `#/node/${encodeURIComponent(p.nodeId)}` }, p.title), h('span', { class: 'small muted', text: ` · recall on exam day ${Math.round(p.R * 100)}%, weight ${p.W}` }),
      h('span', { class: 'button-row' }, h('a', { class: 'btn small', href: `#/learn/start/${encodeURIComponent(p.nodeId)}` }, 'Learn Loop'), h('a', { class: 'btn small', href: `#/practice/${encodeURIComponent(p.nodeId)}` }, 'Practice'))))));
  }).catch(() => { weakBox.textContent = 'Could not rank topics right now.'; });
  return root;
}
