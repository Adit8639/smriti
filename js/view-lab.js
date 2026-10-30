// Prelims Lab: the PYQ Spine (browse and solve), mocks (new, resume, history), the
// calibration report with a score projection, the Trap Log and the CSAT Gym.
// #/lab?tab=pyqs|mocks|calib|traps|csat

import { h, clear, toast, sheet } from './ui.js';
import { app, allNodes, activeProfile, appendEvents } from './store.js';
import { call } from './data.js';
import { FORMAT_LABEL } from './probes.js';
import { countedAnswers } from './labdata.js';
import { bandStats, ruleText, marksFor, simulate, breakEven, projectCsat, BANDS, BAND_LABEL, MIN_BAND } from './calib.js';
import { CSAT_TYPES, LEVEL_LABEL } from './csat.js';
import { TRAP_TAGS } from './schema.js';
import { filled } from './cloze.js';
import { ulid } from './ulid.js';
import { freshSeed } from './rng.js';
import * as clock from './clock.js';
import { formatDateTime, plural } from './util.js';

const TABS = [['pyqs', 'PYQs'], ['mocks', 'Mocks'], ['calib', 'Calibration'], ['traps', 'Traps'], ['csat', 'CSAT']];
const PYQ_FORMAT = { statement: 'Statements', single: 'Single answer', assertionReason: 'Statement-I / II', notCorrect: 'NOT correct', identify: 'Identify', match: 'Match', howMany: 'How many' };
const LS_FILTER = 'smriti.pyqFilter';
const pct = (x) => (x === null || x === undefined ? '—' : `${Math.round(x * 100)}%`);

export function gsPaper(profile = activeProfile()) {
  const papers = (profile && profile.papers) || [];
  return papers.find((p) => p.type === 'mcq' && p.formatMix) || papers.find((p) => p.type === 'mcq' && !p.qualifyingPct) || papers.find((p) => p.type === 'mcq') || null;
}
export function csatPaper(profile = activeProfile()) {
  const papers = (profile && profile.papers) || [];
  return papers.find((p) => p.type === 'mcq' && p.qualifyingPct) || null;
}

function tabBar(tab) {
  return h('nav', { class: 'tabs', 'aria-label': 'Prelims Lab sections' }, TABS.map(([id, label]) => h('a', { class: `tab${id === tab ? ' active' : ''}`, href: `#/lab?tab=${id}`, 'aria-current': id === tab ? 'page' : null }, label)));
}

export async function render(route) {
  const tab = TABS.some(([id]) => id === route.query.get('tab')) ? route.query.get('tab') : 'pyqs';
  const body = h('div', { class: 'lab-body' }, h('p', { class: 'muted small', text: 'Loading…' }));
  const root = h('div', { class: 'lab' }, tabBar(tab), body);
  const draw = { pyqs: pyqTab, mocks: mockTab, calib: calibTab, traps: trapTab, csat: csatTab }[tab];
  draw(body).catch((e) => { clear(body).append(h('div', { class: 'card error' }, h('p', { text: `Could not load: ${e.message}` }))); console.error(e); });
  return root;
}

// ------------------------------------------------------------------ PYQ Spine
function readFilter() {
  try { return { year: '', subject: '', format: '', status: '', ...JSON.parse(localStorage.getItem(LS_FILTER) || '{}') }; } catch (_) { return { year: '', subject: '', format: '', status: '' }; }
}
function saveFilter(f) { try { localStorage.setItem(LS_FILTER, JSON.stringify(f)); } catch (_) { /* preference only */ } }

// Starts a PYQ set: the ids go to sessionStorage, the route carries a token.
export function solvePyqs(ids, title = 'PYQs') {
  const key = `pyqset-${Date.now().toString(36)}`;
  try { sessionStorage.setItem(key, JSON.stringify({ ids, title })); } catch (_) { toast('This browser blocked session storage; try a smaller set.', { kind: 'warn' }); return; }
  location.hash = `#/practice/pyqs?set=${key}`;
}

async function pyqTab(body) {
  const data = await call('lab.pyqs');
  const f = readFilter();
  const nodes = allNodes();
  const years = [...new Set(data.rows.map((r) => r.year))].sort((a, b) => b - a);
  const formats = [...new Set(data.rows.map((r) => r.format))];
  const list = h('div', { class: 'pyq-list' });
  const countLine = h('p', { class: 'small muted' });
  const solveBtn = h('button', { class: 'btn primary', type: 'button' }, 'Solve');
  let shown = 60;
  const select = (key, label, options) => {
    const el = h('select', { 'aria-label': label, onchange: () => { f[key] = el.value; saveFilter(f); shown = 60; draw(); } },
      h('option', { value: '', text: label }), options.map(([v, t]) => h('option', { value: String(v), text: t, selected: String(f[key]) === String(v) ? true : null })));
    return el;
  };
  const filtered = () => data.rows.filter((r) => (!f.year || String(r.year) === String(f.year)) && (!f.subject || r.subject === f.subject) && (!f.format || r.format === f.format)
    && (!f.status || (f.status === 'new' && !r.n) || (f.status === 'wrong' && r.lastOk === false) || (f.status === 'right' && r.lastOk === true)));
  function draw() {
    const rows = filtered();
    countLine.textContent = `${plural(rows.length, 'question')}${rows.length !== data.rows.length ? ` of ${data.rows.length}` : ''}.`;
    solveBtn.textContent = rows.length ? `Solve ${rows.length > 50 ? 'the first 50' : `these ${rows.length}`}` : 'Solve';
    solveBtn.disabled = !rows.length;
    solveBtn.onclick = () => solvePyqs(rows.slice(0, 50).map((r) => r.id), f.year ? `PYQs ${f.year}` : 'PYQs');
    clear(list);
    for (const r of rows.slice(0, shown)) {
      const status = !r.n ? h('span', { class: 'badge muted', text: 'New' }) : h('span', { class: `badge ${r.lastOk ? 'ok' : 'error'}`, text: `${r.lastOk ? 'Right' : 'Wrong'} last time · ${r.right}/${r.n}` });
      list.append(h('button', { class: 'pyq-row', type: 'button', 'data-nav': '', onclick: () => solvePyqs([r.id], `PYQ ${r.year}`) },
        h('span', { class: 'pyq-meta' }, h('strong', { text: String(r.year) }), h('span', { class: 'badge', text: PYQ_FORMAT[r.format] || r.format }), status,
          r.answerSource && r.answerSource !== 'official' ? h('span', { class: 'badge warn', text: `${r.answerSource} key` }) : null),
        h('span', { class: 'pyq-stem', text: r.stem.replace(/\s*\n+\s*/g, ' ') }),
        h('span', { class: 'small muted', text: r.subject ? (nodes.get(r.subject) || {}).title || r.subject : '' })));
    }
    if (rows.length > shown) list.append(h('button', { class: 'btn block-btn', type: 'button', onclick: () => { shown += 60; draw(); } }, `Show more (${rows.length - shown} left)`));
    if (!rows.length) list.append(h('p', { class: 'muted', text: data.rows.length ? 'No PYQ matches these filters.' : 'No objective PYQs installed yet. Forge PYQ packs with F2 (one paper per run) and import them in Data. The demo pack has 5.' }));
  }
  clear(body).append(
    h('section', { class: 'card' },
      h('h2', { text: 'PYQ Spine' }),
      h('p', { class: 'small muted', text: 'Practise PYQs by year, subject or format. Mark each statement before choosing an option; misses ask for a cause, and the explanation shows trap tags, the elimination path and the atoms to review.' }),
      h('div', { class: 'filters' },
        select('year', 'All years', years.map((y) => [y, String(y)])),
        select('subject', 'All subjects', data.subjects.map((s) => [s.id, s.title])),
        select('format', 'All formats', formats.map((x) => [x, PYQ_FORMAT[x] || x])),
        select('status', 'Any status', [['new', 'Not tried'], ['wrong', 'Wrong last time'], ['right', 'Right last time']])),
      h('div', { class: 'row-between' }, countLine, solveBtn)),
    list,
    data.mains.length ? h('p', { class: 'small muted', text: `${plural(data.mains.length, 'Mains PYQ')} installed: practise them in the Mains Studio.` }) : null);
  draw();
}

// ------------------------------------------------------------------ Mocks
const SIZES = [[100, 'Full paper: 100 questions'], [50, 'Half paper: 50'], [25, 'Quarter: 25'], [10, 'Quick check: 10']];

export async function startMock({ source, n, year, packId, title }) {
  const profile = activeProfile();
  const paper = gsPaper(profile);
  if (!paper) { toast('The active exam has no objective paper.', { kind: 'error' }); return null; }
  const seed = freshSeed(clock.now());
  toast('Building the paper…', { ms: 1500 });
  const r = await call('mock.build', { n, seed, source, paper, year, packId, mix: paper.formatMix || null });
  const qs = r.questions;
  if (!qs.length) { toast('No questions available for this mock yet.', { kind: 'warn' }); return null; }
  const perQ = (paper.durationMin * 60000) / (paper.questions || 100);
  const mockId = ulid(clock.now());
  const m = marksFor(paper);
  await appendEvents([['mock.started', {
    mockId, title: title || `${source === 'pyq' ? `PYQ paper ${year}` : source === 'pack' ? 'Mock pack' : 'Generated mock'} (${qs.length} Q)`, source, paper: paper.id,
    durationMs: Math.round(perQ * qs.length), marks: { right: m.right, wrong: m.wrong }, seed, questions: qs,
  }]]);
  location.hash = `#/mock/${mockId}`;
  return mockId;
}

async function mockTab(body) {
  const profile = activeProfile();
  const paper = gsPaper(profile);
  const packs = await call('lab.mockPacks');
  const pyqData = await call('lab.pyqs');
  const years = [...new Set(pyqData.rows.filter((r) => paper && r.paper === paper.id).map((r) => r.year))].sort((a, b) => b - a);
  const mocks = Object.entries(app.state.mocks).map(([id, m]) => ({ id, ...m })).sort((a, b) => b.startedTs - a.startedTs);
  const sizeSel = h('select', { 'aria-label': 'Mock size' }, SIZES.map(([n, label]) => h('option', { value: String(n), text: label })));
  const yearSel = h('select', { 'aria-label': 'PYQ year' }, years.map((y) => h('option', { value: String(y), text: `${y} (${pyqData.rows.filter((r) => r.year === y && r.paper === paper.id).length} Q)` })));
  const packSel = h('select', { 'aria-label': 'Mock pack' }, packs.map((p) => h('option', { value: p.id, text: `${p.title} (${p.questions} Q)` })));
  const busy = (btn, fn) => async () => { btn.disabled = true; try { await fn(); } catch (e) { toast(`Could not start: ${e.message}`, { kind: 'error' }); } finally { btn.disabled = false; } };
  const genBtn = h('button', { class: 'btn primary', type: 'button' }, 'Start');
  genBtn.onclick = busy(genBtn, () => startMock({ source: 'generated', n: Number(sizeSel.value) }));
  const yearBtn = h('button', { class: 'btn', type: 'button', disabled: !years.length }, 'Start');
  yearBtn.onclick = busy(yearBtn, () => startMock({ source: 'pyq', year: Number(yearSel.value), n: 0, title: `${paper.name} ${yearSel.value} (PYQs)` }));
  const packBtn = h('button', { class: 'btn', type: 'button', disabled: !packs.length }, 'Start');
  packBtn.onclick = busy(packBtn, () => startMock({ source: 'pack', packId: packSel.value, n: 0, title: (packs.find((p) => p.id === packSel.value) || {}).title }));
  const secs = paper ? Math.round((paper.durationMin * 60) / paper.questions) : 72;

  const history = h('div', { class: 'stack' });
  for (const m of mocks.slice(0, 40)) {
    let status;
    if (m.status === 'started') status = h('a', { class: 'btn small primary', href: `#/mock/${m.id}` }, 'Resume');
    else if (m.status === 'discarded') status = h('span', { class: 'badge muted', text: 'Discarded' });
    else if (!m.unlocked) status = h('a', { class: 'btn small', href: `#/mock/${m.id}` }, `Autopsy: ${m.needs.length - Object.keys(m.tags).length} left`);
    else status = h('a', { class: 'btn small', href: `#/mock/${m.id}` }, `${m.score} / ${m.max}`);
    history.append(h('div', { class: 'card item mock-row' },
      h('div', null, h('strong', { text: m.title }), h('p', { class: 'small muted', text: `${formatDateTime(m.startedTs)}${m.status === 'submitted' && m.unlocked ? ` · ${m.right} right, ${m.wrong} wrong, ${m.skipped} left` : ''}` })),
      status));
  }
  clear(body).append(
    h('section', { class: 'card' },
      h('h2', { text: 'New mock' }),
      h('p', { class: 'small muted', text: `Exam conditions: a question palette, ${secs} s per question on the clock, negative marking from the profile (+${marksFor(paper).right}, −${Math.round(marksFor(paper).wrong * 100) / 100}). Scores unlock only after the autopsy: every wrong answer and every right guess gets a cause.` }),
      h('div', { class: 'mock-source' }, h('div', null, h('strong', { text: 'Generated from your packs' }), h('p', { class: 'small muted', text: 'PYQs and probes first, then template questions from your atoms, following the format mix and PYQ subject weights.' }), sizeSel), genBtn),
      h('div', { class: 'mock-source' }, h('div', null, h('strong', { text: 'A PYQ year paper' }), years.length ? yearSel : h('p', { class: 'small muted', text: 'No PYQ papers installed yet (F2 packs).' })), yearBtn),
      h('div', { class: 'mock-source' }, h('div', null, h('strong', { text: 'An imported mock pack' }), packs.length ? packSel : h('p', { class: 'small muted', text: 'No mock packs yet: forge a coaching test with F6 and import it.' })), packBtn)),
    h('h2', { class: 'section-title', text: 'Your mocks' }),
    mocks.length ? history : h('p', { class: 'muted', text: 'No mocks yet.' }));
}

// ------------------------------------------------------------------ Calibration
function bandTable(stats, m) {
  return h('div', { class: 'table-wrap' }, h('table', { class: 'counts-table calib' },
    h('thead', null, h('tr', null, ['Confidence', 'Answers', 'Right', 'Accuracy', 'Marks per attempt', 'Rule'].map((x) => h('th', { text: x })))),
    h('tbody', null, BANDS.map((b) => {
      const s = stats[b];
      return h('tr', null, h('th', { text: BAND_LABEL[b] }), h('td', { text: String(s.n) }), h('td', { text: String(s.correct) }), h('td', { text: pct(s.acc) }),
        h('td', { text: s.ev === null ? '—' : `${s.ev > 0 ? '+' : ''}${s.ev.toFixed(2)}` }),
        h('td', null, s.n < MIN_BAND ? h('span', { class: 'muted', text: 'too few' }) : h('span', { class: `badge ${s.attempt ? 'ok' : 'error'}`, text: s.attempt ? 'Attempt' : 'Skip' })));
    }))));
}

async function calibTab(body) {
  const profile = activeProfile();
  const paper = gsPaper(profile);
  const m = marksFor(paper);
  const answers = countedAnswers(app.state, 300);
  const stats = bandStats(answers, m);
  const lockedMocks = Object.values(app.state.mocks).filter((x) => x.status === 'submitted' && !x.unlocked).length;
  const proj = h('div', null, h('p', { class: 'small muted', text: 'Working out the projection…' }));
  const mocks = Object.entries(app.state.mocks).map(([id, x]) => ({ id, ...x })).filter((x) => x.status === 'submitted' && x.unlocked).sort((a, b) => b.submittedTs - a.submittedTs);
  const perMock = h('div', { class: 'stack' });
  for (const x of mocks.slice(0, 12)) {
    const qs = x.key.map((answer) => ({ answer }));
    const ans = x.choice.map((choice, i) => ({ choice, confidence: x.conf[i] }));
    const mm = x.marks || m;
    const st = bandStats(ans.map((a, i) => (a.choice === null || !a.confidence ? null : { c: a.confidence, ok: a.choice === x.key[i] })).filter(Boolean), mm);
    const sim = simulate(qs, ans, mm);
    perMock.append(h('details', { class: 'card' }, h('summary', null, h('strong', { text: x.title }), ` · ${formatDateTime(x.submittedTs)} · ${x.score} / ${x.max}`),
      h('p', { class: 'small', text: BANDS.map((b) => `${BAND_LABEL[b]} ${st[b].n ? `${pct(st[b].acc)} of ${st[b].n}` : '—'}`).join(' · ') }),
      h('table', { class: 'counts-table' }, h('tbody', null, sim.map((r) => h('tr', null, h('th', { text: r.label }), h('td', { text: `${r.score} / ${r.max}` }), h('td', { class: 'small muted', text: `${r.attempted} attempted, ${r.right} right` })))))));
  }
  clear(body).append(
    h('section', { class: 'card' },
      h('h2', { text: 'Your attempt rule' }),
      h('p', { class: 'small muted', text: `From your last ${answers.length} objective answers with a confidence tag (reviews, PYQs and mocks; pre-tests and mocks still in autopsy are left out).` }),
      bandTable(stats, m),
      h('p', { class: 'rule-text', text: ruleText(stats, m) }),
      h('p', { class: 'small muted', text: `Why: a right answer earns +${m.right}, a wrong one costs −${Math.round(m.wrong * 100) / 100}. Attempting a band pays when EV = ${m.right}a − ${Math.round(m.wrong * 100) / 100}(1 − a) > 0, that is when its accuracy a is above ${pct(breakEven(m))}.` }),
      lockedMocks ? h('p', { class: 'small warn-text', text: `${plural(lockedMocks, 'mock')} still in autopsy: tag the misses to add ${lockedMocks > 1 ? 'them' : 'it'} here.` }) : null,
      Object.keys(app.state.slips).length ? h('p', { class: 'small', text: `Slips so far: ${app.state.slips.silly || 0} silly, ${app.state.slips.overthought || 0} overthought.` }) : null),
    h('section', { class: 'card' }, h('h2', { text: `Projected ${paper ? paper.name : 'score'}` }), proj),
    h('h2', { class: 'section-title', text: 'Mocks: had you skipped a band' }),
    mocks.length ? perMock : h('p', { class: 'muted', text: 'Finish a mock and its autopsy to see what skipping a band would have scored.' }));
  if (!paper) { clear(proj).append(h('p', { class: 'muted', text: 'The active exam has no objective paper.' })); return; }
  try {
    const r = await call('lab.projection', { paper });
    clear(proj);
    if (!r.band) {
      proj.append(h('p', { class: 'muted', text: `Answer at least 20 PYQ-style questions with a confidence tag to see a projection (${r.n} so far). Statement sets, NOT-correct, match, identify, PYQs and mock questions count.` }));
    } else {
      proj.append(
        h('p', { class: 'big-number' }, h('strong', { text: `${r.band.p10}–${r.band.p90}` }), ` of ${paper.marks}`),
        h('p', { class: 'small', text: `10th–90th percentile by resampling your last ${r.band.n} PYQ-style answers; middle estimate ${r.band.p50}. It assumes you follow your attempt rule (attempt: ${r.attempt.map((b) => BAND_LABEL[b]).join(', ') || 'nothing'}).` }),
        h('p', { class: 'small muted', text: r.pyqYears ? `Expected questions per subject come from recency-weighted PYQ counts (up to ${r.pyqYears}), smoothed so a thin PYQ set cannot put the whole paper on one subject.` : 'No PYQ weights yet, so subjects share the paper evenly. Import F2 PYQ packs to weight them.' }),
        h('div', { class: 'table-wrap' }, h('table', { class: 'counts-table' },
          h('thead', null, h('tr', null, ['Subject', 'Expected Q', 'Your answers', 'Accuracy'].map((x) => h('th', { text: x })))),
          h('tbody', null, r.perSubject.slice(0, 16).map((x) => h('tr', null, h('th', { text: x.title }), h('td', { text: String(x.expected) }), h('td', { text: String(x.n) }), h('td', { text: x.n ? pct(x.acc) : 'uses overall' })))))));
    }
  } catch (e) {
    clear(proj).append(h('p', { class: 'error-text', text: `Projection failed: ${e.message}` }));
  }
}

// ------------------------------------------------------------------ Trap Log
async function trapTab(body) {
  const traps = Object.entries(app.state.traps).filter(([t]) => t !== 'untagged').sort((a, b) => b[1] - a[1]);
  const untagged = app.state.traps.untagged || 0;
  const log = app.state.trapLog.slice().reverse();
  const top = traps.slice(0, 2).map(([t]) => t);
  const examples = async (tag) => {
    const out = [];
    for (const x of log.filter((l) => l.tag === tag).slice(0, 3)) {
      if (x.atomId) { const a = await app.db.get('atoms', x.atomId); if (a) out.push(filled(a)); }
      else if (x.pyqId) { const q = await app.db.get('pyqs', x.pyqId); if (q) out.push(`PYQ ${q.year}: ${String(q.stem).split('\n')[0].slice(0, 140)}`); }
      else if (x.mockId) out.push(`Mock question ${x.i + 1}`);
    }
    return out;
  };
  const list = h('div', { class: 'stack' });
  for (const [tag, n] of traps) {
    const ex = await examples(tag);
    list.append(h('div', { class: 'card item' },
      h('div', { class: 'row-between' }, h('strong', { text: tag.replace(/-/g, ' ') }), h('span', { class: 'badge warn', text: String(n) })),
      ex.length ? h('ul', { class: 'plain small' }, ex.map((t) => h('li', { text: t }))) : null,
      h('a', { class: 'btn small', href: `#/practice/traps?tags=${encodeURIComponent(tag)}` }, 'Drill this trap')));
  }
  clear(body).append(
    h('section', { class: 'card' },
      h('h2', { text: 'Trap Log' }),
      h('p', { class: 'small muted', text: 'Misses tagged "Misread" or "Trap word" land here with their trap tag. The drill serves statements built on your top traps, mixed with true ones.' }),
      top.length ? h('a', { class: 'btn primary block-btn', href: `#/practice/traps?tags=${top.map(encodeURIComponent).join(',')}` }, `Drill my top ${top.length > 1 ? 'two traps' : 'trap'}: ${top.map((t) => t.replace(/-/g, ' ')).join(' and ')}`)
        : h('p', { class: 'muted', text: 'No traps logged yet. When you miss a statement because of a trap word, pick "Trap word" or "Misread" as the cause.' }),
      untagged ? h('p', { class: 'small muted', text: `${plural(untagged, 'miss', 'misses')} were logged without a tag.` }) : null),
    traps.length ? list : null,
    h('section', { class: 'card' }, h('h3', { text: 'Drill any trap' }),
      h('div', { class: 'chips' }, TRAP_TAGS.map((t) => h('a', { class: 'chip', href: `#/practice/traps?tags=${t}` }, t.replace(/-/g, ' '))))));
}

// ------------------------------------------------------------------ CSAT Gym
async function csatTab(body) {
  const profile = activeProfile();
  const paper = csatPaper(profile);
  const recent = app.state.csat.recent.filter((x) => !x.skip);
  const projected = paper ? projectCsat({ answers: recent.slice(-150).map((x) => ({ ok: x.ok, ms: x.ms, c: null })), paper }) : null;
  const packItems = paper ? await call('csat.packItems', { paperId: paper.id }) : [];
  const byType = app.state.csat.byType;
  const median = (type) => {
    const xs = recent.filter((x) => x.type === type).map((x) => x.ms).sort((a, b) => a - b);
    return xs.length ? Math.round(xs[Math.floor(xs.length / 2)] / 1000) : null;
  };
  const grid = h('div', { class: 'csat-grid' }, CSAT_TYPES.map(([id, label]) => {
    const t = byType[id];
    return h('div', { class: 'card csat-type' },
      h('strong', { text: label }),
      h('p', { class: 'small muted', text: t && t.n ? `${t.n} done · ${pct(t.right / t.n)} right · median ${median(id) ?? '—'} s` : 'Not tried yet' }),
      h('div', { class: 'button-row' }, [1, 2, 3].map((lv) => h('a', { class: 'btn small', href: `#/csat/${id}?level=${lv}` }, LEVEL_LABEL[lv]))));
  }));
  const secs = paper ? Math.round((paper.durationMin * 60) / paper.questions) : 90;
  clear(body).append(
    h('section', { class: 'card' },
      h('h2', { text: 'CSAT Gym' }),
      h('p', { class: 'small muted', text: `Fresh questions every time: numbers are generated, so nothing repeats. Each question has a ${secs}-second target and a worked solution.` }),
      projected ? h('div', { class: `csat-proj${projected.warn ? ' warn' : ''}` },
        h('p', { class: 'big-number' }, h('strong', { text: `${projected.projected}` }), ` of ${projected.max} projected`),
        h('p', { class: 'small', text: `From your last ${Math.min(150, recent.length)} answers: ${pct(projected.accuracy)} right at a median ${projected.median ?? '—'} s, so about ${projected.reach} of ${paper.questions} questions in ${paper.durationMin} minutes.` }),
        projected.warn ? h('p', { class: 'warn-text', text: `Below the safety line of ${Math.round(1.25 * projected.qualifying * 10) / 10} (1.25 × the qualifying ${projected.qualifying}). CSAT is qualifying: give it regular practice.` })
          : projected.qualifying ? h('p', { class: 'small ok-text', text: `Above the safety line of ${Math.round(1.25 * projected.qualifying * 10) / 10} (1.25 × the qualifying ${projected.qualifying}).` }) : null)
        : h('p', { class: 'muted small', text: 'Answer a few sets to see your projected CSAT score.' }),
      h('a', { class: 'btn primary block-btn', href: '#/csat/mixed?level=mixed' }, 'Mixed set: 20 questions'),
      packItems.length ? h('a', { class: 'btn block-btn', href: '#/csat/pack' }, `Comprehension and pack questions (${packItems.length})`)
        : h('p', { class: 'small muted', text: 'Reading-comprehension passages come from imported packs (CSAT PYQs or mocks).' })),
    grid);
}
