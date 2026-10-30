// Offline intake. #/intake: choose a PDF (already in Sources) and pages; candidates are
// found by rules, duplicates of your atoms dropped, topics suggested by keywords and, if
// you load it, the offline matching model. #/intake/<batchId>: the batch. #/triage/<id>:
// the triage deck: the cloze first, then the sentence; swipe right to keep (an atom with its
// source page, origin "rule"), left to discard, up to edit. Every swipe is logged.

import { h, clear, toast, sheet } from './ui.js';
import { app, allNodes, activeProfile, appendEvents, getSetting, setSetting, emit } from './store.js';
import { call } from './data.js';
import { nodePicker } from './sheets.js';
import { relatedFor } from './view-ca.js';
import { caShelfFor } from './intake.js';
import { modelCached, loadModel, embed, nodeVectors, rerank, MODEL_MB } from './embed.js';
import { inProfileScope } from './tree.js';
import { ulid } from './ulid.js';
import * as clock from './clock.js';
import { formatDateTime, localDate, plural } from './util.js';

const KEY = (id) => `intake.${id}`;
let deck = null;

export function leave() {
  document.body.classList.remove('focus');
  if (deck) deck.stop();
  deck = null;
}

async function batches() {
  return (await app.db.getAll('settings')).filter((r) => r.key.startsWith('intake.') && r.value && r.value.id).map((r) => r.value).sort((a, b) => b.createdAt - a.createdAt);
}
const saveBatch = (b) => setSetting(KEY(b.id), b);

export async function render(route) {
  if (route.name === 'triage') return triage(route.arg);
  if (route.arg) return batchView(route.arg);
  return hub();
}

// ------------------------------------------------------------------ hub
async function hub() {
  const sources = (await app.db.getAll('sources')).filter((r) => r.kind !== 'photo' && Array.isArray(r.texts));
  const list = await batches();
  const root = h('div', { class: 'intake' });
  const srcSel = h('select', { 'aria-label': 'Source' }, sources.map((r) => h('option', { value: r.id, text: `${(app.state.sources[r.id] || {}).title || r.title} (${r.pages} pages)` })));
  const from = h('input', { type: 'number', min: '1', class: 'field-input short', value: '1', 'aria-label': 'From page' });
  const to = h('input', { type: 'number', min: '1', class: 'field-input short', 'aria-label': 'To page' });
  const isCa = h('input', { type: 'checkbox' });
  const caDate = h('input', { type: 'date', class: 'field-input', value: localDate(clock.now()), 'aria-label': 'Date of the current affairs' });
  const setTo = () => { const r = sources.find((x) => x.id === srcSel.value); if (r) { to.value = String(r.pages); to.max = String(r.pages); from.max = String(r.pages); } };
  srcSel.addEventListener('change', setTo);
  setTo();
  const go = h('button', { class: 'btn primary', type: 'button', disabled: !sources.length }, 'Find candidates');
  go.onclick = async () => {
    go.disabled = true;
    go.textContent = 'Reading…';
    try {
      const id = ulid(clock.now());
      const t0 = performance.now();
      const r = await call('intake.extract', { sourceId: srcSel.value, from: Number(from.value) || 1, to: Number(to.value) || 0, batchId: id, profile: activeProfile() });
      const rec = sources.find((x) => x.id === srcSel.value);
      const b = { id, sourceId: srcSel.value, title: (app.state.sources[srcSel.value] || {}).title || rec.title, createdAt: clock.now(), from: Number(from.value) || 1, to: Number(to.value) || rec.pages, isCa: isCa.checked, caDate: isCa.checked ? caDate.value : null, stats: { ...r.stats, totalMs: Math.round(performance.now() - t0) }, candidates: r.candidates, decisions: {}, sharpened: false };
      await saveBatch(b);
      location.hash = `#/intake/${id}`;
    } catch (e) {
      toast(`Could not read the source: ${e.message}`, { kind: 'error', ms: 8000 });
      go.disabled = false;
      go.textContent = 'Find candidates';
    }
  };
  root.append(h('section', { class: 'card' },
    h('h2', { text: 'Intake: facts from a PDF' }),
    h('p', { class: 'small muted', text: 'Finds fact-dense sentences by rules (Article and Amendment numbers, years, percentages, ₹ and crore, launched, established, ratified, rivers, national parks and Ramsar sites, indices, reports, ministries, schemes), drops duplicates of your atoms, and suggests a topic. You keep or discard each in about two seconds. No AI, nothing leaves the device.' }),
    sources.length ? h('div', { class: 'form' },
      h('label', { class: 'field' }, h('span', { text: 'Source' }), srcSel),
      h('div', { class: 'field-row' }, h('label', { class: 'field' }, h('span', { text: 'From page' }), from), h('label', { class: 'field' }, h('span', { text: 'To page' }), to)),
      h('label', { class: 'check' }, isCa, h('span', { text: 'Current affairs: kept facts archive after their shelf life (540 days; 900 for reports and indices)' })),
      h('label', { class: 'field' }, h('span', { text: 'Date of these current affairs' }), caDate),
      go)
      : h('p', { class: 'muted', text: 'Add a PDF in Sources first (More → Sources).' })));
  if (list.length) {
    root.append(h('h2', { class: 'section-title', text: 'Your intakes' }), h('div', { class: 'stack' }, list.map((b) => {
      const decided = Object.keys(b.decisions).length;
      return h('a', { class: 'card item', href: decided < b.candidates.length ? `#/triage/${b.id}` : `#/intake/${b.id}`, 'data-nav': '' },
        h('div', { class: 'row-between' }, h('strong', { text: b.title }), h('span', { class: `badge ${decided < b.candidates.length ? 'warn' : 'ok'}`, text: decided < b.candidates.length ? `${b.candidates.length - decided} to triage` : 'Done' })),
        h('span', { class: 'small muted', text: `Pages ${b.from}–${b.to} · ${plural(b.candidates.length, 'candidate')} · ${formatDateTime(b.createdAt)}${b.isCa ? ' · current affairs' : ''}` }));
    })));
  }
  return root;
}

// ------------------------------------------------------------------ one batch
async function batchView(id) {
  const b = await getSetting(KEY(id));
  if (!b) return h('div', { class: 'card' }, h('p', { text: 'This intake is not on this device.' }), h('a', { class: 'btn', href: '#/intake' }, 'Intake'));
  const nodes = allNodes();
  const decided = Object.values(b.decisions);
  const kept = decided.filter((d) => d.action === 'keep' || d.action === 'edit').length;
  const sharpenBox = h('div');
  const cached = await modelCached();
  const sharpen = h('button', { class: 'btn', type: 'button', disabled: b.sharpened || !b.candidates.length }, b.sharpened ? 'Topics sharpened with the offline model' : cached ? 'Sharpen topic suggestions (offline model)' : `Sharpen topic suggestions (downloads a ${MODEL_MB} MB model once)`);
  sharpen.onclick = async () => {
    sharpen.disabled = true;
    const status = h('p', { class: 'small muted', text: 'Loading the model…' });
    clear(sharpenBox).append(status);
    try {
      await loadModel((p) => { if (p.total) status.textContent = `Downloading the model: ${Math.round((p.loaded / p.total) * 100)}%`; });
      const profile = activeProfile();
      const scoped = [...nodes.values()].filter((n) => inProfileScope(n, profile));
      status.textContent = `Reading ${scoped.length} topics (first time only)…`;
      const nv = await nodeVectors(scoped, (p) => { status.textContent = `Reading topics: ${p.done} of ${p.total}`; });
      const todo = b.candidates;
      status.textContent = `Matching ${todo.length} candidates…`;
      const cv = await embed(todo.map((c) => c.sentence), (p) => { status.textContent = `Matching candidates: ${p.done} of ${p.total}`; });
      b.candidates = rerank(todo, cv, nv);
      b.sharpened = true;
      await saveBatch(b);
      toast('Topic suggestions sharpened.', { kind: 'ok' });
      emit('rerender');
    } catch (e) {
      clear(sharpenBox).append(h('p', { class: 'warn-text small', text: `The model could not run: ${e.message}. Keyword suggestions still work.` }));
      sharpen.disabled = false;
    }
  };
  const left = b.candidates.length - decided.length;
  return h('div', { class: 'intake-batch' },
    h('nav', { class: 'crumbs' }, h('a', { href: '#/intake' }, 'Intake'), ' / ', b.title),
    h('section', { class: 'card' },
      h('h2', { text: b.title }),
      h('p', { text: `${plural(b.candidates.length, 'candidate')} from pages ${b.from}–${b.to}.` }),
      h('p', { class: 'small muted', text: `${b.stats.scanned} sentences read, ${b.stats.duplicates} duplicates of existing atoms skipped, in ${(b.stats.totalMs / 1000).toFixed(1)} s.${b.isCa ? ` Current affairs dated ${b.caDate}.` : ''}` }),
      h('div', { class: 'button-row' },
        left > 0 ? h('a', { class: 'btn primary', href: `#/triage/${b.id}` }, `Triage ${left === b.candidates.length ? '' : 'the remaining '}${plural(left, 'card')}`) : h('span', { class: 'badge ok', text: 'Triage done' }),
        sharpen),
      sharpenBox,
      decided.length ? h('p', { class: 'small', text: `${kept} kept, ${decided.length - kept} discarded so far.` }) : null,
      kept ? h('a', { class: 'btn small', href: `#/practice/atoms?ids=${decided.filter((d) => d.atomId).map((d) => encodeURIComponent(d.atomId)).join(',')}` }, 'Review the kept atoms now') : null),
    h('div', { class: 'stack' }, b.candidates.slice(0, 200).map((c) => {
      const d = b.decisions[c.id];
      return h('div', { class: `card item cand${d ? ` ${d.action}` : ''}` },
        h('div', { class: 'row-between' }, h('span', { class: 'small muted', text: `p. ${c.page} · ${c.hits.join(', ')}` }), d ? h('span', { class: `badge ${d.action === 'discard' ? 'muted' : 'ok'}`, text: d.action === 'discard' ? 'Discarded' : 'Kept' }) : null),
        h('p', { text: c.sentence }),
        h('p', { class: 'small muted', text: c.nodes.length ? `Topic: ${c.nodes.map((n) => (nodes.get(n.nodeId) || {}).title || n.nodeId).join(' · ')}` : 'No topic suggestion' }));
    })));
}

// ------------------------------------------------------------------ triage deck
async function triage(id) {
  const host = h('div', { class: 'triage-host' });
  const b = await getSetting(KEY(id));
  if (!b) { host.append(h('div', { class: 'card' }, h('p', { text: 'This intake is not on this device.' }), h('a', { class: 'btn', href: '#/intake' }, 'Intake'))); return host; }
  setTimeout(() => { deck = new Deck(host, b); deck.start(); }, 0);
  return host;
}

class Deck {
  constructor(host, b) {
    this.host = host;
    this.b = b;
    this.queue = b.candidates.filter((c) => !b.decisions[c.id]);
    this.i = 0;
    this.kept = 0;
    this.started = performance.now();
    this.nodes = allNodes();
    this.onKey = (e) => this.key(e);
    this.sessionId = ulid(clock.now());
  }

  async start() {
    document.body.classList.add('focus');
    document.addEventListener('keydown', this.onKey);
    await appendEvents([['session.started', { sessionId: this.sessionId, kind: 'triage' }]]);
    this.show();
  }

  stop() {
    document.removeEventListener('keydown', this.onKey);
    appendEvents([['session.ended', { sessionId: this.sessionId }]]).catch(() => {});
  }

  show() {
    const c = this.queue[this.i];
    if (!c) { this.done(); return; }
    // No suggestion: offer the topic last used in this batch (one source is usually one area).
    const suggested = (c.nodes[0] || {}).nodeId || null;
    this.cur = { c, revealed: false, node: suggested || this.lastNode || null, sticky: !suggested && !!this.lastNode, shownAt: performance.now() };
    const n = this.cur.node && this.nodes.get(this.cur.node);
    this.card = h('div', { class: 'tri-card', tabindex: '0', role: 'group', 'aria-label': 'Candidate card' },
      h('p', { class: 'small muted', text: `${this.b.title} · p. ${c.page}` }),
      h('p', { class: 'tri-cloze', text: c.cloze }),
      this.answerEl = h('p', { class: 'tri-answer', hidden: true }, h('span', { class: 'muted', text: 'Answer: ' }), h('strong', { text: c.answer })),
      this.sentEl = h('p', { class: 'tri-sentence small', hidden: true, text: c.sentence }),
      h('p', { class: 'tri-topic small' }, 'Topic: ', this.topicEl = h('button', { class: 'link-btn', type: 'button', onclick: () => this.changeTopic() }, n ? n.title : 'choose a topic'), this.cur.sticky ? h('span', { class: 'muted', text: ' (last used)' }) : null),
      this.hintEl = h('p', { class: 'tri-hint small muted', text: 'Recall the blank, then tap to see the sentence.' }));
    this.card.addEventListener('click', (e) => { if (e.target.closest('button')) return; this.reveal(); });
    this.attachSwipe(this.card);
    const total = this.queue.length;
    clear(this.host).append(h('div', { class: 'rv triage' },
      h('div', { class: 'rv-head' },
        h('button', { class: 'btn small', type: 'button', onclick: () => { location.hash = `#/intake/${this.b.id}`; } }, 'Pause'),
        h('div', { class: 'rv-title' }, h('strong', { text: 'Triage' }), h('span', { class: 'rv-count', text: ` · ${this.i + 1} / ${total} · ${this.kept} kept` })), h('span')),
      h('div', { class: 'rv-body' }, this.card, this.relatedEl || h('div')),
      h('div', { class: 'rv-foot' }, h('div', { class: 'foot-row tri-actions' },
        h('button', { class: 'btn grow wrong-btn', type: 'button', onclick: () => this.decide('discard') }, '← Discard'),
        h('button', { class: 'btn grow', type: 'button', onclick: () => this.decide('edit') }, '↑ Edit'),
        h('button', { class: 'btn grow right-btn', type: 'button', onclick: () => this.decide('keep') }, 'Keep →')))));
    this.card.focus({ preventScroll: true });
  }

  reveal() {
    if (this.cur.revealed) return;
    this.cur.revealed = true;
    this.answerEl.hidden = false;
    this.sentEl.hidden = false;
    this.hintEl.textContent = 'Swipe right to keep, left to discard, up to edit.';
  }

  attachSwipe(el) {
    let x0 = null;
    let y0 = null;
    el.addEventListener('pointerdown', (e) => { if (e.target.closest('button')) return; x0 = e.clientX; y0 = e.clientY; el.setPointerCapture(e.pointerId); });
    el.addEventListener('pointermove', (e) => {
      if (x0 === null) return;
      const dx = e.clientX - x0;
      const dy = Math.min(0, e.clientY - y0);
      el.style.transform = `translate(${dx}px, ${dy}px)`;
      el.classList.toggle('to-keep', dx > 60);
      el.classList.toggle('to-discard', dx < -60);
      el.classList.toggle('to-edit', dy < -60 && Math.abs(dx) < 60);
    });
    const end = (e) => {
      if (x0 === null) return;
      const dx = e.clientX - x0;
      const dy = e.clientY - y0;
      x0 = null;
      el.style.transform = '';
      el.classList.remove('to-keep', 'to-discard', 'to-edit');
      if (Math.abs(dx) < 90 && dy > -90) return;
      if (!this.cur.revealed) { this.reveal(); return; }
      if (dy < -90 && Math.abs(dx) < 90) this.decide('edit');
      else if (dx >= 90) this.decide('keep');
      else if (dx <= -90) this.decide('discard');
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', () => { x0 = null; el.style.transform = ''; });
  }

  async changeTopic() {
    const suggestions = this.cur.c.nodes.map((n) => n.nodeId);
    const id = await nodePicker({ title: 'Which topic?', suggestions });
    if (id) { this.cur.node = id; this.topicEl.textContent = (this.nodes.get(id) || {}).title || id; }
  }

  async decide(action) {
    const cur = this.cur;
    if (!cur || cur.busy) return;
    if (!cur.revealed) { this.reveal(); return; }
    cur.busy = true;
    const c = cur.c;
    const ms = Math.round(performance.now() - cur.shownAt);
    let fields = { text: c.cloze, answer: c.answer, node: cur.node };
    if (action === 'edit') {
      fields = await this.editSheet(fields);
      if (!fields) { cur.busy = false; return; }
    }
    if ((action === 'keep' || action === 'edit') && !fields.node) {
      const id = await nodePicker({ title: 'Keep it under which topic?', suggestions: c.nodes.map((n) => n.nodeId) });
      if (!id) { cur.busy = false; return; }
      fields.node = id;
    }
    const events = [];
    let atomId = null;
    if (action !== 'discard') {
      atomId = `rule.${ulid(clock.now())}`;
      const atom = { id: atomId, type: 'fact', text: fields.text, answer: fields.answer, nodes: [fields.node], source: { sourceId: this.b.sourceId, page: c.page }, origin: 'rule', verify: false, stage: ['prelims'] };
      if (this.b.isCa && this.b.caDate) { atom.eventDate = this.b.caDate; atom.shelfLifeDays = caShelfFor(c.sentence); }
      events.push(['atom.created', { atom }]);
    }
    events.push(['intake.triaged', { batchId: this.b.id, candId: c.id, action, revealed: cur.revealed, ms, atomId, sourceId: this.b.sourceId, page: c.page, sessionId: this.sessionId }]);
    try {
      await appendEvents(events);
    } catch (e) {
      cur.busy = false;
      toast(`Could not save: ${e.message}`, { kind: 'error' });
      return;
    }
    this.b.decisions[c.id] = { action, atomId, ts: clock.now() };
    await saveBatch(this.b);
    if (atomId) { this.kept++; this.lastNode = fields.node; }
    if (atomId && this.b.isCa) {
      this.relatedEl = h('div', { class: 'card related-strip' }, h('p', { class: 'small muted', text: `Related to the fact you just kept: ${fields.text.replace(/_{3,}/, fields.answer).slice(0, 90)}…` }), h('div', null, h('p', { class: 'small muted', text: 'Searching…' })));
      relatedFor({ headline: fields.text.replace(/_{3,}/, fields.answer), whyInNews: '', atoms: [atomId] }, this.relatedEl.lastChild).catch(() => {});
    }
    this.i++;
    this.show();
  }

  editSheet({ text, answer, node }) {
    return new Promise((resolve) => {
      let done = false;
      const t = h('textarea', { class: 'field-input', rows: '4', 'aria-label': 'Card text (___ marks the blank)' });
      t.value = text;
      const a = h('input', { type: 'text', class: 'field-input', value: answer, 'aria-label': 'Answer' });
      let nodeId = node;
      const topic = h('button', { class: 'btn small', type: 'button', onclick: async () => { const id = await nodePicker({ title: 'Which topic?', suggestions: node ? [node] : [] }); if (id) { nodeId = id; topic.textContent = (this.nodes.get(id) || {}).title || id; } } }, node ? (this.nodes.get(node) || {}).title || node : 'Choose a topic');
      const finish = (v) => { if (done) return; done = true; s.close(); resolve(v); };
      const s = sheet({
        title: 'Edit the card',
        body: h('div', { class: 'form' }, h('label', { class: 'field' }, h('span', { text: 'Text (keep ___ where the blank goes)' }), t), h('label', { class: 'field' }, h('span', { text: 'Answer' }), a), h('div', { class: 'field' }, h('span', { text: 'Topic' }), topic)),
        onClose: () => { if (!done) { done = true; resolve(null); } },
        actions: [{ label: 'Cancel', onClick: () => finish(null) }, {
          label: 'Keep', kind: 'primary',
          onClick: () => {
            const tx = t.value.trim();
            const an = a.value.trim();
            if (!tx || !an) { toast('Text and answer are both needed.', { kind: 'warn' }); return; }
            finish({ text: /_{3,}/.test(tx) ? tx : `${tx} ___`.trim(), answer: an, node: nodeId });
          },
        }],
      });
    });
  }

  async done() {
    this.stop();
    document.body.classList.remove('focus');
    deck = null;
    const mins = (performance.now() - this.started) / 60000;
    const decided = Object.values(this.b.decisions);
    const ids = decided.filter((d) => d.atomId).map((d) => d.atomId);
    clear(this.host).append(h('div', { class: 'focus-frame' }, h('div', { class: 'card summary' },
      h('h2', { text: 'Triage done' }),
      h('p', { class: 'big-number' }, h('strong', { text: String(ids.length) }), ` kept of ${decided.length}`),
      this.i ? h('p', { class: 'small', text: `${this.i} cards this session in ${mins < 1 ? `${Math.round(mins * 60)} s` : `${mins.toFixed(1)} min`} (${Math.round((mins * 60) / this.i)} s a card).` }) : null,
      h('p', { class: 'small muted', text: 'Kept facts are in today\'s reviews; their source link opens the page.' }),
      h('div', { class: 'button-row' },
        ids.length ? h('a', { class: 'btn primary', href: `#/practice/atoms?ids=${ids.map(encodeURIComponent).join(',')}` }, 'Review them now') : null,
        h('a', { class: 'btn', href: '#/intake' }, 'Intake')))));
  }

  key(e) {
    if (document.body.classList.contains('sheet-open') || e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
    let handled = true;
    if (e.key === ' ' || e.key === 'Enter') this.reveal();
    else if (e.key === 'ArrowRight') this.decide('keep');
    else if (e.key === 'ArrowLeft') this.decide('discard');
    else if (e.key === 'ArrowUp') this.decide('edit');
    else if (e.key === 't') this.changeTopic();
    else handled = false;
    if (handled) e.preventDefault();
  }
}
