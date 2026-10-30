// Mock player (#/mock/<id>): exam conditions with a question palette (answered, marked for
// review, not visited), a timer and negative marking from the profile. Progress is saved on
// this device as you go, so a closed tab resumes where it was. After submitting, the
// autopsy gate: every wrong answer and every right guess needs a cause before the score and
// analytics unlock. Then the results: score, bands, the skip simulator and breakdowns.

import { h, clear, toast, sheet, confirmSheet } from './ui.js';
import { app, allNodes, appendEvents, getSetting, setSetting } from './store.js';
import { CAUSE_LIST, trapPicker, atomPicker } from './sheets.js';
import { parseStatements } from './pyq.js';
import { bandStats, simulate, BANDS, BAND_LABEL } from './calib.js';
import { filled } from './cloze.js';
import * as clock from './clock.js';
import { formatDateTime, plural } from './util.js';

const LETTERS = ['a', 'b', 'c', 'd'];
const CONF = [['sure', 'Sure', 's'], ['5050', '50-50', '5'], ['guess', 'Guess', 'g']];
const FORMAT_NAME = { statement: 'Statements', single: 'Single answer', assertionReason: 'Statement-I / II', notCorrect: 'NOT correct', identify: 'Identify', match: 'Match', howMany: 'How many' };
const pct = (x) => (x === null || x === undefined || Number.isNaN(x) ? '—' : `${Math.round(x * 100)}%`);
const clockText = (ms) => {
  const s = Math.max(0, Math.round(ms / 1000));
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  return `${hh ? `${hh}:` : ''}${String(mm).padStart(hh ? 2 : 1, '0')}:${String(ss).padStart(2, '0')}`;
};

let player = null;

export function leave() {
  document.body.classList.remove('focus');
  if (player) player.stop();
  player = null;
}

async function loadQuestions(m) {
  const e = m.eventId ? await app.db.get('events', m.eventId) : null;
  return e && e.payload && Array.isArray(e.payload.questions) ? e.payload.questions : null;
}

export async function render(route) {
  const id = route.arg;
  const host = h('div', { class: 'mock-host' });
  await app.synced;
  const m = id && app.state.mocks[id];
  if (!m) {
    host.append(h('div', { class: 'card' }, h('h2', { text: 'Mock not found' }), h('p', { text: 'It may have been started on another device that has not synced yet.' }), h('a', { class: 'btn', href: '#/lab?tab=mocks' }, 'Back to mocks')));
    return host;
  }
  const qs = await loadQuestions(m);
  if (!qs) {
    host.append(h('div', { class: 'card error' }, h('h2', { text: 'This mock cannot be opened' }), h('p', { text: 'Its question paper is missing from the event log.' })));
    return host;
  }
  if (m.status === 'discarded') {
    host.append(h('div', { class: 'card' }, h('h2', { text: m.title }), h('p', { text: 'This mock was discarded before submitting.' }), h('a', { class: 'btn', href: '#/lab?tab=mocks' }, 'Back to mocks')));
    return host;
  }
  if (m.status === 'started') {
    setTimeout(() => { player = new Player(host, id, m, qs); player.start(); }, 0);
    return host;
  }
  if (!m.unlocked) autopsy(host, id, m, qs);
  else results(host, id, m, qs);
  return host;
}

// ------------------------------------------------------------------ player
class Player {
  constructor(host, id, m, qs) {
    this.host = host;
    this.id = id;
    this.m = m;
    this.qs = qs;
    this.key = `mockp.${id}`;
    this.p = null;
    this.timer = null;
    this.saveTimer = null;
    this.onKey = (e) => this.key_(e);
    this.onVis = () => { if (document.visibilityState === 'hidden') this.save(); };
    this.shownAt = 0;
  }

  async start() {
    const saved = await getSetting(this.key);
    this.p = saved && Array.isArray(saved.answers) && saved.answers.length === this.qs.length ? saved
      : { answers: this.qs.map(() => ({ choice: null, confidence: null, marked: false, visited: false, ms: 0 })), elapsedMs: 0, cur: 0 };
    this.lastTick = performance.now();
    document.body.classList.add('focus');
    document.addEventListener('keydown', this.onKey);
    document.addEventListener('visibilitychange', this.onVis);
    this.frame();
    this.go(this.p.cur || 0);
    this.timer = setInterval(() => this.tick(), 1000);
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
    this.account();
    this.save();
    document.removeEventListener('keydown', this.onKey);
    document.removeEventListener('visibilitychange', this.onVis);
  }

  // Elapsed time only counts while the page is visible.
  account() {
    const now = performance.now();
    if (document.visibilityState === 'visible' && this.p) {
      const d = now - this.lastTick;
      this.p.elapsedMs += d;
      const a = this.p.answers[this.p.cur];
      if (a) a.ms += d;
    }
    this.lastTick = now;
  }

  save() {
    if (!this.p) return;
    setSetting(this.key, this.p).catch(() => {});
  }

  saveSoon() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.save(), 400);
  }

  left() { return this.m.durationMs - this.p.elapsedMs; }

  tick() {
    this.account();
    this.timeEl.textContent = clockText(this.left());
    this.timeEl.classList.toggle('over', this.left() < 5 * 60000);
    if (Math.round(this.p.elapsedMs / 1000) % 5 === 0) this.save();
    if (this.left() <= 0) { toast('Time is up: the paper has been submitted.', { kind: 'warn', ms: 6000 }); this.submit(true); }
  }

  frame() {
    this.timeEl = h('span', { class: 'mock-time', 'aria-live': 'off', text: clockText(this.left()) });
    this.countEl = h('span', { class: 'small muted' });
    this.body = h('div', { class: 'mock-q' });
    this.foot = h('div', { class: 'rv-foot mock-foot' });
    clear(this.host).append(h('div', { class: 'rv mock' },
      h('div', { class: 'rv-head' },
        h('button', { class: 'btn small', type: 'button', onclick: () => this.exit() }, 'Pause'),
        h('div', { class: 'rv-title' }, h('strong', { text: this.m.title }), this.countEl),
        h('div', { class: 'mock-head-right' }, this.timeEl, h('button', { class: 'btn small', type: 'button', onclick: () => this.palette() }, 'Questions'))),
      this.body, this.foot));
  }

  counts() {
    let answered = 0; let marked = 0; let noConf = 0;
    for (const a of this.p.answers) {
      if (a.choice !== null) { answered++; if (!a.confidence) noConf++; }
      if (a.marked) marked++;
    }
    return { answered, marked, noConf, left: this.qs.length - answered };
  }

  go(i) {
    this.account();
    const n = this.qs.length;
    this.p.cur = Math.max(0, Math.min(n - 1, i));
    const a = this.p.answers[this.p.cur];
    a.visited = true;
    this.draw();
    this.saveSoon();
  }

  draw() {
    const i = this.p.cur;
    const q = this.qs[i];
    const a = this.p.answers[i];
    const c = this.counts();
    this.countEl.textContent = ` · Q ${i + 1} / ${this.qs.length} · ${c.answered} answered`;
    const parsed = parseStatements(q.stem);
    const stem = parsed ? h('div', null,
      parsed.intro ? h('p', { class: 'pv-stem pre', text: parsed.intro }) : null,
      h('ol', { class: 'mock-stmts' }, parsed.statements.map((s) => h('li', { text: s.text }))),
      parsed.outro ? h('p', { class: 'pv-stem pre', text: parsed.outro }) : null)
      : h('p', { class: 'pv-stem pre', text: q.stem });
    const opts = h('div', { class: 'opts', role: 'radiogroup', 'aria-label': 'Options' }, q.options.map((o, j) => h('button', {
      class: 'opt', type: 'button', role: 'radio', 'aria-checked': String(a.choice === j), 'aria-pressed': String(a.choice === j), 'data-nav': '',
      onclick: () => this.choose(j),
    }, h('span', { class: 'opt-key', text: `(${LETTERS[j]})` }), h('span', { class: 'opt-text', text: o }))));
    const conf = h('div', { class: 'conf-row mock-conf', role: 'group', 'aria-label': 'How sure are you?' },
      CONF.map(([id, label, k]) => h('button', { class: `btn conf conf-${id}`, type: 'button', 'aria-pressed': String(a.confidence === id), disabled: a.choice === null, onclick: () => this.confidence(id) }, label, h('span', { class: 'kbd', text: k.toUpperCase() }))));
    clear(this.body).append(
      h('div', { class: 'rv-meta' }, h('span', { class: 'badge', text: FORMAT_NAME[q.format] || q.format }), q.year ? h('span', { class: 'badge muted', text: `PYQ ${q.year}` }) : null, q.kind === 'gen' ? h('span', { class: 'badge muted', text: 'Generated' }) : null,
        a.marked ? h('span', { class: 'badge warn', text: 'Marked for review' }) : null),
      stem, opts,
      h('p', { class: 'small muted', text: a.choice === null ? 'Choose an option, or leave it blank: a blank costs nothing.' : 'How sure are you? (for your calibration; it does not change the score)' }),
      conf);
    clear(this.foot).append(h('div', { class: 'foot-row' },
      h('button', { class: 'btn grow', type: 'button', disabled: i === 0, onclick: () => this.go(i - 1) }, '‹ Prev'),
      h('button', { class: `btn grow${a.marked ? ' active' : ''}`, type: 'button', 'aria-pressed': String(a.marked), onclick: () => { a.marked = !a.marked; this.draw(); this.saveSoon(); } }, a.marked ? 'Unmark' : 'Mark'),
      a.choice !== null ? h('button', { class: 'btn grow', type: 'button', onclick: () => { a.choice = null; a.confidence = null; this.draw(); this.saveSoon(); } }, 'Clear') : null,
      i < this.qs.length - 1 ? h('button', { class: 'btn primary grow', type: 'button', onclick: () => this.go(i + 1) }, 'Next ›')
        : h('button', { class: 'btn primary grow', type: 'button', onclick: () => this.confirmSubmit() }, 'Submit')));
    window.scrollTo(0, 0);
  }

  choose(j) {
    const a = this.p.answers[this.p.cur];
    a.choice = a.choice === j ? null : j;
    if (a.choice === null) a.confidence = null;
    this.draw();
    this.saveSoon();
  }

  confidence(id) {
    const a = this.p.answers[this.p.cur];
    if (a.choice === null) return;
    a.confidence = id;
    this.saveSoon();
    if (this.p.cur < this.qs.length - 1) this.go(this.p.cur + 1);
    else this.draw();
  }

  palette() {
    const c = this.counts();
    const grid = h('div', { class: 'palette' }, this.qs.map((_, i) => {
      const a = this.p.answers[i];
      const cls = a.choice !== null ? 'answered' : a.visited ? 'skipped' : 'unvisited';
      return h('button', { class: `pal ${cls}${a.marked ? ' marked' : ''}${i === this.p.cur ? ' current' : ''}`, type: 'button', 'aria-label': `Question ${i + 1}: ${cls === 'answered' ? 'answered' : cls === 'skipped' ? 'not answered' : 'not visited'}${a.marked ? ', marked' : ''}`, onclick: () => { s.close(); this.go(i); } }, String(i + 1));
    }));
    const s = sheet({
      title: 'Questions',
      wide: true,
      body: h('div', null,
        h('p', { class: 'small', text: `${c.answered} answered · ${c.left} not answered · ${c.marked} marked for review${c.noConf ? ` · ${c.noConf} without a confidence tag` : ''}` }),
        h('div', { class: 'pal-legend small' }, h('span', { class: 'pal answered' }, '1'), ' answered ', h('span', { class: 'pal skipped' }, '2'), ' seen, blank ', h('span', { class: 'pal unvisited' }, '3'), ' not visited ', h('span', { class: 'pal marked' }, '4'), ' marked'),
        grid),
      actions: [{ label: 'Close', onClick: () => s.close() }, { label: 'Submit paper', kind: 'primary', onClick: () => { s.close(); this.confirmSubmit(); } }],
    });
  }

  async confirmSubmit() {
    const c = this.counts();
    const ok = await confirmSheet({
      title: 'Submit the paper?',
      message: h('div', null,
        h('p', { text: `${c.answered} of ${this.qs.length} answered, ${c.left} blank, ${c.marked} marked for review.` }),
        c.noConf ? h('p', { class: 'small muted', text: `${plural(c.noConf, 'answer')} without a confidence tag will not count towards calibration.` }) : null,
        h('p', { class: 'small muted', text: `Time left: ${clockText(this.left())}. After submitting comes the autopsy; the score unlocks when it is done.` })),
      confirmLabel: 'Submit',
    });
    if (ok) this.submit(false);
  }

  async submit(auto) {
    if (this.submitted) return;
    this.submitted = true;
    this.stop();
    const answers = this.p.answers.map((a) => ({ choice: a.choice, confidence: a.choice === null ? null : a.confidence, ms: Math.round(a.ms), marked: a.marked }));
    try {
      await appendEvents([['mock.submitted', { mockId: this.id, answers, elapsedMs: Math.round(Math.min(this.p.elapsedMs, this.m.durationMs)), auto: !!auto }]]);
    } catch (e) {
      this.submitted = false;
      toast(`Could not submit: ${e.message}. Your answers are still saved on this device.`, { kind: 'error', ms: 8000 });
      return;
    }
    await setSetting(this.key, null).catch(() => {});
    player = null;
    document.body.classList.remove('focus');
    const m = app.state.mocks[this.id];
    if (m.unlocked) results(this.host, this.id, m, this.qs);
    else autopsy(this.host, this.id, m, this.qs);
  }

  async exit() {
    this.stop();
    player = null;
    document.body.classList.remove('focus');
    const choice = await new Promise((resolve) => {
      const s = sheet({
        title: 'Pause this mock?',
        body: h('p', { text: `Your answers and the clock (${clockText(this.left())} left) are saved on this device. Resume any time from Prelims Lab → Mocks.` }),
        onClose: () => resolve('pause'),
        actions: [
          { label: 'Discard mock', kind: 'danger', onClick: () => { resolve('discard'); s.close(); } },
          { label: 'Pause', kind: 'primary', onClick: () => { resolve('pause'); s.close(); } },
        ],
      });
    });
    if (choice === 'discard') {
      const sure = await confirmSheet({ title: 'Discard this mock?', message: 'The paper and your answers so far are dropped; nothing is scored.', confirmLabel: 'Discard', danger: true });
      if (sure) {
        await appendEvents([['mock.discarded', { mockId: this.id }]]);
        await setSetting(this.key, null).catch(() => {});
      }
    }
    location.hash = '#/lab?tab=mocks';
  }

  key_(e) {
    if (document.body.classList.contains('sheet-open') || e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    let handled = true;
    if (LETTERS.includes(k)) this.choose(LETTERS.indexOf(k));
    else if (k === 's' || k === '5' || k === 'g') this.confidence(k === 's' ? 'sure' : k === '5' ? '5050' : 'guess');
    else if (k === 'ArrowRight' || k === 'j' || k === 'n') this.go(this.p.cur + 1);
    else if (k === 'ArrowLeft' || k === 'k' || k === 'p') this.go(this.p.cur - 1);
    else if (k === 'm') { const a = this.p.answers[this.p.cur]; a.marked = !a.marked; this.draw(); this.saveSoon(); }
    else if (k === 'q') this.palette();
    else handled = false;
    if (handled) e.preventDefault();
  }
}

// ------------------------------------------------------------------ autopsy
function questionCard(q, i, m, extra) {
  const choice = m.choice[i];
  const parsed = parseStatements(q.stem);
  return h('div', { class: 'card autopsy-q' },
    h('div', { class: 'row-between' }, h('strong', { text: `Q ${i + 1}` }),
      h('span', null, h('span', { class: 'badge', text: FORMAT_NAME[q.format] || q.format }), m.conf[i] ? h('span', { class: 'badge muted', text: BAND_LABEL[m.conf[i]] }) : null)),
    parsed ? h('div', null, parsed.intro ? h('p', { class: 'pre', text: parsed.intro }) : null, h('ol', { class: 'mock-stmts' }, parsed.statements.map((s) => h('li', { text: s.text }))), parsed.outro ? h('p', { class: 'pre', text: parsed.outro }) : null)
      : h('p', { class: 'pre', text: q.stem }),
    h('ol', { class: 'options' }, q.options.map((o, j) => h('li', { class: j === q.answer ? 'correct' : j === choice ? 'chosen-wrong' : '' },
      `(${LETTERS[j]}) ${o}`, j === q.answer ? ' ✓' : '', j === choice && j !== q.answer ? ' ✗ your answer' : j === choice ? ' (your answer)' : ''))),
    choice === null ? h('p', { class: 'small muted', text: 'Left blank.' }) : null,
    q.explanation ? h('p', { class: 'pre small' }, h('span', { class: 'muted', text: 'Why: ' }), q.explanation) : null,
    (q.traps || []).length ? h('p', { class: 'small' }, h('span', { class: 'muted', text: 'Traps: ' }), q.traps.map((t) => `${Number.isInteger(t.statement) ? `statement ${t.statement}` : 'a statement'}: ${String(t.tag).replace(/-/g, ' ')}`).join(' · ')) : null,
    extra);
}

function autopsy(host, id, m, qs) {
  const draw = () => {
    const mm = app.state.mocks[id];
    if (mm.unlocked) { results(host, id, mm, qs); return; }
    const done = mm.needs.filter((i) => mm.tags[i]).length;
    const wrong = mm.needs.filter((i) => mm.choice[i] !== mm.key[i]).length;
    const list = h('div', { class: 'stack' });
    for (const i of mm.needs) {
      const q = qs[i];
      const tagged = mm.tags[i];
      const right = mm.choice[i] === mm.key[i];
      const btns = h('div', { class: 'cause-chips' }, CAUSE_LIST.map(([cid, label]) => h('button', {
        class: `chip-btn${tagged === cid ? ' on' : ''}`, type: 'button', 'aria-pressed': String(tagged === cid),
        onclick: async () => {
          let trap = null;
          let other = null;
          if (cid === 'misread' || cid === 'trap') trap = await trapPicker(((q.traps || [])[0] || {}).tag || null);
          if (cid === 'confused') {
            const pick = await atomPicker({ title: 'Confused it with which atom?', exclude: q.atoms || [] });
            if (!pick) return;
            other = pick.id;
          }
          await appendEvents([['mock.cause', { mockId: id, i, cause: cid, trap, other, atomIds: q.atoms || [] }]]);
          draw();
        },
      }, label)));
      list.append(questionCard(q, i, mm, h('div', { class: `autopsy-tag${tagged ? ' done' : ''}` },
        h('p', { class: 'small' }, h('strong', { text: right ? 'Right, but a guess: ' : 'Wrong: ' }), tagged ? `tagged “${(CAUSE_LIST.find((c) => c[0] === tagged) || [])[1]}”. Tap another to change it.` : 'why?'),
        btns)));
    }
    clear(host).append(h('div', { class: 'autopsy' },
      h('section', { class: 'card hero' },
        h('h2', { text: `Autopsy: ${mm.title}` }),
        h('p', { text: `${wrong} wrong ${wrong === 1 ? 'answer' : 'answers'} and ${mm.needs.length - wrong} right ${mm.needs.length - wrong === 1 ? 'guess' : 'guesses'} need a cause before the score unlocks.` }),
        h('div', { class: 'progress', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(mm.needs.length), 'aria-valuenow': String(done) }, h('span', { style: `width:${Math.round((done / Math.max(1, mm.needs.length)) * 100)}%` })),
        h('p', { class: 'small muted', text: `${done} of ${mm.needs.length} tagged. Didn't know, Forgot and Confused put the question's atoms in today's reviews.` })),
      list));
  };
  draw();
}

// ------------------------------------------------------------------ results
function results(host, id, m, qs) {
  const nodes = allNodes();
  const answers = m.choice.map((choice, i) => ({ choice, confidence: m.conf[i] }));
  const graded = answers.map((a, i) => (a.choice === null ? null : { c: a.confidence, ok: a.choice === m.key[i], i })).filter(Boolean);
  const stats = bandStats(graded.filter((x) => x.c), m.marks);
  const sim = simulate(qs.map((q) => ({ answer: q.answer })), answers, m.marks);
  const group = (keyFn) => {
    const out = new Map();
    qs.forEach((q, i) => {
      const k = keyFn(q) || '(other)';
      const g = out.get(k) || { n: 0, right: 0, wrong: 0 };
      g.n++;
      if (m.choice[i] !== null) { if (m.choice[i] === m.key[i]) g.right++; else g.wrong++; }
      out.set(k, g);
    });
    return [...out.entries()].sort((a, b) => b[1].n - a[1].n);
  };
  const table = (rows, label) => h('div', { class: 'table-wrap' }, h('table', { class: 'counts-table compact' },
    h('thead', null, h('tr', null, [label, 'Qs', 'Right', 'Wrong', 'Marks'].map((x) => h('th', { text: x })))),
    h('tbody', null, rows.map(([k, g]) => h('tr', null, h('th', { text: k }), h('td', { text: String(g.n) }), h('td', { text: String(g.right) }), h('td', { text: String(g.wrong) }),
      h('td', { text: String(Math.round((g.right * m.marks.right - g.wrong * m.marks.wrong) * 100) / 100) }))))));
  const avg = m.right + m.wrong ? m.ms.reduce((a, b) => a + b, 0) / Math.max(1, m.ms.filter((x) => x > 0).length) / 1000 : 0;
  const review = h('div', { class: 'stack' });
  qs.forEach((q, i) => review.append(questionCard(q, i, m, m.tags[i] ? h('p', { class: 'small muted', text: `Cause: ${(CAUSE_LIST.find((c) => c[0] === m.tags[i]) || [])[1]}` }) : null)));
  clear(host).append(h('div', { class: 'mock-results' },
    h('section', { class: 'card hero' },
      h('h2', { text: m.title }),
      h('p', { class: 'big-number' }, h('strong', { text: String(m.score) }), ` / ${m.max}`),
      h('p', { text: `${m.right} right · ${m.wrong} wrong · ${m.skipped} blank · accuracy ${pct(m.right / Math.max(1, m.right + m.wrong))} of attempted` }),
      h('p', { class: 'small muted', text: `Submitted ${formatDateTime(m.submittedTs)} after ${clockText(m.elapsedMs)} of ${clockText(m.durationMs)}; about ${Math.round(avg)} s per question you spent time on.` }),
      h('div', { class: 'button-row' }, h('a', { class: 'btn', href: '#/lab?tab=mocks' }, 'All mocks'), h('a', { class: 'btn', href: '#/lab?tab=calib' }, 'Calibration'))),
    h('section', { class: 'card' },
      h('h3', { text: 'Confidence in this mock' }),
      h('table', { class: 'counts-table' }, h('thead', null, h('tr', null, ['Band', 'Answers', 'Accuracy', 'Marks per attempt'].map((x) => h('th', { text: x })))),
        h('tbody', null, BANDS.map((b) => h('tr', null, h('th', { text: BAND_LABEL[b] }), h('td', { text: String(stats[b].n) }), h('td', { text: pct(stats[b].acc) }), h('td', { text: stats[b].ev === null ? '—' : stats[b].ev.toFixed(2) }))))),
      h('h3', { text: 'Had you skipped a band' }),
      h('table', { class: 'counts-table' }, h('tbody', null, sim.map((r) => h('tr', null, h('th', { text: r.label }), h('td', { text: `${r.score} / ${r.max}` }), h('td', { class: 'small muted', text: `${r.attempted} attempted` })))))),
    h('section', { class: 'card' }, h('h3', { text: 'By subject' }), table(group((q) => (q.subject ? (nodes.get(q.subject) || {}).title || q.subject : null)), 'Subject')),
    h('section', { class: 'card' }, h('h3', { text: 'By format' }), table(group((q) => FORMAT_NAME[q.format] || q.format), 'Format')),
    h('details', { class: 'card' }, h('summary', null, h('strong', { text: `All ${qs.length} questions with answers` })), review)));
}
