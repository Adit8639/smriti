// Review session player, shared by daily reviews, the Learn Loop (pre-test and probe set),
// practice and contrast drills. Per card: prompt → answer → confidence (before the reveal)
// → reveal with explanation and source → suggested rating (one tap to accept or change)
// → error cause on every miss. Learning steps come back within the session.

import { h, clear, toast, sheet, sheetOpen } from './ui.js';
import { app, allNodes, activeProfile, appendEvents, flushState } from './store.js';
import { mountProbe, pyqProbe } from './probe-ui.js';
import { chooseProbe, contrastProbe, formatWeights, targetMs, evaluate, suggestRating, ratingReason, OBJECTIVE, FORMAT_LABEL } from './probes.js';
import { preview, formatInterval, retrievability, STATE_NAMES, RATING_NAMES, State } from './fsrs.js';
import { detectConfusions } from './confusion.js';
import { quarantineStatus, leechThreshold } from './rebuild.js';
import { causeSheet } from './sheets.js';
import { ulid } from './ulid.js';
import * as clock from './clock.js';
import { sourceLabel } from './view-library.js';
import { filled } from './cloze.js';
import { readerTarget, openSource } from './links.js';
import { LEARN_AHEAD } from './queue.js';
import { dictation } from './dictate.js';

const CONF = [['sure', 'Sure', 's'], ['5050', '50-50', '5'], ['guess', 'Guess', 'g']];
const RATED_MODES = new Set(['review', 'learn']);
const LS_DEBUG = 'smriti.debug';

const debugOn = () => { try { return localStorage.getItem(LS_DEBUG) === '1'; } catch (_) { return false; } };

const active = (atom) => {
  const q = quarantineStatus(atom, app.state);
  const rec = app.state.atoms[atom.id];
  return (q === 'clear' || q === 'approved') && !(rec && (rec.suspended || rec.retired));
};

// items: [{type:'atom', atomId, kind, node} | {type:'contrast', pair, a, b} | {type:'pyq', pyq} | {type:'probe', probe, atomId}]
export class Session {
  constructor({ host, mode = 'review', items, title = 'Review', onEnd, nodeId = null, loopId = null, reinsert = true, counts = null, endLabel = 'Done' }) {
    this.host = host;
    this.mode = mode;
    this.items = items.slice();
    this.title = title;
    this.onEnd = onEnd;
    this.nodeId = nodeId;
    this.loopId = loopId;
    this.reinsert = reinsert && RATED_MODES.has(mode);
    this.counts = counts;
    this.endLabel = endLabel;
    this.idx = 0;
    this.log = [];
    this.sessionId = ulid(clock.now());
    this.startedAt = clock.now();
    this.ended = false;
    this.keyHandler = (e) => this.onKey(e);
    this.visHandler = () => this.onVisibility();
    this.cur = null;
    this.packs = null;
  }

  async start() {
    this.packs = new Map((await app.db.getAll('packs')).map((p) => [p.id, p]));
    await appendEvents([['session.started', { sessionId: this.sessionId, kind: this.mode, nodeId: this.nodeId }]]);
    document.addEventListener('keydown', this.keyHandler);
    document.addEventListener('visibilitychange', this.visHandler);
    this.renderFrame();
    await this.next();
  }

  renderFrame() {
    this.headCount = h('span', { class: 'rv-count' });
    this.headNode = h('span', { class: 'rv-node' });
    this.debugBtn = h('button', { class: 'btn small', type: 'button', 'aria-pressed': String(debugOn()), onclick: () => this.toggleDebug() }, 'FSRS');
    this.body = h('div', { class: 'rv-body' });
    this.foot = h('div', { class: 'rv-foot' });
    this.root = h('div', { class: 'rv' },
      h('div', { class: 'rv-head' },
        h('button', { class: 'btn small', type: 'button', onclick: () => this.finish(true) }, 'End'),
        h('div', { class: 'rv-title' }, h('strong', { text: this.title }), this.headCount, this.headNode),
        this.debugBtn),
      this.body, this.foot);
    clear(this.host).append(this.root);
  }

  toggleDebug() {
    const on = !debugOn();
    try { localStorage.setItem(LS_DEBUG, on ? '1' : '0'); } catch (_) { /* preference only */ }
    this.debugBtn.setAttribute('aria-pressed', String(on));
    if (this.cur) this.drawDebug();
  }

  onVisibility() {
    if (!this.cur) return;
    if (document.visibilityState === 'hidden') {
      this.cur.hiddenAt = performance.now();
      flushState();
    } else if (this.cur.hiddenAt) {
      this.cur.hiddenMs += performance.now() - this.cur.hiddenAt;
      this.cur.hiddenAt = null;
    }
  }

  elapsed() {
    const c = this.cur;
    const hidden = c.hiddenMs + (c.hiddenAt ? performance.now() - c.hiddenAt : 0);
    return Math.max(0, Math.round(performance.now() - c.shownAt - hidden));
  }

  async loadItem(item) {
    const profile = activeProfile();
    if (item.type === 'contrast') {
      const [a, b] = await Promise.all([app.db.get('atoms', item.a), app.db.get('atoms', item.b)]);
      if (!a || !b) return null;
      return { item, atom: a, other: b, probe: contrastProbe(a, b), kind: 'contrast', target: targetMs({ format: 'contrast' }, profile) };
    }
    if (item.type === 'pyq') {
      const probe = pyqProbe(item.pyq);
      const atom = probe.atoms[0] ? await app.db.get('atoms', probe.atoms[0]) : null;
      return { item, atom, probe, kind: 'pyq', target: targetMs(probe, profile) };
    }
    const atom = await app.db.get('atoms', item.atomId);
    if (!atom) return null;
    if (item.type === 'probe') return { item, atom, probe: item.probe, kind: item.kind || 'practice', target: targetMs(item.probe, profile), scores: null };
    const raw = await app.db.getAllByIndex('probes', 'atoms', atom.id);
    const usable = [];
    for (const p of raw) {
      const ok = await Promise.all(p.atoms.map(async (id) => { const x = id === atom.id ? atom : await app.db.get('atoms', id); return !!x && active(x); }));
      if (ok.every(Boolean)) usable.push(p);
    }
    const { probe, scores } = chooseProbe({ atom, probes: usable, rec: app.state.atoms[atom.id], probeUse: app.state.probeUse, weights: formatWeights(profile, atom), now: clock.now() });
    return { item, atom, probe, kind: item.kind, target: targetMs(probe, profile), scores };
  }

  async next() {
    if (this.ended) return;
    if (this.idx >= this.items.length) { await this.finish(false); return; }
    const item = this.items[this.idx];
    const data = await this.loadItem(item);
    if (!data) { this.idx++; await this.next(); return; }
    this.cur = { ...data, stage: 'answer', confidence: null, result: null, shownAt: performance.now(), hiddenMs: 0, hiddenAt: null, ms: 0 };
    this.drawCard();
  }

  drawCard() {
    const c = this.cur;
    const nodes = allNodes();
    const node = c.atom && c.atom.nodes && nodes.get(c.atom.nodes[0]);
    this.headCount.textContent = ` · ${Math.min(this.idx + 1, this.items.length)} / ${this.items.length}`;
    this.headNode.textContent = node ? node.title : '';
    const kindLabel = { new: 'New', due: 'Due', learning: 'Learning', forced: 'Today', contrast: 'Contrast', pyq: 'PYQ', practice: 'Practice', pretest: 'Pre-test' }[c.kind] || '';
    this.probeHost = h('div', { class: 'rv-probe' });
    this.revealBox = h('div', { class: 'rv-reveal', hidden: true });
    this.debugBox = h('div', { class: 'rv-debug', hidden: true });
    clear(this.body).append(
      h('div', { class: 'rv-meta' },
        h('span', { class: 'badge', text: FORMAT_LABEL[c.probe.format] || c.probe.format }),
        kindLabel && kindLabel !== (FORMAT_LABEL[c.probe.format] || c.probe.format) ? h('span', { class: 'badge muted', text: kindLabel }) : null,
        this.mode === 'pretest' ? h('span', { class: 'badge warn', text: 'Pre-test: misses are expected' }) : null,
        this.mode === 'practice' ? h('span', { class: 'badge muted', text: 'Practice: schedule unchanged' }) : null),
      this.probeHost, this.revealBox, this.debugBox);
    this.ctl = mountProbe(this.probeHost, c.probe, { seed: `${c.probe.id}|${this.sessionId}|${this.idx}`, onChange: () => this.drawFoot() });
    this.drawFoot();
    this.drawDebug();
    this.body.scrollTop = 0;
    window.scrollTo(0, 0);
    const first = this.probeHost.querySelector('input.pv-type, .opt, .tf, .pair-l, .order-item, textarea');
    if (first && first.tagName !== 'INPUT' && first.tagName !== 'TEXTAREA') first.focus({ preventScroll: true });
  }

  drawFoot() {
    const c = this.cur;
    if (!c) return;
    clear(this.foot);
    if (c.stage === 'answer') {
      if (c.probe.format === 'explain') {
        const row = h('div', { class: 'foot-row' });
        const mic = dictation((text) => this.ctl.setDictated(text));
        if (mic) row.append(mic);
        if (this.ctl.state.stage === 'write') row.append(h('button', { class: 'btn primary grow', type: 'button', onclick: () => { c.ms = this.elapsed(); this.ctl.toCheck(); this.drawFoot(); } }, 'Done (Space)'));
        else row.append(h('button', { class: 'btn primary grow', type: 'button', onclick: () => this.onReveal(null) }, 'Score (Enter)'));
        this.foot.append(row);
        return;
      }
      const ready = this.ctl.ready();
      const row = h('div', { class: 'foot-row conf-row', role: 'group', 'aria-label': 'How sure are you?' },
        CONF.map(([id, label, key]) => h('button', { class: `btn conf conf-${id}`, type: 'button', disabled: !ready, onclick: () => this.onReveal(id) }, label, h('span', { class: 'kbd', text: key.toUpperCase() }))));
      const tools = h('div', { class: 'foot-tools' });
      if ((c.probe.format === 'cloze' || c.probe.format === 'qa') && dictation) {
        const mic = dictation((text) => this.ctl.setDictated(text), { short: true });
        if (mic) tools.append(mic);
      }
      this.foot.append(h('p', { class: 'foot-hint small muted', text: ready ? 'How sure are you? Picking one reveals the answer.' : 'Answer first, then say how sure you are.' }), row);
      if (tools.childNodes.length) this.foot.append(tools);
      return;
    }
    if (c.stage === 'self') {
      this.foot.append(h('p', { class: 'foot-hint small muted', text: 'Compare with the answer above. Did you have it?' }),
        h('div', { class: 'foot-row' },
          h('button', { class: 'btn wrong-btn grow', type: 'button', onclick: () => this.onSelf(false) }, 'Missed it', h('span', { class: 'kbd', text: 'N' })),
          h('button', { class: 'btn right-btn grow', type: 'button', onclick: () => this.onSelf(true) }, 'I had it', h('span', { class: 'kbd', text: 'Y' }))));
      return;
    }
    if (c.stage === 'revealed') {
      if (!RATED_MODES.has(this.mode) || c.kind === 'contrast') {
        this.foot.append(h('div', { class: 'foot-row' }, h('button', { class: 'btn primary grow', type: 'button', onclick: () => this.onRate(null) }, 'Next', h('span', { class: 'kbd', text: 'Space' }))));
        return;
      }
      const card = app.state.atoms[c.atom.id] && app.state.atoms[c.atom.id].card;
      const now = clock.now();
      c.previews = preview(card, now, app.state.settings.retention);
      const reason = ratingReason({ ...c.result, confidence: c.confidence, ms: c.ms, target: c.target, prevRating: c.prevRating, format: c.probe.format });
      this.foot.append(h('p', { class: 'foot-hint small' }, h('strong', { text: `Suggested: ${RATING_NAMES[c.suggested]}. ` }), reason, ' Tap to accept or change.'),
        h('div', { class: 'foot-row rate-row', role: 'group', 'aria-label': 'Rating' },
          [1, 2, 3, 4].map((r) => h('button', { class: `btn rate rate-${r}${r === c.suggested ? ' suggested' : ''}`, type: 'button', onclick: () => this.onRate(r) },
            h('span', { class: 'rate-name', text: RATING_NAMES[r] }),
            h('span', { class: 'rate-ivl', text: formatInterval(c.previews[r].due - now) }),
            h('span', { class: 'kbd', text: String(r) })))));
    }
  }

  // Confidence tapped (or Score for explain): reveal and judge.
  async onReveal(confidence) {
    const c = this.cur;
    if (c.stage !== 'answer') return;
    if (c.probe.format !== 'explain') c.ms = this.elapsed();
    c.confidence = OBJECTIVE.has(c.probe.format) ? confidence : null;
    const resp = this.ctl.response();
    c.response = resp;
    this.ctl.reveal();
    const selfFormat = c.probe.format === 'cloze' || c.probe.format === 'qa';
    if (selfFormat && !resp.typed) {
      c.stage = 'self';
      this.drawReveal(null);
      this.drawFoot();
      return;
    }
    this.judge(evaluate(c.probe, resp));
  }

  onSelf(had) {
    const c = this.cur;
    if (c.stage !== 'self') return;
    c.response.self = had;
    this.judge({ correct: had, partial: false });
  }

  judge(result) {
    const c = this.cur;
    c.result = result;
    const rec = c.atom && app.state.atoms[c.atom.id];
    c.prevRating = rec && rec.lastRating;
    c.suggested = suggestRating({ ...result, confidence: c.confidence, ms: c.ms, target: c.target, prevRating: c.prevRating, format: c.probe.format });
    c.stage = 'revealed';
    this.drawReveal(result);
    this.drawFoot();
    this.drawDebug();
  }

  drawReveal(result) {
    const c = this.cur;
    const box = this.revealBox;
    clear(box);
    box.hidden = false;
    const typed = c.response && c.response.typed;
    if (result) {
      box.append(h('p', { class: `verdict ${result.correct ? 'right' : 'wrong'}` }, result.correct ? (result.partial ? 'Right option, one statement misjudged' : 'Correct') : 'Not quite'));
    }
    if (c.probe.format === 'cloze' || c.probe.format === 'qa' || c.probe.format === 'contrast') {
      if (c.probe.format !== 'contrast') box.append(h('p', { class: 'answer big', text: c.probe.answer }));
      if (typed && result) {
        box.append(h('p', { class: 'small' }, `You typed: “${typed}”. `,
          h('button', { class: 'link-btn', type: 'button', onclick: () => this.judge({ correct: !result.correct, partial: false }) }, result.correct ? 'Actually I was wrong' : 'I was right (count it)')));
      }
    }
    if (c.probe.format === 'explain') box.append(h('p', { class: 'small muted', text: `Covered ${Math.round(((result && result.ratio) || 0) * 100)}% of the key points.` }));
    if (c.atom && c.probe.format !== 'contrast') box.append(h('p', { class: 'fact' }, h('span', { class: 'muted', text: 'Fact: ' }), filled(c.atom)));
    if (c.probe.explanation && !c.probe.auto) box.append(h('p', { class: 'pre small' }, h('span', { class: 'muted', text: c.probe.format === 'pyq' ? 'Elimination: ' : 'Why: ' }), c.probe.explanation));
    if (c.probe.format === 'contrast') box.append(h('p', { class: 'pre' }, c.probe.explanation));
    const rec = c.atom && app.state.atoms[c.atom.id];
    const mnemonic = (rec && rec.mnemonic) || (c.atom && c.atom.mnemonic);
    if (mnemonic) box.append(h('p', { class: 'small' }, h('span', { class: 'muted', text: 'Mnemonic: ' }), mnemonic));
    if (c.atom) {
      const target = readerTarget(c.atom);
      const pyqs = new Map();
      box.append(h('p', { class: 'source small' }, h('span', { class: 'muted', text: 'Source: ' }), sourceLabel(c.atom, this.packs, pyqs),
        target ? [' ', h('button', { class: 'link-btn', type: 'button', onclick: () => openSource(target) }, `Open page ${target.page}`)] : null));
    }
  }

  async onRate(rating) {
    const c = this.cur;
    if (!c || c.stage !== 'revealed' || c.saving) return;
    c.saving = true;
    const result = c.result;
    const events = [];
    const isContrast = c.kind === 'contrast';
    let reviewId = null;
    if (isContrast) {
      events.push(['contrast.done', { pair: c.item.pair, correct: result.correct, confidence: c.confidence, ms: c.ms, sessionId: this.sessionId }]);
    } else {
      const finalRating = RATED_MODES.has(this.mode) ? (rating || c.suggested) : null;
      events.push(['review.done', {
        atomId: c.atom ? c.atom.id : null,
        probeId: c.probe.id,
        format: c.probe.format,
        mode: this.mode,
        correct: result.correct,
        partial: !!result.partial,
        confidence: c.confidence,
        ms: c.ms,
        target: c.target,
        suggested: RATED_MODES.has(this.mode) ? c.suggested : null,
        rating: finalRating,
        sessionId: this.sessionId,
        loopId: this.loopId,
        response: compact(c.response),
      }]);
      c.finalRating = finalRating;
    }
    // Wrong options, pairings or positions that belong to another atom log a confusion.
    let hits = [];
    if (!result.correct && c.atom && this.mode !== 'pretest') {
      const pool = await this.blamePool(c);
      hits = detectConfusions(c.probe, c.response || {}, c.atom, pool);
      for (const hit of hits) events.push(['confusion.hit', { ...hit, probeId: c.probe.id }]);
    }
    const before = c.atom && app.state.atoms[c.atom.id] ? { ...app.state.atoms[c.atom.id] } : {};
    let evs;
    try {
      evs = await appendEvents(events);
    } catch (e) {
      c.saving = false;
      toast(`Could not save this answer: ${e.message}`, { kind: 'error', ms: 8000 });
      return;
    }
    reviewId = !isContrast ? evs[0].id : null;
    const after = c.atom ? app.state.atoms[c.atom.id] || {} : {};
    this.log.push({
      atomId: c.atom ? c.atom.id : '—', format: c.probe.format, correct: result.correct, confidence: c.confidence, ms: c.ms,
      rating: c.finalRating || null, suggested: c.suggested, state: after.card ? STATE_NAMES[after.card.state] : '—',
      interval: after.card && c.finalRating ? formatInterval(after.card.due - clock.now()) : '—', hits: hits.length,
    });
    if (hits.length) toast(`Logged a confusion with ${hits.length > 1 ? `${hits.length} atoms` : 'another atom'}.`, { ms: 3000 });
    if (!result.correct && c.atom && !isContrast && this.mode !== 'pretest' && reviewId) await this.askCause(c, reviewId);
    if (after.suspended && !before.suspended) this.leechNotice(c.atom);
    if (this.reinsert && after.card && (after.card.state === State.Learning || after.card.state === State.Relearning)) {
      const wait = after.card.due - clock.now();
      if (wait <= LEARN_AHEAD) {
        for (let i = this.items.length - 1; i > this.idx; i--) if (this.items[i].atomId === c.atom.id) this.items.splice(i, 1);
        const pos = Math.min(this.items.length, this.idx + 1 + Math.max(3, Math.round(wait / 12000)));
        this.items.splice(pos, 0, { type: 'atom', atomId: c.atom.id, kind: 'learning', node: (c.atom.nodes || [''])[0] });
      }
    }
    this.idx++;
    await this.next();
  }

  async blamePool(c) {
    const pool = new Map();
    const add = async (id) => { if (!id || pool.has(id)) return; const a = await app.db.get('atoms', id); if (a) pool.set(id, a); };
    for (const id of c.probe.atoms || []) await add(id);
    for (const id of c.atom.confusables || []) await add(id);
    for (const n of (c.atom.nodes || []).slice(0, 1)) for (const a of await app.db.getAllByIndex('atoms', 'nodes', n)) if (!pool.has(a.id)) pool.set(a.id, a);
    pool.set(c.atom.id, c.atom);
    return pool;
  }

  async askCause(c, reviewId) {
    const suggestions = [];
    for (const id of [...(c.atom.confusables || []), ...(c.probe.atoms || [])]) {
      if (id === c.atom.id) continue;
      const a = await app.db.get('atoms', id);
      if (a && !suggestions.some((x) => x.id === a.id)) suggestions.push(a);
    }
    const marks = c.response && c.response.marks;
    const missed = marks && (c.probe.statements || []).find((s, i) => marks[i] !== undefined && marks[i] !== s.true);
    const answer = await causeSheet({ atom: c.atom, defaultTrap: missed ? missed.trap : null, suggestions });
    if (!answer) return;
    const events = [['review.cause', { reviewId, atomId: c.atom.id, cause: answer.cause, other: answer.other || null, trap: answer.trap || null }]];
    if (answer.cause === 'confused' && answer.other) events.push(['confusion.hit', { a: c.atom.id, b: answer.other, via: 'cause', reviewId }]);
    try {
      await appendEvents(events);
    } catch (e) {
      toast(`Could not save the cause: ${e.message}`, { kind: 'error' });
    }
  }

  leechNotice(atom) {
    const th = leechThreshold(app.state);
    const s = sheet({
      title: 'Leech: time to rebuild',
      body: h('div', null,
        h('p', { text: `This atom has lapsed ${th} times, so it is suspended until you rebuild it.` }),
        h('p', { class: 'fact', text: filled(atom) }),
        h('p', { class: 'small muted', text: 'Rebuild it with a mnemonic, by splitting it into smaller atoms, or by attaching a contrast with the atom you keep mixing it up with.' })),
      actions: [
        { label: 'Later', onClick: () => s.close() },
        { label: 'Rebuild now', kind: 'primary', onClick: () => { s.close(); this.finish(true).then(() => { location.hash = `#/rebuild/${encodeURIComponent(atom.id)}`; }); } },
      ],
    });
  }

  onKey(e) {
    if (this.ended || !this.cur || sheetOpen() || document.body.classList.contains('overlay-open')) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const c = this.cur;
    const t = e.target;
    const typing = t && (t.tagName === 'TEXTAREA' || (t.tagName === 'INPUT' && t.type !== 'checkbox'));
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (k === 'Escape') { e.preventDefault(); this.finish(true); return; }
    if (typing) {
      if (k === 'Enter' && c.stage === 'answer' && t.classList.contains('pv-type')) {
        e.preventDefault();
        t.blur();
        this.foot.querySelector('.conf')?.focus();
      }
      return;
    }
    let handled = true;
    if (c.stage === 'answer') {
      if (c.probe.format === 'explain') {
        if (k === ' ' && this.ctl.state.stage === 'write') { c.ms = this.elapsed(); this.ctl.toCheck(); this.drawFoot(); }
        else if (k === 'Enter' && this.ctl.state.stage === 'check') this.onReveal(null);
        else handled = false;
      } else if (k === 's' || k === '5' || k === 'g') {
        if (this.ctl.ready()) this.onReveal(k === 's' ? 'sure' : k === '5' ? '5050' : 'guess');
      } else if (k === ' ') {
        const row = this.foot.querySelector('.conf-row');
        if (row) { row.classList.remove('nudge'); void row.offsetWidth; row.classList.add('nudge'); }
      } else if (k === 'j' || k === 'k') {
        moveFocus(this.probeHost, k === 'j' ? 1 : -1);
      } else handled = this.ctl.key(k);
    } else if (c.stage === 'self') {
      if (k === 'y') this.onSelf(true);
      else if (k === 'n') this.onSelf(false);
      else handled = false;
    } else if (c.stage === 'revealed') {
      if (['1', '2', '3', '4'].includes(k) && RATED_MODES.has(this.mode) && c.kind !== 'contrast') this.onRate(Number(k));
      else if (k === ' ' || k === 'Enter') this.onRate(null);
      else handled = false;
    } else handled = false;
    if (handled) e.preventDefault();
  }

  drawDebug() {
    const c = this.cur;
    if (!c || !this.debugBox) return;
    if (!debugOn()) { this.debugBox.hidden = true; return; }
    this.debugBox.hidden = false;
    clear(this.debugBox);
    const now = clock.now();
    const rec = c.atom ? app.state.atoms[c.atom.id] : null;
    const card = rec && rec.card;
    const prev = preview(card, now, app.state.settings.retention);
    const rows = [
      ['Atom', c.atom ? c.atom.id : '—'],
      ['Probe', `${c.probe.id} (${c.probe.format})`],
      ['State', card ? STATE_NAMES[card.state] : 'New (never reviewed)'],
      ['Stability', card ? `${card.s.toFixed(2)} d` : '—'],
      ['Difficulty', card ? card.d.toFixed(2) : '—'],
      ['Recall now', card ? `${Math.round(retrievability(card, now, app.state.settings.retention) * 100)}%` : '—'],
      ['Due', card ? new Date(card.due).toLocaleString() : '—'],
      ['Reps / lapses', card ? `${card.reps} / ${card.lapses} (leech at ${leechThreshold(app.state) + ((rec && rec.lapseBase) || 0)})` : '0 / 0'],
      ['Target', c.target ? `${c.target / 1000} s` : 'none'],
      ['Answer time', c.ms ? `${(c.ms / 1000).toFixed(1)} s` : '…'],
      ['Previews', [1, 2, 3, 4].map((r) => `${RATING_NAMES[r]} ${formatInterval(prev[r].due - now)}`).join(' · ')],
    ];
    if (c.scores) rows.push(['Format scores', c.scores.map((x) => `${x.format} ${Math.round(x.score)}`).join(' · ')]);
    this.debugBox.append(h('h3', { text: 'FSRS debug' }), h('table', { class: 'counts-table debug' }, h('tbody', null, rows.map(([k, v]) => h('tr', null, h('th', { text: k }), h('td', { text: String(v) }))))));
    if (this.log.length) {
      this.debugBox.append(h('h4', { text: `This session (${this.log.length})` }), h('div', { class: 'table-wrap' }, h('table', { class: 'counts-table debug' },
        h('thead', null, h('tr', null, ['#', 'Atom', 'Format', 'Right', 'Conf', 'Time', 'Rating', 'State', 'Next'].map((x) => h('th', { text: x })))),
        h('tbody', null, this.log.slice(-25).map((r, i) => h('tr', null,
          h('td', { text: String(this.log.length - Math.min(25, this.log.length) + i + 1) }), h('td', { text: r.atomId.replace(/^.*\./, '') }), h('td', { text: r.format }),
          h('td', { text: r.correct ? '✓' : '✗' }), h('td', { text: r.confidence || '—' }), h('td', { text: `${(r.ms / 1000).toFixed(1)}s` }),
          h('td', { text: r.rating ? `${RATING_NAMES[r.rating]}${r.rating !== r.suggested ? '*' : ''}` : '—' }), h('td', { text: r.state }), h('td', { text: r.interval })))))));
    }
  }

  async finish(early) {
    if (this.ended) return;
    this.ended = true;
    document.removeEventListener('keydown', this.keyHandler);
    document.removeEventListener('visibilitychange', this.visHandler);
    try { await appendEvents([['session.ended', { sessionId: this.sessionId }]]); } catch (_) { /* best effort */ }
    flushState();
    const summary = this.summary(early);
    if (this.onEnd) await this.onEnd(summary, this);
  }

  summary(early) {
    const n = this.log.length;
    const right = this.log.filter((r) => r.correct).length;
    const activeMs = this.log.reduce((a, r) => a + (r.ms || 0), 0);
    const wall = Math.max(1, clock.now() - this.startedAt);
    return { n, right, accuracy: n ? right / n : null, activeMs, wallMs: wall, activeRatio: Math.min(1, activeMs / wall), early, remaining: Math.max(0, this.items.length - this.idx), log: this.log };
  }
}

function compact(r) {
  if (!r) return null;
  const out = {};
  for (const [k, v] of Object.entries(r)) {
    if (v === undefined || v === null) continue;
    out[k] = typeof v === 'string' ? v.slice(0, 300) : v;
  }
  return out;
}

function moveFocus(host, dir) {
  const els = [...host.querySelectorAll('[data-nav]')].filter((x) => !x.disabled);
  if (!els.length) return;
  const i = els.indexOf(document.activeElement);
  const next = i < 0 ? 0 : Math.max(0, Math.min(els.length - 1, i + dir));
  els[next].focus();
}

// Summary card shown at the end of a session.
export function summaryView(sum, { title = 'Session done', counts = null, actions = [] } = {}) {
  const pct = (x) => `${Math.round(x * 100)}%`;
  const mins = (ms) => (ms < 60000 ? `${Math.round(ms / 1000)} s` : `${Math.round(ms / 60000)} min`);
  return h('div', { class: 'card summary' },
    h('h2', { text: title }),
    sum.n ? h('p', { class: 'big-number' }, h('strong', { text: String(sum.n) }), ` answered · ${pct(sum.accuracy)} right`) : h('p', { text: 'No cards answered.' }),
    sum.n ? h('p', { class: 'small', text: `Active time ${mins(sum.activeMs)} of ${mins(sum.wallMs)}: active ratio ${pct(sum.activeRatio)} (target 70% or more).` }) : null,
    sum.remaining && sum.early ? h('p', { class: 'small muted', text: `${sum.remaining} cards left in this queue; they stay due.` }) : null,
    counts && counts.overflow ? h('p', { class: 'small warn-text', text: `${counts.overflow} due reviews are over today's cap of ${counts.cap}; they carry over, most-forgotten first. New atoms pause until the backlog clears.` }) : null,
    actions.length ? h('div', { class: 'button-row' }, actions) : null);
}
