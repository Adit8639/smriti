// CSAT Gym sessions. #/csat/<type>?level=1|2|3, #/csat/mixed?level=mixed (20 questions
// across every type), #/csat/pack (comprehension and other CSAT items from packs).
// Per question: answer → confidence (reveals) → worked solution, against a per-question
// target from the CSAT paper. Nothing repeats within a set, and recent questions are
// avoided across sets.

import { h, add, clear, toast } from './ui.js';
import { app, activeProfile, appendEvents, flushState, emit } from './store.js';
import { call } from './data.js';
import { generateSet, CSAT_TYPES, CSAT_LABEL, LEVEL_LABEL } from './csat.js';
import { csatPaper } from './view-lab.js';
import { parseStatements } from './pyq.js';
import { ulid } from './ulid.js';
import { freshSeed, rng } from './rng.js';
import * as clock from './clock.js';

const LETTERS = ['a', 'b', 'c', 'd'];
const CONF = [['sure', 'Sure', 's'], ['5050', '50-50', '5'], ['guess', 'Guess', 'g']];
const SET_SIZE = 20;
let current = null;

export function leave() {
  document.body.classList.remove('focus');
  if (current) current.end(true);
  current = null;
}

export async function render(route) {
  const host = h('div', { class: 'csat-host' });
  const type = route.arg || 'mixed';
  const levelRaw = route.query.get('level');
  const level = levelRaw === 'mixed' ? 'mixed' : [1, 2, 3].includes(Number(levelRaw)) ? Number(levelRaw) : 1;
  const paper = csatPaper(activeProfile());
  let questions;
  let title;
  if (type === 'pack') {
    const items = paper ? await call('csat.packItems', { paperId: paper.id }) : [];
    const r = rng(freshSeed(clock.now()));
    questions = r.shuffle(items).slice(0, SET_SIZE).map((q) => ({ type: 'pack', level: 2, sig: `pack|${q.id}`, stem: q.stem, options: q.options, answer: q.answer, solution: q.elimination || '', pyqId: q.id, year: q.year }));
    title = 'CSAT from packs';
  } else {
    const types = type === 'mixed' ? CSAT_TYPES.map((t) => t[0]) : [type];
    if (!CSAT_LABEL[type] && type !== 'mixed') {
      host.append(h('div', { class: 'card' }, h('p', { text: 'Unknown CSAT drill.' }), h('a', { class: 'btn', href: '#/lab?tab=csat' }, 'Back')));
      return host;
    }
    const avoid = new Set(app.state.csat.recent.map((x) => x.q).filter(Boolean));
    questions = generateSet({ types, level, n: SET_SIZE, seed: freshSeed(clock.now()), avoid });
    title = type === 'mixed' ? 'CSAT mixed set' : `${CSAT_LABEL[type]} · ${LEVEL_LABEL[level] || 'Mixed'}`;
  }
  if (!questions.length) {
    host.append(h('div', { class: 'card' }, h('h2', { text: 'Nothing to practise here yet' }), h('p', { text: 'Import CSAT PYQ or mock packs to get comprehension passages.' }), h('a', { class: 'btn', href: '#/lab?tab=csat' }, 'Back to the CSAT Gym')));
    return host;
  }
  const targetMs = paper ? Math.round((paper.durationMin * 60000) / paper.questions) : 90000;
  setTimeout(() => { current = new Gym(host, { questions, title, targetMs, again: route }); current.start(); }, 0);
  return host;
}

class Gym {
  constructor(host, { questions, title, targetMs }) {
    this.host = host;
    this.qs = questions;
    this.title = title;
    this.targetMs = targetMs;
    this.i = 0;
    this.log = [];
    this.sessionId = ulid(clock.now());
    this.onKey = (e) => this.key(e);
    this.ended = false;
  }

  async start() {
    document.body.classList.add('focus');
    document.addEventListener('keydown', this.onKey);
    await appendEvents([['session.started', { sessionId: this.sessionId, kind: 'csat' }]]);
    this.startedAt = clock.now();
    this.show();
  }

  show() {
    const q = this.qs[this.i];
    this.cur = { q, choice: null, stage: 'answer', shownAt: performance.now() };
    this.clockEl = h('span', { class: 'mock-time', text: '0:00' });
    clearInterval(this.tickT);
    this.tickT = setInterval(() => this.tick(), 500);
    this.optsEl = h('div', { class: 'opts', role: 'radiogroup', 'aria-label': 'Options' });
    this.revealEl = h('div', { class: 'rv-reveal', hidden: true });
    this.foot = h('div', { class: 'rv-foot' });
    const parsed = parseStatements(q.stem);
    const stem = parsed ? h('div', null, parsed.intro ? h('p', { class: 'pv-stem pre', text: parsed.intro }) : null, h('ol', { class: 'mock-stmts' }, parsed.statements.map((s) => h('li', { text: s.text }))), parsed.outro ? h('p', { class: 'pv-stem pre', text: parsed.outro }) : null)
      : h('p', { class: 'pv-stem pre', text: q.stem });
    clear(this.host).append(h('div', { class: 'rv' },
      h('div', { class: 'rv-head' },
        h('button', { class: 'btn small', type: 'button', onclick: () => this.end(true) }, 'End'),
        h('div', { class: 'rv-title' }, h('strong', { text: this.title }), h('span', { class: 'rv-count', text: ` · ${this.i + 1} / ${this.qs.length}` })),
        this.clockEl),
      h('div', { class: 'rv-body' },
        h('div', { class: 'rv-meta' }, h('span', { class: 'badge', text: q.type === 'pack' ? (q.year ? `CSAT ${q.year}` : 'From a pack') : CSAT_LABEL[q.type] }), q.type !== 'pack' ? h('span', { class: 'badge muted', text: LEVEL_LABEL[q.level] }) : null),
        stem, this.optsEl, this.revealEl),
      this.foot));
    this.drawOpts();
    this.drawFoot();
    window.scrollTo(0, 0);
  }

  elapsed() { return Math.round(performance.now() - this.cur.shownAt); }

  tick() {
    if (!this.cur || this.cur.stage !== 'answer') return;
    const ms = this.elapsed();
    this.clockEl.textContent = `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;
    this.clockEl.classList.toggle('over', ms > this.targetMs);
  }

  drawOpts() {
    const c = this.cur;
    clear(this.optsEl).append(...c.q.options.map((o, j) => h('button', {
      class: `opt${c.stage === 'revealed' ? (j === c.q.answer ? ' right' : j === c.choice ? ' wrong' : '') : ''}`, type: 'button', role: 'radio', 'data-nav': '',
      'aria-pressed': String(c.choice === j), 'aria-checked': String(c.choice === j), disabled: c.stage === 'revealed',
      onclick: () => { if (c.stage !== 'answer') return; c.choice = c.choice === j ? null : j; this.drawOpts(); this.drawFoot(); },
    }, h('span', { class: 'opt-key', text: `(${LETTERS[j]})` }), h('span', { class: 'opt-text', text: o }))));
  }

  drawFoot() {
    const c = this.cur;
    clear(this.foot);
    if (c.stage === 'answer') {
      this.foot.append(
        h('p', { class: 'foot-hint small muted', text: c.choice === null ? `Work it out (target ${Math.round(this.targetMs / 1000)} s), pick an option, then say how sure you are.` : 'How sure are you? Picking one reveals the answer.' }),
        h('div', { class: 'foot-row conf-row' }, CONF.map(([id, label, k]) => h('button', { class: `btn conf conf-${id}`, type: 'button', disabled: c.choice === null, onclick: () => this.reveal(id) }, label, h('span', { class: 'kbd', text: k.toUpperCase() })))),
        h('div', { class: 'foot-tools' }, h('button', { class: 'link-btn small', type: 'button', onclick: () => this.reveal(null, true) }, 'Skip and show the solution')));
      return;
    }
    this.foot.append(h('div', { class: 'foot-row' }, h('button', { class: 'btn primary grow', type: 'button', onclick: () => this.next() }, this.i < this.qs.length - 1 ? 'Next' : 'Finish', h('span', { class: 'kbd', text: 'Space' }))));
  }

  async reveal(confidence, skipped = false) {
    const c = this.cur;
    if (c.stage !== 'answer' || (!skipped && c.choice === null)) return;
    c.stage = 'revealed';
    c.ms = this.elapsed();
    const correct = !skipped && c.choice === c.q.answer;
    this.drawOpts();
    clear(this.revealEl);
    this.revealEl.hidden = false;
    add(this.revealEl,
      h('p', { class: `verdict ${correct ? 'right' : 'wrong'}`, text: skipped ? 'Skipped' : correct ? 'Correct' : 'Not quite' }),
      h('p', { class: 'small' }, h('span', { class: 'muted', text: 'Answer: ' }), `(${LETTERS[c.q.answer]}) ${c.q.options[c.q.answer]}`, h('span', { class: 'muted', text: ` · ${Math.round(c.ms / 1000)} s${c.ms > this.targetMs ? ' (over target)' : ''}` })),
      c.q.solution ? h('p', { class: 'pre solution' }, h('span', { class: 'muted', text: 'Solution: ' }), c.q.solution) : null);
    this.log.push({ type: c.q.type, correct, ms: c.ms, skipped });
    this.drawFoot();
    try {
      await appendEvents([['csat.answered', { qid: c.q.sig, type: c.q.type, level: c.q.level, choice: skipped ? null : c.choice, correct, confidence: skipped ? null : confidence, ms: c.ms, sessionId: this.sessionId, source: c.q.type === 'pack' ? 'pack' : 'gen', pyqId: c.q.pyqId || null }]]);
    } catch (e) {
      toast(`Could not save this answer: ${e.message}`, { kind: 'error' });
    }
  }

  next() {
    if (this.i < this.qs.length - 1) { this.i++; this.show(); } else this.end(false);
  }

  async end(early) {
    if (this.ended) return;
    this.ended = true;
    clearInterval(this.tickT);
    document.removeEventListener('keydown', this.onKey);
    document.body.classList.remove('focus');
    try { await appendEvents([['session.ended', { sessionId: this.sessionId }]]); } catch (_) { /* best effort */ }
    flushState();
    current = null;
    if (!this.host.isConnected) return;
    const n = this.log.length;
    const right = this.log.filter((x) => x.correct).length;
    const timed = this.log.filter((x) => !x.skipped);
    const avg = timed.length ? Math.round(timed.reduce((a, x) => a + x.ms, 0) / timed.length / 1000) : null;
    const byType = new Map();
    for (const x of this.log) { const g = byType.get(x.type) || { n: 0, right: 0 }; g.n++; if (x.correct) g.right++; byType.set(x.type, g); }
    clear(this.host).append(h('div', { class: 'focus-frame' }, h('div', { class: 'card summary' },
      h('h2', { text: early ? 'Set ended' : 'Set done' }),
      n ? h('p', { class: 'big-number' }, h('strong', { text: `${right} / ${n}` }), ' right') : h('p', { text: 'No questions answered.' }),
      avg !== null ? h('p', { class: 'small', text: `Average ${avg} s per question (target ${Math.round(this.targetMs / 1000)} s).` }) : null,
      byType.size > 1 ? h('table', { class: 'counts-table' }, h('tbody', null, [...byType].map(([t, g]) => h('tr', null, h('th', { text: CSAT_LABEL[t] || 'From packs' }), h('td', { text: `${g.right} / ${g.n}` }))))) : null,
      h('div', { class: 'button-row' }, h('a', { class: 'btn primary', href: '#/lab?tab=csat' }, 'Back to the CSAT Gym'), h('button', { class: 'btn', type: 'button', onclick: () => emit('rerender') }, 'Another set')))));
  }

  key(e) {
    if (document.body.classList.contains('sheet-open') || e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    const c = this.cur;
    if (!c) return;
    let handled = true;
    if (k === 'Escape') this.end(true);
    else if (c.stage === 'answer' && LETTERS.includes(k)) { c.choice = LETTERS.indexOf(k); this.drawOpts(); this.drawFoot(); }
    else if (c.stage === 'answer' && (k === 's' || k === '5' || k === 'g') && c.choice !== null) this.reveal(k === 's' ? 'sure' : k === '5' ? '5050' : 'guess');
    else if (c.stage === 'revealed' && (k === ' ' || k === 'Enter')) this.next();
    else handled = false;
    if (handled) e.preventDefault();
  }
}
