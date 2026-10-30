// Progress: where you stand. Exam countdown, calibration, mocks, CSAT and the error mix.

import { h } from './ui.js';
import { app, activeProfile } from './store.js';
import { examCountdown } from './profiles.js';
import { countedAnswers } from './labdata.js';
import { bandStats, marksFor, ruleText, projectCsat, BANDS, BAND_LABEL } from './calib.js';
import { gsPaper, csatPaper } from './view-lab.js';
import { CAUSE_LIST } from './sheets.js';
import { localDate, formatDate, plural } from './util.js';
import * as clock from './clock.js';

const pct = (x) => (x === null || x === undefined ? '—' : `${Math.round(x * 100)}%`);

export async function render() {
  const profile = activeProfile();
  const today = localDate(clock.now());
  const s = app.state;
  const root = h('div', { class: 'progress-view' });
  if (profile) {
    root.append(h('section', { class: 'card' }, h('h2', { text: profile.name }),
      h('div', { class: 'stat-row' }, examCountdown(profile, today).map((d) => h('div', { class: 'stat' }, h('strong', { text: d.days >= 0 ? String(d.days) : '—' }), h('span', { class: 'small muted', text: `days to ${d.label}${d.tentative ? ' (tentative)' : ''}` }))))));
  }
  const paper = gsPaper(profile);
  const m = marksFor(paper);
  const answers = countedAnswers(s, 300);
  const stats = bandStats(answers, m);
  root.append(h('section', { class: 'card' }, h('h2', { text: 'Calibration' }),
    answers.length ? h('table', { class: 'counts-table' }, h('tbody', null, BANDS.map((b) => h('tr', null, h('th', { text: BAND_LABEL[b] }), h('td', { text: `${pct(stats[b].acc)} of ${stats[b].n}` }))))) : null,
    h('p', { class: 'small', text: answers.length ? ruleText(stats, m) : 'Answer objective questions with a confidence tag to build your attempt rule.' }),
    h('a', { class: 'btn small', href: '#/lab?tab=calib' }, 'Full report')));
  const mocks = Object.values(s.mocks).filter((x) => x.status === 'submitted' && x.unlocked).sort((a, b) => a.submittedTs - b.submittedTs);
  root.append(h('section', { class: 'card' }, h('h2', { text: 'Mocks' }),
    mocks.length ? h('table', { class: 'counts-table' }, h('tbody', null, mocks.slice(-8).reverse().map((x) => h('tr', null, h('th', { text: formatDate(localDate(x.submittedTs)) }), h('td', { text: x.title }), h('td', { text: `${x.score} / ${x.max}` })))))
      : h('p', { class: 'small muted', text: 'No scored mocks yet.' }),
    h('a', { class: 'btn small', href: '#/lab?tab=mocks' }, 'Mocks')));
  const cp = csatPaper(profile);
  const recent = s.csat.recent.filter((x) => !x.skip);
  const proj = cp && recent.length ? projectCsat({ answers: recent.slice(-150).map((x) => ({ ok: x.ok, ms: x.ms })), paper: cp }) : null;
  if (cp) {
    root.append(h('section', { class: 'card' }, h('h2', { text: 'CSAT' }),
      h('p', { class: proj && proj.warn ? 'warn-text' : 'small', text: proj ? `Projected ${proj.projected} of ${proj.max}${proj.warn ? `: below the safety line of ${Math.round(1.25 * proj.qualifying * 10) / 10}.` : '.'}` : 'No CSAT practice yet.' }),
      h('a', { class: 'btn small', href: '#/lab?tab=csat' }, 'CSAT Gym')));
  }
  const causes = CAUSE_LIST.map(([id, label]) => [label, s.causes[id] || 0]).filter(([, n]) => n);
  const total = causes.reduce((a, [, n]) => a + n, 0);
  root.append(h('section', { class: 'card' }, h('h2', { text: 'Why you miss' }),
    total ? h('table', { class: 'counts-table' }, h('tbody', null, causes.sort((a, b) => b[1] - a[1]).map(([label, n]) => h('tr', null, h('th', { text: label }), h('td', { text: `${n} (${pct(n / total)})` })))))
      : h('p', { class: 'small muted', text: 'Every miss gets a cause; the mix shows up here.' }),
    total ? h('p', { class: 'small muted', text: `${plural(total, 'tagged miss', 'tagged misses')} so far.` }) : null));
  return root;
}
