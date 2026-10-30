// Learn Loop for one topic, a guided five-step flow that cannot be skipped forward:
// 1 pre-test (PYQs or probes, no FSRS penalty) → 2 read the topic's source pages (timed)
// → 3 blank-page recall, then tick what you recalled (below 70% the topic stays Learning
// and missed atoms are due today) → 4 ten interleaved probes, at least 3 from older
// topics → 5 a 90-second Mains skeleton. Progress is saved after every step.

import { h, clear, toast, confirmSheet } from './ui.js';
import { app, allNodes, appendEvents } from './store.js';
import { Session } from './session.js';
import { mountReader } from './view-reader.js';
import { sourcesForNode } from './sources.js';
import { filled } from './cloze.js';
import { quarantineStatus } from './rebuild.js';
import { retrievability } from './fsrs.js';
import { shuffled } from './probes.js';
import { dictation } from './dictate.js';
import { ulid } from './ulid.js';
import * as clock from './clock.js';
import { wordCount, plural } from './util.js';

const STEPS = [['pretest', 'Pre-test'], ['read', 'Read'], ['recall', 'Recall'], ['probes', 'Probes'], ['output', 'Output']];
const OUTPUT_SECONDS = 90;
const PASS = 70;

let live = { session: null, reader: null, timers: [] };

function cleanup() {
  if (live.session && !live.session.ended) live.session.finish(true);
  if (live.reader) live.reader.destroy();
  live.timers.forEach((t) => clearInterval(t));
  live = { session: null, reader: null, timers: [] };
}

export function leave() {
  cleanup();
  document.body.classList.remove('focus');
}

const usable = (a) => {
  const q = quarantineStatus(a, app.state);
  const rec = app.state.atoms[a.id];
  return (q === 'clear' || q === 'approved') && !(rec && (rec.retired || rec.suspended));
};

async function topicAtoms(nodeId) {
  return (await app.db.getAllByIndex('atoms', 'nodes', nodeId)).filter(usable).sort((a, b) => (a.id < b.id ? -1 : 1));
}

const fmtClock = (ms) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

// Up to 5: the topic's objective PYQs first, then probes of its atoms.
export async function pretestItems(nodeId) {
  const items = [];
  const pyqs = (await app.db.getAllByIndex('pyqs', 'nodes', nodeId)).filter((q) => {
    const p = app.ctx.papers.get(q.paper);
    return p && p.type === 'mcq' && Array.isArray(q.options) && q.options.length === 4;
  });
  for (const q of pyqs.slice(0, 5)) items.push({ type: 'pyq', pyq: q, kind: 'pyq', node: nodeId });
  if (items.length < 5) {
    const seen = new Set();
    for (const a of await topicAtoms(nodeId)) {
      for (const p of await app.db.getAllByIndex('probes', 'atoms', a.id)) {
        if (items.length >= 5) break;
        if (seen.has(p.id) || p.format === 'explain') continue;
        const all = await Promise.all(p.atoms.map((id) => app.db.get('atoms', id)));
        if (!all.every((x) => x && usable(x))) continue;
        seen.add(p.id);
        items.push({ type: 'probe', probe: p, atomId: a.id, kind: 'pretest', node: nodeId });
      }
      if (items.length >= 5) break;
    }
  }
  return items;
}

// Ten probes: up to 7 from this topic, at least 3 from older topics (least well
// remembered first), never more than two of this topic in a row. A topic with few atoms
// is probed in several formats (its probes and the plain card), so the set still reaches
// ten; with no older topics yet (the first loop) it is all this topic.
export async function probeSetItems(nodeId, seed) {
  const mine = await topicAtoms(nodeId);
  const order = shuffled(mine.length, seed);
  const perAtom = [];
  for (const i of order) {
    const a = mine[i];
    const list = [{ type: 'atom', atomId: a.id, kind: 'learning', node: nodeId }];
    for (const p of await app.db.getAllByIndex('probes', 'atoms', a.id)) {
      const all = await Promise.all(p.atoms.map((id) => (id === a.id ? a : app.db.get('atoms', id))));
      if (all.every((x) => x && usable(x))) list.push({ type: 'probe', probe: p, atomId: a.id, kind: 'learning', node: nodeId });
    }
    perAtom.push(list);
  }
  // Round-robin over atoms so each comes up once before any repeats.
  const A = [];
  const used = new Set();
  for (let round = 0; A.length < 10 && perAtom.some((l) => l.length > round); round++) {
    for (const l of perAtom) {
      const it = l[round];
      if (!it || A.length >= 10) continue;
      const key = it.type === 'probe' ? it.probe.id : `auto:${it.atomId}`;
      if (!used.has(key)) { used.add(key); A.push(it); }
    }
  }
  const now = clock.now();
  const older = [];
  for (const [id, rec] of Object.entries(app.state.atoms)) {
    if (!rec.card || rec.suspended || rec.retired) continue;
    older.push([id, retrievability(rec.card, now, app.state.settings.retention)]);
  }
  older.sort((x, y) => x[1] - y[1]);
  const B = [];
  for (const [id] of older) {
    if (B.length >= 3) break;
    const a = await app.db.get('atoms', id);
    if (a && usable(a) && !(a.nodes || []).includes(nodeId)) B.push({ type: 'atom', atomId: a.id, kind: 'due', node: (a.nodes || [''])[0] });
  }
  // Too few distinct probes: each may come back once, later in the set (spaced, never
  // back to back), rather than padding the set with near-duplicates.
  const distinct = A.length;
  for (let k = 0; A.length < 10 - B.length && k < distinct; k++) {
    const it = A[k];
    if (A[A.length - 1] !== it) A.push({ ...it, repeat: true });
  }
  const mineCount = Math.min(A.length, 10 - B.length);
  const out = [];
  let i = 0;
  let j = 0;
  while ((i < mineCount || j < B.length) && out.length < 10) {
    for (let k = 0; k < 2 && i < mineCount && out.length < 10; k++) out.push(A[i++]);
    if (j < B.length && out.length < 10) out.push(B[j++]);
  }
  return out;
}

export async function outputQuestion(nodeId, node) {
  const mains = (await app.db.getAllByIndex('pyqs', 'nodes', nodeId)).filter((q) => {
    const p = app.ctx.papers.get(q.paper);
    return p && p.type === 'descriptive';
  });
  if (mains.length) return { text: mains[0].stem, directive: mains[0].directive || 'Discuss', marks: mains[0].marks || 10, from: `PYQ ${mains[0].year}` };
  for (const x of await app.db.getAllByIndex('ca', 'anchors', nodeId)) {
    const pq = (x.probableQs || []).find((q) => q.stage === 'mains');
    if (pq) return { text: pq.text, directive: (pq.text.match(/^(\w+)/) || ['', 'Discuss'])[1], marks: 10, from: `probable question (${x.headline})` };
  }
  return { text: `Discuss: ${node.title}.`, directive: 'Discuss', marks: 10, from: 'this topic' };
}

function stepper(step) {
  const at = STEPS.findIndex(([id]) => id === step);
  return h('ol', { class: 'stepper', 'aria-label': 'Learn Loop steps' }, STEPS.map(([id, label], i) =>
    h('li', { class: i < at || step === 'done' ? 'done' : i === at ? 'current' : 'locked', 'aria-current': i === at ? 'step' : null },
      h('span', { class: 'step-num', text: i < at || step === 'done' ? '✓' : String(i + 1) }), h('span', { class: 'step-label', text: label }))));
}

async function advance(events) {
  await appendEvents(events);
  location.hash = `${location.hash.split('?')[0]}?r=${Date.now()}`;
}

export async function render(route) {
  cleanup();
  const arg = route.arg || '';
  const nodes = allNodes();
  if (arg.startsWith('start/')) {
    const nodeId = arg.slice(6);
    if (!nodes.has(nodeId)) return h('div', { class: 'card' }, h('p', { text: 'Topic not found.' }));
    const existing = app.state.activeLoop[nodeId];
    const loopId = existing || `loop-${ulid(clock.now())}`;
    if (!existing) await appendEvents([['learn.started', { loopId, nodeId, sessionId: loopId }], ['session.started', { sessionId: loopId, kind: 'learn', nodeId }]]);
    location.replace(`#/learn/${encodeURIComponent(loopId)}`);
    return h('p', { class: 'muted', text: 'Starting…' });
  }
  const loopId = arg;
  const loop = app.state.loops[loopId];
  if (!loop) return h('div', { class: 'card' }, h('p', { text: 'This Learn Loop was not found.' }), h('a', { class: 'btn', href: '#/today' }, 'Today'));
  const node = nodes.get(loop.nodeId);
  if (!node) return h('div', { class: 'card' }, h('p', { text: 'The topic of this loop is not installed.' }));
  if (loop.done || loop.discarded) { document.body.classList.remove('focus'); return doneView(loop, node); }

  document.body.classList.add('focus');
  const body = h('div', { class: 'learn-body' });
  const root = h('div', { class: 'learn' },
    h('div', { class: 'learn-head' },
      h('button', { class: 'btn small', type: 'button', onclick: () => { location.hash = `#/node/${encodeURIComponent(loop.nodeId)}`; } }, 'Exit'),
      h('div', { class: 'learn-title' }, h('strong', { text: node.title }), h('span', { class: 'small muted', text: ' · Learn Loop' })),
      h('button', {
        class: 'btn small', type: 'button',
        onclick: async () => {
          const ok = await confirmSheet({ title: 'Discard this Learn Loop?', message: 'What you answered stays in your history; the loop just stops. You can start a new one any time.', confirmLabel: 'Discard', danger: true });
          if (ok) { await appendEvents([['learn.discarded', { loopId }], ['session.ended', { sessionId: loopId }]]); location.hash = `#/node/${encodeURIComponent(loop.nodeId)}`; }
        },
      }, 'Discard')),
    stepper(loop.step),
    body);
  const step = loop.step;
  setTimeout(() => {
    const steps = { pretest: stepPretest, read: stepRead, recall: stepRecall, probes: stepProbes, output: stepOutput };
    (steps[step] || stepPretest)(body, loop, loopId, node).catch((e) => { clear(body).append(h('div', { class: 'card error' }, h('p', { text: e.message }))); console.error(e); });
  }, 0);
  return root;
}

async function stepPretest(body, loop, loopId, node) {
  const items = await pretestItems(loop.nodeId);
  const next = (n, correct) => advance([['learn.step', { loopId, step: 'read', pretest: { n, correct } }]]);
  if (!items.length) {
    clear(body).append(h('section', { class: 'card' },
      h('h2', { text: '1. Pre-test' }),
      h('p', { text: 'There are no PYQs or probes for this topic yet, so there is nothing to pre-test.' }),
      h('div', { class: 'dock' }, h('button', { class: 'btn primary', type: 'button', onclick: () => next(0, 0) }, 'Continue to reading'))));
    return;
  }
  clear(body).append(h('section', { class: 'card' },
    h('h2', { text: '1. Pre-test' }),
    h('p', { text: `Answer ${plural(items.length, 'question')} before reading. Wrong answers are expected: trying first makes the reading stick, and nothing here touches your schedule.` }),
    h('div', { class: 'dock' }, h('button', {
      class: 'btn primary', type: 'button',
      onclick: () => {
        const host = h('div', { class: 'review-host inline' });
        clear(body).append(host);
        live.session = new Session({
          host, mode: 'pretest', items, title: 'Pre-test', nodeId: loop.nodeId, loopId,
          onEnd: async (sum) => {
            if (sum.early && sum.remaining) return unfinished(body, 'pre-test', loopId);
            await next(sum.n, sum.right);
          },
        });
        live.session.start();
      },
    }, 'Start the pre-test'))));
}

function unfinished(body, what, loopId) {
  clear(body).append(h('section', { class: 'card' },
    h('h2', { text: `The ${what} is not finished` }),
    h('p', { text: 'Steps cannot be skipped. Finish it now, or leave and resume later from Today.' }),
    h('div', { class: 'dock' },
      h('a', { class: 'btn', href: '#/today' }, 'Leave for now'),
      h('button', { class: 'btn primary', type: 'button', onclick: () => { location.hash = `#/learn/${encodeURIComponent(loopId)}?r=${Date.now()}`; } }, `Resume the ${what}`))));
}

async function stepRead(body, loop, loopId, node) {
  const startedAt = loop.updatedTs || clock.now();
  const maps = [];
  for (const m of sourcesForNode(app.state, loop.nodeId)) if (await app.db.get('sources', m.sourceId)) maps.push(m);
  const timer = h('span', { class: 'timer', text: '0:00' });
  const tick = () => { timer.textContent = fmtClock(clock.now() - startedAt); };
  tick();
  live.timers.push(setInterval(tick, 1000));
  const done = h('button', { class: 'btn primary', type: 'button', onclick: () => advance([['learn.step', { loopId, step: 'recall', readMs: clock.now() - startedAt }]]) }, 'I have finished reading');
  const area = h('div', { class: 'read-area' });
  clear(body).append(h('section', { class: 'card' },
    h('h2', { text: '2. Read' }),
    h('p', { class: 'small muted', text: maps.length ? 'Read the mapped pages. Select any sentence to capture it as an atom.' : 'No source pages are mapped to this topic on this device, so read the topic’s own atoms and notes.' })),
  area,
  h('div', { class: 'dock' }, h('span', { class: 'dock-info' }, 'Reading ', timer), done));

  if (maps.length) {
    const tabs = h('div', { class: 'chips' });
    const holder = h('div');
    const open = async (m) => {
      if (live.reader) live.reader.destroy();
      live.reader = await mountReader(holder, { sourceId: m.sourceId, page: m.from, range: { from: m.from, to: m.to }, nodeId: loop.nodeId, compact: true });
    };
    if (maps.length > 1) maps.forEach((m) => tabs.append(h('button', { class: 'chip', type: 'button', onclick: () => open(m) }, `${(app.state.sources[m.sourceId] || {}).title || m.sourceId} · p. ${m.from}–${m.to}`)));
    area.append(tabs, holder);
    await open(maps[0]);
    return;
  }
  const atoms = await topicAtoms(loop.nodeId);
  const notes = await app.db.getAllByIndex('notes', 'node', loop.nodeId);
  const ca = await app.db.getAllByIndex('ca', 'anchors', loop.nodeId);
  area.append(h('section', { class: 'card reading' },
    atoms.length ? h('ul', { class: 'reading-list' }, atoms.map((a) => h('li', { text: filled(a) }))) : h('p', { class: 'muted', text: 'This topic has no atoms yet.' }),
    notes.length ? [h('h3', { text: 'Notes' }), notes.map((x) => h('p', { class: 'pre small', text: x.text }))] : null,
    ca.length ? [h('h3', { text: 'In the news' }), ca.map((x) => h('p', { class: 'small' }, h('strong', { text: `${x.headline}. ` }), x.whyInNews))] : null,
    h('p', { class: 'small muted' }, 'Have the book? ', h('a', { href: '#/sources' }, 'Add it under Sources'), ' and map its pages to this topic.')));
}

async function stepRecall(body, loop, loopId, node) {
  const atoms = await topicAtoms(loop.nodeId);
  const started = performance.now();
  const ta = h('textarea', { class: 'note-input', rows: '10', placeholder: 'Everything you remember about this topic: facts, numbers, names, links. No peeking.', 'aria-label': 'Blank-page recall' });
  const count = h('span', { class: 'small muted', text: '0 words' });
  ta.addEventListener('input', () => { count.textContent = `${wordCount(ta.value)} words`; });
  const mic = dictation((t) => { ta.value = `${ta.value ? `${ta.value} ` : ''}${t}`; count.textContent = `${wordCount(ta.value)} words`; });
  const check = h('button', { class: 'btn primary', type: 'button' }, 'Done: check my recall');
  clear(body).append(h('section', { class: 'card' },
    h('h2', { text: '3. Blank-page recall' }),
    h('p', { class: 'recall-title', text: node.title }),
    h('p', { class: 'small muted', text: 'Only the title is shown. Type or dictate everything you remember; then tick what you recalled.' }),
    ta, count),
  h('div', { class: 'dock' }, mic, check));
  setTimeout(() => ta.focus(), 50);
  check.addEventListener('click', () => {
    const writeMs = Math.round(performance.now() - started);
    ta.readOnly = true;
    const ticks = atoms.map(() => false);
    const score = h('button', { class: 'btn primary', type: 'button' }, 'Score my recall');
    const list = h('div', { class: 'checklist' },
      atoms.length ? atoms.map((a, i) => {
        const cb = h('input', { type: 'checkbox' });
        cb.addEventListener('change', () => { ticks[i] = cb.checked; });
        return h('label', { class: 'check-row' }, cb, h('span', { text: filled(a) }));
      }) : h('p', { class: 'small muted', text: 'This topic has no atoms to check yet.' }));
    clear(body).append(h('section', { class: 'card' },
      h('h2', { text: '3. Tick what you recalled' }),
      h('details', null, h('summary', { text: 'Your recall' }), h('p', { class: 'pre small', text: ta.value || '(empty)' })),
      list),
    h('div', { class: 'dock' }, score));
    score.addEventListener('click', async () => {
      const ticked = atoms.filter((a, i) => ticks[i]).map((a) => a.id);
      const missed = atoms.filter((a, i) => !ticks[i]).map((a) => a.id);
      const pct = atoms.length ? Math.round((ticked.length / atoms.length) * 100) : null;
      await appendEvents([
        ['learn.recall', { loopId, nodeId: loop.nodeId, text: ta.value.slice(0, 8000), ticked, missed, total: atoms.length, pct }],
        ['session.active', { sessionId: loopId, ms: writeMs }],
      ]);
      clear(body).append(h('section', { class: 'card' },
        h('h2', { text: pct === null ? 'Recall noted' : `Recall: ${pct}%` }),
        pct === null ? h('p', { text: 'No atoms to score yet.' })
          : pct >= PASS ? h('p', { text: `At ${PASS}% or more, this topic is marked Learned when you finish the loop.` })
            : h('p', { text: `Below ${PASS}%, the topic stays Learning. ${plural(missed.length, 'missed atom')} ${missed.length === 1 ? 'is' : 'are'} scheduled for review today.` })),
      h('div', { class: 'dock' }, h('button', { class: 'btn primary', type: 'button', onclick: () => { location.hash = `#/learn/${encodeURIComponent(loopId)}?r=${Date.now()}`; } }, 'Next: the probe set')));
    });
  });
}

async function stepProbes(body, loop, loopId, node) {
  const items = await probeSetItems(loop.nodeId, loopId);
  const next = (n, correct) => advance([['learn.step', { loopId, step: 'output', probes: { n, correct } }]]);
  if (!items.length) {
    clear(body).append(h('section', { class: 'card' }, h('h2', { text: '4. Probe set' }), h('p', { text: 'No atoms to probe yet.' }),
      h('div', { class: 'dock' }, h('button', { class: 'btn primary', type: 'button', onclick: () => next(0, 0) }, 'Continue'))));
    return;
  }
  const mine = items.filter((x) => x.kind === 'learning').length;
  clear(body).append(h('section', { class: 'card' },
    h('h2', { text: '4. Probe set' }),
    h('p', { text: items.length - mine ? `${plural(items.length, 'probe')}: ${mine} from this topic and ${items.length - mine} from older topics, mixed. These are real reviews and update your schedule.` : `${plural(items.length, 'probe')}, all from this topic in different formats: there are no older topics to mix in yet. These are real reviews and update your schedule.` }),
    items.length < 10 ? h('p', { class: 'small muted', text: `Fewer than 10: this topic has few atoms, so each probe comes up at most twice.` }) : null,
    h('div', { class: 'dock' }, h('button', {
      class: 'btn primary', type: 'button',
      onclick: () => {
        const host = h('div', { class: 'review-host inline' });
        clear(body).append(host);
        live.session = new Session({
          host, mode: 'learn', items, title: 'Probe set', nodeId: loop.nodeId, loopId, reinsert: false,
          onEnd: async (sum) => {
            if (sum.early && sum.remaining) return unfinished(body, 'probe set', loopId);
            await next(sum.n, sum.right);
          },
        });
        live.session.start();
      },
    }, 'Start the probe set'))));
}

async function stepOutput(body, loop, loopId, node) {
  const q = await outputQuestion(loop.nodeId, node);
  const intro = h('input', { type: 'text', class: 'field-input', placeholder: 'Intro line', 'aria-label': 'Intro line', disabled: true });
  const heads = [1, 2, 3, 4].map((i) => h('input', { type: 'text', class: 'field-input', placeholder: `Heading ${i}`, 'aria-label': `Heading ${i}`, disabled: true }));
  const way = h('input', { type: 'text', class: 'field-input', placeholder: 'Way forward', 'aria-label': 'Way forward', disabled: true });
  const clockEl = h('span', { class: 'timer big', text: fmtClock(OUTPUT_SECONDS * 1000) });
  const start = h('button', { class: 'btn primary', type: 'button' }, `Start ${OUTPUT_SECONDS} seconds`);
  const save = h('button', { class: 'btn primary', type: 'button', hidden: true }, 'Save skeleton and finish');
  let t0 = null;
  start.addEventListener('click', () => {
    t0 = performance.now();
    [intro, ...heads, way].forEach((x) => { x.disabled = false; });
    intro.focus();
    start.hidden = true;
    save.hidden = false;
    live.timers.push(setInterval(() => {
      const left = OUTPUT_SECONDS * 1000 - (performance.now() - t0);
      clockEl.textContent = left > 0 ? fmtClock(left) : `Time! +${fmtClock(-left)}`;
      clockEl.classList.toggle('over', left <= 0);
    }, 250));
  });
  save.addEventListener('click', async () => {
    const skeleton = { intro: intro.value.trim(), headings: heads.map((x) => x.value.trim()), way: way.value.trim() };
    if (!skeleton.intro && !skeleton.headings.some(Boolean)) { toast('Write at least the intro or a heading.', { kind: 'warn' }); return; }
    const ms = Math.round(performance.now() - t0);
    save.disabled = true;
    await appendEvents([
      ['learn.output', { loopId, nodeId: loop.nodeId, question: q.text, skeleton, ms }],
      ['session.active', { sessionId: loopId, ms }],
      ['learn.completed', { loopId, nodeId: loop.nodeId }],
      ['session.ended', { sessionId: loopId }],
    ]);
    location.hash = `#/learn/${encodeURIComponent(loopId)}?r=${Date.now()}`;
  });
  clear(body).append(h('section', { class: 'card' },
    h('h2', { text: '5. Output: 90-second skeleton' }),
    h('p', { class: 'small muted', text: `From ${q.from} · ${q.directive} · ${q.marks} marks` }),
    h('p', { class: 'question', text: q.text }),
    h('div', { class: 'form' }, intro, heads, way)),
  h('div', { class: 'dock' }, clockEl, start, save));
}

function doneView(loop, node) {
  const nodeState = app.state.nodes[loop.nodeId] || {};
  const mins = Math.max(1, Math.round(((loop.completedTs || clock.now()) - loop.startedTs) / 60000));
  const pre = loop.pretest;
  const pr = loop.probes;
  const n = app.state.notes[loop.nodeId];
  const nextLevel = !n || !n.latest ? 1 : Math.min(4, n.latest.level + 1);
  return h('div', { class: 'learn-done' },
    h('section', { class: 'card summary' },
      h('h2', { text: loop.discarded ? 'Learn Loop discarded' : `Learn Loop done: ${node.title}` }),
      loop.discarded ? null : h('div', { class: 'stat-row' },
        h('div', { class: 'stat' }, h('strong', { text: loop.recallPct === null || loop.recallPct === undefined ? '—' : `${loop.recallPct}%` }), h('span', { class: 'small muted', text: 'recall' })),
        h('div', { class: 'stat' }, h('strong', { text: pr && pr.n ? `${pr.correct}/${pr.n}` : '—' }), h('span', { class: 'small muted', text: 'probes right' })),
        h('div', { class: 'stat' }, h('strong', { text: `${mins} min` }), h('span', { class: 'small muted', text: 'total' }))),
      pre && pre.n ? h('p', { class: 'small', text: `Pre-test: ${pre.correct} of ${pre.n} before reading.` }) : null,
      loop.discarded ? null : h('p', { text: nodeState.status === 'learned' ? 'This topic is now Learned.' : `This topic stays Learning (recall under ${PASS}%). Its missed atoms are in today’s reviews.` }),
      h('div', { class: 'button-row' },
        loop.discarded ? null : h('a', { class: 'btn primary', href: `#/notes/${encodeURIComponent(loop.nodeId)}?write=1&level=${nextLevel}` }, `Write R${nextLevel} notes`),
        h('a', { class: 'btn', href: `#/node/${encodeURIComponent(loop.nodeId)}` }, 'Back to the topic'),
        h('a', { class: 'btn', href: '#/today' }, 'Today'))));
}
