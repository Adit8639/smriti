// Progress: the dashboard. Days to each exam, the exam-day forecast, the syllabus heatmap
// (topics by PYQ weight and predicted recall), the weakest high-weight topics, calibration,
// the error-cause mix, active ratio, recall speed, revisions per source and the mock trend
// with the projected band.

import { h, clear } from './ui.js';
import { app, activeProfile } from './store.js';
import { call } from './data.js';
import { examCountdown, phaseOn } from './profiles.js';
import { countedAnswers } from './labdata.js';
import { bandStats, marksFor, ruleText, projectCsat, BANDS, BAND_LABEL } from './calib.js';
import { gsPaper, csatPaper } from './view-lab.js';
import { currentRules } from './study.js';
import { currentStreak } from './view-mission.js';
import { lineChart, stackedBars, hBars, heatGrid, calibrationDots } from './charts.js';
import * as clock from './clock.js';
import { localDate, formatDate, plural } from './util.js';

const pct = (x) => (x === null || x === undefined ? '—' : `${Math.round(x * 100)}%`);
const EXPECT = { sure: 0.9, '5050': 0.5, guess: 0.25 };
const wk = (ms) => { const d = new Date(ms); return `${d.getDate()} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()]}`; };

export async function render() {
  const profile = activeProfile();
  const today = localDate(clock.now());
  const s = app.state;
  const root = h('div', { class: 'progress-view' });
  const ph = profile ? phaseOn(profile, today) : null;
  const st = currentStreak();
  if (profile) {
    root.append(h('section', { class: 'card' },
      h('div', { class: 'row-between' }, h('h2', { text: profile.name }), ph ? h('span', { class: 'badge ok', text: ph.name }) : null),
      h('div', { class: 'stat-row' },
        examCountdown(profile, today).map((d) => h('div', { class: 'stat' }, h('strong', { text: d.days >= 0 ? String(d.days) : '—' }), h('span', { class: 'small muted', text: `days to ${d.label}${d.tentative ? ' (tentative)' : ''}` }))),
        h('div', { class: 'stat' }, h('strong', { text: String(st) }), h('span', { class: 'small muted', text: 'day streak' })))));
  }
  const body = h('div', { class: 'dash' }, h('p', { class: 'muted small', text: 'Working out the numbers…' }));
  root.append(body);
  draw(body, profile, today).catch((e) => { clear(body).append(h('div', { class: 'card error' }, h('p', { text: `Could not load the dashboard: ${e.message}` }))); console.error(e); });
  return root;
}

async function draw(body, profile, today) {
  const s = app.state;
  const d = await call('dash.data', { profile, today, rules: currentRules(), now: clock.now() });
  const paper = gsPaper(profile);
  const m = marksFor(paper);
  const proj = paper ? await call('lab.projection', { paper }).catch(() => null) : null;
  clear(body);

  // Forecast
  const f = d.forecast;
  body.append(h('section', { class: 'card hero' },
    h('h2', { text: 'Exam-day forecast' }),
    f.n ? h('p', { class: 'big-number' }, h('strong', { text: pct(f.pct) }), ' of Prelims atoms') : h('p', { class: 'muted', text: 'No Prelims atoms yet.' }),
    f.n ? h('p', { class: 'small', text: `${f.ok} of ${f.n} atoms are predicted at 80% recall or more on ${formatDate(localDate(d.examFirst))}, if you keep reviewing as scheduled. Unstarted atoms count as 0.` }) : null,
    d.archived ? h('p', { class: 'small muted', text: `${plural(d.archived, 'current-affairs fact')} archived after their shelf life.` }) : null));

  // Heatmap and weakest topics
  if (d.heatmap.length) {
    body.append(h('section', { class: 'card' },
      heatGrid(d.heatmap, { title: 'Syllabus heatmap', desc: 'Each square is a topic with atoms: colour is predicted recall on exam day, size is PYQ weight. Tap one to open it.', onPick: (c) => { location.hash = `#/node/${encodeURIComponent(c.id)}`; } }),
      d.weakest.length ? h('div', null, h('h3', { text: 'Weakest high-weight topics' }),
        h('ol', { class: 'weak-list' }, d.weakest.map((p) => h('li', null,
          h('a', { href: `#/node/${encodeURIComponent(p.nodeId)}` }, p.title), h('span', { class: 'small muted', text: ` · recall ${pct(p.R)}, weight ${p.W}` }),
          h('span', { class: 'button-row' }, h('a', { class: 'btn small', href: `#/learn/start/${encodeURIComponent(p.nodeId)}` }, 'Learn Loop'), h('a', { class: 'btn small', href: `#/practice/${encodeURIComponent(p.nodeId)}` }, 'Practice')))))) : null));
  }

  // Calibration
  const answers = countedAnswers(s, 300);
  const stats = bandStats(answers, m);
  body.append(h('section', { class: 'card' },
    calibrationDots(BANDS.map((b) => ({ label: BAND_LABEL[b], n: stats[b].n, acc: stats[b].acc, expect: EXPECT[b] })), { title: 'Calibration', desc: `Dots: your accuracy in each confidence band (last ${answers.length} answers). Lines: what that label should mean.` }),
    h('p', { class: 'small', text: answers.length ? ruleText(stats, m) : 'Answer objective questions with a confidence tag to see your calibration.' })));

  // Error causes over time
  const series = [{ id: 'gap', label: 'Knowledge gap' }, { id: 'confused', label: 'Confusion' }, { id: 'reading', label: 'Misread or trap' }, { id: 'slip', label: 'Slip or overthinking' }];
  const anyCause = d.trend.some((w) => Object.values(w.causes).some(Boolean));
  body.append(h('section', { class: 'card' }, anyCause
    ? stackedBars(series, d.trend.map((w) => ({ label: `Week of ${wk(w.start)}`, short: wk(w.start), values: w.causes })), { title: 'Why you miss, week by week', desc: "Didn't know and Forgot are knowledge gaps; Misread and Trap word are reading; Silly and Overthought are slips." })
    : h('div', null, h('h3', { text: 'Why you miss' }), h('p', { class: 'small muted', text: 'Tag misses with a cause to see the mix over time.' }))));

  // Active ratio and recall speed
  body.append(h('section', { class: 'card dash-pair' },
    lineChart(d.trend.map((w) => ({ label: `Week of ${wk(w.start)}`, short: wk(w.start), value: w.ratio === null ? null : Math.round(w.ratio * 100) })), { title: 'Active ratio', desc: 'Time producing answers ÷ session time. Target: 70% or more.', yMax: 100, unit: '%', ref: { value: 70, label: 'target 70%' } }),
    lineChart(d.trend.map((w) => ({ label: `Week of ${wk(w.start)}`, short: wk(w.start), value: w.median })), { title: 'Recall speed', desc: 'Median seconds per correct review.', unit: 's', ref: { value: (profile && profile.targets && profile.targets.cardSeconds) || 8, label: 'card target' } })));

  // Mock trend with projected band
  if (d.mocks.length || (proj && proj.band)) {
    body.append(h('section', { class: 'card' },
      lineChart(d.mocks.map((x, i) => ({ label: `${x.title} (${formatDate(localDate(x.ts))})`, short: `#${i + 1}`, value: x.score })), {
        title: 'Mocks and projected band', desc: proj && proj.band ? `Shaded: your projected ${paper.name} band, ${proj.band.p10}–${proj.band.p90} (10th–90th percentile).` : 'Scores of mocks whose autopsy is done.',
        yMax: paper ? paper.marks : null, unit: 'marks', band: proj && proj.band ? { lo: proj.band.p10, hi: proj.band.p90, label: 'projected' } : null,
      })));
  }

  // CSAT safety line
  const cp = csatPaper(profile);
  const recent = s.csat.recent.filter((x) => !x.skip);
  const cproj = cp && recent.length ? projectCsat({ answers: recent.slice(-150).map((x) => ({ ok: x.ok, ms: x.ms })), paper: cp }) : null;
  if (cproj) body.append(h('section', { class: `card${cproj.warn ? ' warn' : ''}` }, h('h3', { text: 'CSAT' }), h('p', { text: `Projected ${cproj.projected} of ${cproj.max}; the safety line is ${Math.round(1.25 * cproj.qualifying * 10) / 10}.` }), cproj.warn ? h('p', { class: 'warn-text small', text: 'Below the safety line: add CSAT sets to your week.' }) : null));

  // Revisions per source
  if (d.revisions.length) body.append(h('section', { class: 'card' }, hBars(d.revisions.map((r) => ({ label: r.title, value: r.n })), { title: 'Revisions per source', desc: 'Shrink-Wrap note revisions written while a source was mapped. Limited sources, more revisions.', unit: 'revisions' })));

  body.append(h('section', { class: 'card' }, h('div', { class: 'button-row' },
    h('a', { class: 'btn', href: '#/weekly' }, 'Weekly review'), h('a', { class: 'btn', href: '#/lab?tab=calib' }, 'Calibration report'), h('a', { class: 'btn', href: '#/health' }, 'Data health'))));
}
