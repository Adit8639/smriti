// Mains Studio flows, each in focus mode: Skeleton Sprint, Timed answer (photo + rubric +
// compare), Shadow Writing, the directive drill, GS-IV case mode, Essay mode, and the CAPF
// précis and counter-argument drills. Every attempt is saved as an event.

import { h, clear, toast, confirmSheet } from './ui.js';
import { app, activeProfile, appendEvents } from './store.js';
import { DIRECTIVES, DIRECTIVE_BY_ID, directiveName, detectDirective, RUBRIC, rubricTotal, VALUE_ADD_TYPES, VALUE_ADD_LABEL, normalizeValueAdd, valueAddCategory, dimensionOverlap, skeletonDiff, precisCheck, answerLimits, bestModelAnswer } from './mains.js';
import { countdown, wordArea, chipSelect, dimensions, cap, questionPool, pickQuestion } from './mains-ui.js';
import { ulid } from './ulid.js';
import { rng, freshSeed } from './rng.js';
import * as clock from './clock.js';
import { wordCount, plural } from './util.js';

const SPRINT_MS = 90000;

// Runs a flow in focus mode; the returned cleanup stops timers when leaving the screen.
let cleanup = null;
export function leaveFlow() {
  document.body.classList.remove('focus');
  if (cleanup) { try { cleanup(); } catch (_) { /* ignore */ } }
  cleanup = null;
}
const onLeave = (fn) => { cleanup = fn; };
const head = (title, right = null, onExit = null) => h('div', { class: 'rv-head' },
  h('button', { class: 'btn small', type: 'button', onclick: () => { if (onExit) onExit(); else location.hash = '#/mains'; } }, 'Exit'),
  h('div', { class: 'rv-title' }, h('strong', { text: title })), right || h('span'));

async function session(kind) {
  const sessionId = ulid(clock.now());
  await appendEvents([['session.started', { sessionId, kind }]]);
  return sessionId;
}
const endSession = (sessionId) => appendEvents([['session.ended', { sessionId }]]).catch(() => {});
const profilePaper = (id) => (activeProfile() && activeProfile().papers || []).find((p) => p.id === id) || null;
const mainsPaper = (q) => profilePaper(q.paper) || (activeProfile() && activeProfile().papers || []).find((p) => p.type === 'descriptive' && p.wordLimits) || null;
const qSnap = (q) => ({ ref: q.ref || null, text: q.text, directive: q.directive || detectDirective(q.text), paper: q.paper || null, marks: q.marks || null, nodes: q.nodes || [], answerId: q.answerId || null });

function questionBlock(q) {
  const d = q.directive || detectDirective(q.text);
  const dd = d && DIRECTIVE_BY_ID.get(d);
  return h('div', { class: 'mains-q' },
    h('p', { class: 'question', text: q.text }),
    h('p', { class: 'small muted' }, [q.source, q.marks ? `${q.marks} marks` : null].filter(Boolean).join(' · '),
      dd ? h('span', { class: 'directive-hint' }, ' · ', h('strong', { text: dd.name }), `: ${dd.asks}`) : null));
}

// ------------------------------------------------------------------ Skeleton Sprint
export async function sprint(host, { refs = [], n = 5 } = {}) {
  const pool = await questionPool();
  let qs = refs.length ? refs.map((r) => pool.find((q) => q.ref === r)).filter(Boolean) : [];
  if (!qs.length) {
    const done = new Set(Object.values(app.state.mains.attempts).filter((a) => a.kind === 'sprint').map((a) => a.ref));
    const fresh = pool.filter((q) => !done.has(q.ref));
    qs = rng(freshSeed(clock.now())).sample(fresh.length >= n ? fresh : pool, n);
  }
  if (!qs.length) {
    const q = await pickQuestion({ title: 'Sprint on which question?' });
    if (!q) { location.hash = '#/mains'; return; }
    qs = [q];
  }
  document.body.classList.add('focus');
  const sprintId = ulid(clock.now());
  const sessionId = await session('mains');
  const results = [];
  let i = 0;
  let timer = null;
  onLeave(() => { if (timer) timer.stop(); endSession(sessionId); });
  const show = () => {
    const q = qs[i];
    const intro = wordArea({ single: true, placeholder: 'Intro line (one sentence)', label: 'Intro line', mic: true });
    const rows = Array.from({ length: 6 }, (_, k) => ({
      h: h('input', { type: 'text', class: 'field-input', placeholder: `Dimension heading ${k + 1}${k >= 4 ? ' (optional)' : ''}`, 'aria-label': `Heading ${k + 1}` }),
      va: h('input', { type: 'text', class: 'field-input', placeholder: 'One value-add: Article, judgment, report, data with year…', 'aria-label': `Value-add ${k + 1}` }),
    }));
    const way = wordArea({ single: true, placeholder: 'Way forward (one line)', label: 'Way forward', mic: true });
    const chips = h('div', { class: 'cause-chips', 'aria-label': 'Dimension wheel' }, dimensions().map((d) => h('button', {
      class: 'chip-btn', type: 'button',
      onclick: () => { const r = rows.find((x) => !x.h.value.trim()); if (r) { r.h.value = cap(d); r.va.focus(); } },
    }, cap(d))));
    const save = async (auto) => {
      if (timer) timer.stop();
      const headings = rows.map((r) => ({ h: r.h.value.trim(), va: r.va.value.trim() })).filter((x) => x.h);
      const ms = Math.min(SPRINT_MS + 60000, timer ? timer.elapsed() : 0);
      const attemptId = ulid(clock.now());
      const dims = headings.map((x) => x.h.toLowerCase()).filter((x) => dimensions().includes(x));
      results.push({ q, headings, intro: intro.value(), way: way.value(), attemptId });
      await appendEvents([['mains.sprint', { attemptId, sprintId, q: qSnap(q), intro: intro.value(), headings, wayForward: way.value(), dims, ms, limitMs: SPRINT_MS, auto: !!auto, sessionId }],
        ['session.active', { sessionId, ms }]]);
      i++;
      if (i < qs.length) show(); else finish();
    };
    timer = countdown({ ms: SPRINT_MS, onEnd: () => { toast('Time: saving this skeleton.', { ms: 1500 }); save(true); } });
    clear(host).append(h('div', { class: 'rv mains-flow' },
      head(`Skeleton sprint · ${i + 1} / ${qs.length}`, timer.el, () => { if (timer) timer.stop(); location.hash = '#/mains'; }),
      h('div', { class: 'rv-body' },
        questionBlock(q),
        intro.el,
        h('p', { class: 'small muted', text: 'Tap a dimension to fill the next heading; add one value-add each.' }), chips,
        h('div', { class: 'sprint-rows' }, rows.map((r) => h('div', { class: 'sprint-row' }, r.h, r.va))),
        way.el),
      h('div', { class: 'rv-foot' }, h('div', { class: 'foot-row' }, h('button', { class: 'btn primary grow', type: 'button', onclick: () => save(false) }, i < qs.length - 1 ? 'Done: next question' : 'Done')))));
    intro.input.focus();
  };
  const finish = async () => {
    await endSession(sessionId);
    cleanup = null;
    document.body.classList.remove('focus');
    const answers = await app.db.getAll('answers');
    clear(host).append(h('div', { class: 'focus-frame' }, h('div', { class: 'card summary' },
      h('h2', { text: 'Sprint done' }),
      h('p', { text: `${plural(results.length, 'skeleton')} saved.` }),
      h('ul', { class: 'plain sprint-summary' }, results.map((r) => {
        const model = bestModelAnswer(r.q, answers);
        return h('li', null, h('strong', { text: r.q.text.slice(0, 120) }), h('span', { class: 'small muted block', text: `${plural(r.headings.length, 'heading')}${r.headings.filter((x) => x.va).length ? `, ${r.headings.filter((x) => x.va).length} with a value-add` : ''}` }),
          model ? h('a', { class: 'btn small', href: `#/mains/attempt/${r.attemptId}` }, 'Compare with the model answer') : null);
      })),
      h('div', { class: 'button-row' }, h('a', { class: 'btn primary', href: '#/mains' }, 'Mains Studio'), h('a', { class: 'btn', href: '#/mains?tab=history' }, 'All attempts')))));
  };
  show();
}

// ------------------------------------------------------------------ Timed answer
const MAX_SIDE = 1600;
async function shrinkPhoto(file) {
  const bmp = await createImageBitmap(file).catch(() => null);
  if (!bmp) return file;
  const scale = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * scale);
  c.height = Math.round(bmp.height * scale);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  return new Promise((resolve) => c.toBlob((b) => resolve(b || file), 'image/jpeg', 0.72));
}

export async function timedAnswer(host, { ref = null, marks = null } = {}) {
  let q = null;
  if (ref) q = (await questionPool()).find((x) => x.ref === ref) || null;
  if (!q) q = await pickQuestion({ title: 'Which question will you write?' });
  if (!q) { location.hash = '#/mains'; return; }
  const m = marks || q.marks || 10;
  const limits = answerLimits(mainsPaper(q), m >= 15 ? 15 : 10);
  document.body.classList.add('focus');
  const sessionId = await session('mains');
  let timer = null;
  onLeave(() => { if (timer) timer.stop(); endSession(sessionId); });
  let writeMs = 0;
  const photos = [];

  const step1 = () => {
    clear(host).append(h('div', { class: 'rv mains-flow' }, head('Timed answer'),
      h('div', { class: 'rv-body' }, questionBlock(q),
        h('div', { class: 'card hint' }, h('p', { text: `Write on paper: ${limits.minutes} minutes, about ${limits.words} words.` }),
          h('p', { class: 'small muted', text: 'Plan 1 minute (intro, 4–6 sub-headed points, a diagram if it helps, way forward), then write. The clock counts only while this screen is visible.' }))),
      h('div', { class: 'rv-foot' }, h('div', { class: 'foot-row' }, h('button', { class: 'btn primary grow', type: 'button', onclick: step2 }, 'Start the clock')))));
  };
  const step2 = () => {
    timer = countdown({ ms: limits.ms, big: true, warnAt: 60000, onEnd: () => toast("Time's up: finish your sentence and stop.", { kind: 'warn', ms: 5000 }) });
    clear(host).append(h('div', { class: 'rv mains-flow' }, head('Writing…', null, async () => { if (await confirmSheet({ title: 'Stop this answer?', message: 'Nothing is saved yet.', confirmLabel: 'Stop', danger: true })) { timer.stop(); location.hash = '#/mains'; } }),
      h('div', { class: 'rv-body center' }, questionBlock(q), h('div', { class: 'big-timer' }, timer.el), h('p', { class: 'small muted', text: `${limits.words} words · write on paper` })),
      h('div', { class: 'rv-foot' }, h('div', { class: 'foot-row' }, h('button', { class: 'btn primary grow', type: 'button', onclick: () => { writeMs = timer.elapsed(); timer.stop(); step3(); } }, 'I have finished writing')))));
  };
  const step3 = () => {
    const thumbs = h('div', { class: 'photo-row' });
    const file = h('input', { type: 'file', accept: 'image/*', capture: 'environment', multiple: true, hidden: true });
    file.addEventListener('change', async () => {
      for (const f of [...file.files]) {
        const blob = await shrinkPhoto(f);
        const id = `img-${ulid(clock.now())}`;
        await app.db.put('sources', { id, kind: 'photo', blob, bytes: blob.size, createdAt: Date.now() });
        photos.push(id);
        const url = URL.createObjectURL(blob);
        thumbs.append(h('img', { class: 'answer-photo', src: url, alt: `Answer photo ${photos.length}` }));
      }
      file.value = '';
    });
    const dims = chipSelect(dimensions().map((d) => [d, cap(d)]), [], { label: 'Dimensions covered' });
    const vas = chipSelect(VALUE_ADD_TYPES, [], { label: 'Value-adds used' });
    const words = h('input', { type: 'number', min: '0', max: '2000', class: 'field-input short', placeholder: String(limits.words), 'aria-label': 'Words written (estimate)' });
    const scores = {};
    const rubric = h('div', { class: 'rubric' }, RUBRIC.map(([key, label, levels]) => h('div', { class: 'rubric-row' },
      h('strong', { text: label }),
      h('div', { class: 'segmented' }, levels.map((text, v) => h('label', { class: 'seg', title: text },
        h('input', { type: 'radio', name: `r-${key}`, value: String(v), onchange: () => { scores[key] = v; total.textContent = `${rubricTotal(scores)} / 12`; } }),
        h('span', { text: `${v}` })))),
      h('span', { class: 'small muted', text: levels.join(' · ') }))));
    const total = h('strong', { text: '0 / 12' });
    clear(host).append(h('div', { class: 'rv mains-flow' }, head('Score your answer'),
      h('div', { class: 'rv-body' },
        questionBlock(q),
        h('p', { class: 'small', text: `Written in ${Math.round(writeMs / 60000 * 10) / 10} min of ${limits.minutes}.` }),
        h('section', { class: 'card' }, h('h3', { text: 'Photo of your answer (stays on this device)' }), thumbs,
          h('button', { class: 'btn small', type: 'button', onclick: () => file.click() }, photos.length ? 'Add another photo' : 'Take or choose a photo'), file),
        h('section', { class: 'card' }, h('h3', { text: 'What it covered' }), h('p', { class: 'small muted', text: 'Dimensions' }), dims.el, h('p', { class: 'small muted', text: 'Value-adds' }), vas.el,
          h('label', { class: 'field' }, h('span', { text: 'Words (estimate)' }), words)),
        h('section', { class: 'card' }, h('h3', null, 'Self-score: ', total), h('p', { class: 'small muted', text: '0, 1 or 2 for each line: be strict.' }), rubric)),
      h('div', { class: 'rv-foot' }, h('div', { class: 'foot-row' }, h('button', {
        class: 'btn primary grow', type: 'button',
        onclick: async () => {
          if (RUBRIC.some(([k]) => !Number.isInteger(scores[k]))) { toast('Score every line of the rubric first.', { kind: 'warn' }); return; }
          const attemptId = ulid(clock.now());
          const answers = await app.db.getAll('answers');
          const model = bestModelAnswer(q, answers);
          await appendEvents([['mains.answer', { attemptId, q: qSnap(q), marks: m, limitMs: limits.ms, writeMs: Math.round(writeMs), words: Number(words.value) || null, photoIds: photos, rubric: scores, total: rubricTotal(scores), dims: dims.value(), valueAdds: vas.value(), modelId: model ? model.id : null, sessionId, ms: Math.round(writeMs) }],
            ['session.active', { sessionId, ms: Math.round(writeMs) }]]);
          await endSession(sessionId);
          cleanup = null;
          location.hash = `#/mains/attempt/${attemptId}`;
        },
      }, 'Save')))));
  };
  step1();
}

// ------------------------------------------------------------------ Shadow Writing
function asSkeleton(x) {
  if (!x) return { intro: '', body: [], conclusion: '' };
  if (Array.isArray(x)) return { intro: '', body: x.map(String), conclusion: '' };
  if (typeof x === 'string') return { intro: '', body: x.split('\n').map((s) => s.replace(/^[-•\d.)\s]+/, '').trim()).filter(Boolean), conclusion: '' };
  return { intro: x.intro || '', body: Array.isArray(x.body) ? x.body.map(String) : [], conclusion: x.conclusion || '' };
}

export async function shadow(host, { answerId, drill = null }) {
  const a = await app.db.get('answers', answerId);
  if (!a) { clear(host).append(h('div', { class: 'card' }, h('p', { text: 'That model answer is not installed.' }), h('a', { class: 'btn', href: '#/mains' }, 'Mains Studio'))); return; }
  const d = Number.isInteger(drill) && a.drills && a.drills[drill] ? a.drills[drill] : null;
  const model = d ? asSkeleton(d.hiddenSkeleton) : asSkeleton(a.skeleton);
  const question = d ? d.question : a.question;
  document.body.classList.add('focus');
  const sessionId = await session('mains');
  let timer = null;
  let showMs = 0;
  const started = performance.now();
  onLeave(() => { if (timer) timer.stop(); endSession(sessionId); });

  const view = () => {
    timer = countdown({ ms: 120000, warnAt: 20000, onEnd: rebuild });
    clear(host).append(h('div', { class: 'rv mains-flow' }, head('Shadow Writing: read', timer.el),
      h('div', { class: 'rv-body' },
        h('p', { class: 'question', text: question }),
        h('p', { class: 'small muted', text: `${a.topper ? `${a.topper.name || 'Topper'}${a.topper.rank ? `, AIR ${a.topper.rank}` : ''}${a.topper.year ? ` (${a.topper.year})` : ''} · ` : ''}Read for 2 minutes; then it hides and you rebuild the skeleton from memory.` }),
        h('div', { class: 'card model-answer' },
          h('p', null, h('strong', { text: 'Intro: ' }), model.intro || '—'),
          h('ol', null, model.body.map((b) => h('li', { text: b }))),
          h('p', null, h('strong', { text: 'Conclusion: ' }), model.conclusion || '—'),
          (a.dimensions || []).length ? h('p', { class: 'small' }, h('span', { class: 'muted', text: 'Dimensions: ' }), a.dimensions.join(', ')) : null,
          (a.valueAdds || []).length ? h('ul', { class: 'plain small' }, a.valueAdds.map((v) => h('li', null, h('span', { class: 'badge muted', text: VALUE_ADD_LABEL[normalizeValueAdd(v.type)] || v.type }), ' ', v.text))) : null)),
      h('div', { class: 'rv-foot' }, h('div', { class: 'foot-row' }, h('button', { class: 'btn primary grow', type: 'button', onclick: rebuild }, 'Hide it now')))));
  };
  const rebuild = () => {
    if (timer) { showMs = timer.elapsed(); timer.stop(); timer = null; }
    const intro = wordArea({ single: true, placeholder: 'Intro (gist)', label: 'Intro' });
    const rows = h('div', { class: 'sprint-rows' });
    const addRow = () => rows.append(h('input', { type: 'text', class: 'field-input', placeholder: `Body heading ${rows.children.length + 1}`, 'aria-label': `Body heading ${rows.children.length + 1}` }));
    for (let k = 0; k < Math.max(4, model.body.length); k++) addRow();
    const concl = wordArea({ single: true, placeholder: 'Conclusion (gist)', label: 'Conclusion' });
    clear(host).append(h('div', { class: 'rv mains-flow' }, head('Shadow Writing: rebuild'),
      h('div', { class: 'rv-body' }, h('p', { class: 'question', text: question }),
        h('p', { class: 'small muted', text: d ? 'Rebuild the hidden skeleton: intro, the body headings in order, the conclusion.' : 'From memory: the intro, each body heading in order, the conclusion.' }),
        intro.el, rows, h('button', { class: 'btn small', type: 'button', onclick: addRow }, 'Add a heading'), concl.el),
      h('div', { class: 'rv-foot' }, h('div', { class: 'foot-row' }, h('button', {
        class: 'btn primary grow', type: 'button',
        onclick: async () => {
          const rebuilt = { intro: intro.value(), body: [...rows.querySelectorAll('input')].map((x) => x.value.trim()).filter(Boolean), conclusion: concl.value() };
          const diff = skeletonDiff(model, rebuilt);
          const attemptId = ulid(clock.now());
          const ms = Math.round(performance.now() - started);
          await appendEvents([['mains.shadow', { attemptId, answerId: a.id, drill: Number.isInteger(drill) ? drill : null, q: { ref: `ans:${a.id}`, text: question, nodes: [] }, rebuilt, matched: diff.matched.length, missed: diff.missed.length, extra: diff.extra.length, score: Math.round(diff.score * 100) / 100, showMs: Math.round(showMs), ms, sessionId }],
            ['session.active', { sessionId, ms: Math.max(0, ms - Math.round(showMs)) }]]);
          await endSession(sessionId);
          cleanup = null;
          location.hash = `#/mains/attempt/${attemptId}`;
        },
      }, 'Show the diff')))));
    intro.input.focus();
  };
  if (d) rebuild(); else view();
}

// ------------------------------------------------------------------ directive drill
export async function directiveDrill(host, { n = 10 } = {}) {
  const r = rng(freshSeed(clock.now()));
  const items = [];
  for (const d of DIRECTIVES) for (const p of d.patterns) items.push({ id: `${d.id}:${d.patterns.indexOf(p)}`, text: p, answer: d.id });
  for (const a of await app.db.getAll('answers')) {
    const d = detectDirective(a.directive || '');
    if (d && a.skeleton) items.push({ id: `ans:${a.id}`, text: `Intro: ${a.skeleton.intro}\n${(a.skeleton.body || []).map((b, i) => `${i + 1}. ${b}`).join('\n')}\nConclusion: ${a.skeleton.conclusion}`, answer: d, model: true });
  }
  const picked = r.sample(items, Math.min(n, items.length));
  document.body.classList.add('focus');
  let i = 0;
  let right = 0;
  const show = () => {
    const it = picked[i];
    const d = DIRECTIVE_BY_ID.get(it.answer);
    const opts = r.shuffle([it.answer, ...r.sample(d.near.filter((x) => x !== it.answer), 3)]).slice(0, 4);
    const t0 = performance.now();
    const reveal = h('div', { class: 'rv-reveal', hidden: true });
    const btns = opts.map((o) => h('button', {
      class: 'opt', type: 'button',
      onclick: async () => {
        if (!reveal.hidden) return;
        const ok = o === it.answer;
        if (ok) right++;
        btns.forEach((b, k) => { b.disabled = true; if (opts[k] === it.answer) b.classList.add('right'); else if (b === btns[opts.indexOf(o)]) b.classList.add('wrong'); });
        reveal.hidden = false;
        reveal.append(h('p', { class: `verdict ${ok ? 'right' : 'wrong'}`, text: ok ? 'Correct' : `It is ${d.name}` }),
          h('p', { class: 'small' }, h('strong', { text: `${d.name}: ` }), d.asks), h('p', { class: 'small muted', text: `Check: ${d.check}` }));
        await appendEvents([['mains.drill', { kind: 'directive', item: it.id, choice: o, answer: it.answer, correct: ok, ms: Math.round(performance.now() - t0) }]]);
        foot.hidden = false;
      },
    }, h('span', { class: 'opt-text', text: directiveName(o) })));
    const foot = h('div', { class: 'foot-row', hidden: true }, h('button', { class: 'btn primary grow', type: 'button', onclick: () => { i++; if (i < picked.length) show(); else done(); } }, i < picked.length - 1 ? 'Next' : 'Finish'));
    clear(host).append(h('div', { class: 'rv mains-flow' }, head(`Which directive? · ${i + 1} / ${picked.length}`),
      h('div', { class: 'rv-body' }, h('p', { class: 'small muted', text: it.model ? 'This is the skeleton of a model answer. Which directive is it obeying?' : 'An answer does this. Which directive is it obeying?' }),
        h('p', { class: 'pv-stem pre', text: it.text }), h('div', { class: 'opts' }, btns), reveal),
      h('div', { class: 'rv-foot' }, foot)));
  };
  const done = () => {
    document.body.classList.remove('focus');
    clear(host).append(h('div', { class: 'focus-frame' }, h('div', { class: 'card summary' }, h('h2', { text: 'Drill done' }), h('p', { class: 'big-number' }, h('strong', { text: `${right} / ${picked.length}` }), ' right'),
      h('div', { class: 'button-row' }, h('a', { class: 'btn primary', href: '#/mains?tab=toolkit' }, 'Directive decoder'), h('a', { class: 'btn', href: '#/mains' }, 'Mains Studio')))));
  };
  show();
}

// ------------------------------------------------------------------ GS-IV case mode
export async function caseMode(host, { ref = null } = {}) {
  let q = ref ? (await questionPool()).find((x) => x.ref === ref) : null;
  const caseText = q ? q.text : '';
  document.body.classList.add('focus');
  const sessionId = await session('mains');
  const timer = countdown({ ms: 15 * 60000, warnAt: 120000, onEnd: () => toast('15 minutes are up: settle on a course and justify it.', { kind: 'warn', ms: 5000 }) });
  onLeave(() => { timer.stop(); endSession(sessionId); });
  const caseBox = wordArea({ rows: 5, placeholder: 'Paste or type the case (or choose one below)', label: 'The case', value: caseText });
  const stake = wordArea({ rows: 3, placeholder: 'Stakeholders, one per line', label: 'Stakeholders' });
  const values = wordArea({ rows: 3, placeholder: 'Values in conflict, e.g. honesty vs loyalty, one pair per line', label: 'Values in conflict' });
  const opts = Array.from({ length: 3 }, (_, k) => ({ text: h('input', { type: 'text', class: 'field-input', placeholder: `Option ${k + 1}`, 'aria-label': `Option ${k + 1}` }), pros: h('input', { type: 'text', class: 'field-input', placeholder: 'Pros', 'aria-label': `Option ${k + 1} pros` }), cons: h('input', { type: 'text', class: 'field-input', placeholder: 'Cons', 'aria-label': `Option ${k + 1} cons` }) }));
  const choice = h('select', { 'aria-label': 'Chosen course' }, [0, 1, 2].map((k) => h('option', { value: String(k), text: `Option ${k + 1}` })));
  const why = wordArea({ rows: 4, placeholder: 'Your course of action and why: values upheld, law, consequences, compassion', label: 'Justification', mic: true });
  clear(host).append(h('div', { class: 'rv mains-flow' }, head('GS-IV case (15 min)', timer.el),
    h('div', { class: 'rv-body' },
      h('section', { class: 'card' }, h('h3', { text: 'The case' }), caseBox.el,
        h('button', { class: 'btn small', type: 'button', onclick: async () => { const p = await pickQuestion({ title: 'Choose a case', filter: (x) => /gs4|ethic/i.test(x.paper || '') || /case/i.test(x.text), allowOwn: false }); if (p) { q = p; caseBox.input.value = p.text; caseBox.update(); } } }, 'Choose a case from your packs')),
      h('section', { class: 'card' }, h('h3', { text: '1 · Stakeholders' }), stake.el),
      h('section', { class: 'card' }, h('h3', { text: '2 · Values in conflict' }), values.el),
      h('section', { class: 'card' }, h('h3', { text: '3 · Options, with pros and cons' }), opts.map((o) => h('div', { class: 'case-opt' }, o.text, o.pros, o.cons))),
      h('section', { class: 'card' }, h('h3', { text: '4 · Chosen course and justification' }), choice, why.el)),
    h('div', { class: 'rv-foot' }, h('div', { class: 'foot-row' }, h('button', {
      class: 'btn primary grow', type: 'button',
      onclick: async () => {
        if (!caseBox.value() || !why.value()) { toast('Add the case and your justification first.', { kind: 'warn' }); return; }
        const ms = Math.round(timer.elapsed());
        timer.stop();
        const attemptId = ulid(clock.now());
        const lines = (x) => x.value().split('\n').map((s) => s.trim()).filter(Boolean);
        await appendEvents([['mains.case', { attemptId, q: { ...(q ? qSnap(q) : { ref: null, nodes: [] }), text: caseBox.value() }, stakeholders: lines(stake), values: lines(values), options: opts.map((o) => ({ text: o.text.value.trim(), pros: o.pros.value.trim(), cons: o.cons.value.trim() })).filter((o) => o.text), choice: Number(choice.value), justification: why.value(), ms, sessionId }],
          ['session.active', { sessionId, ms }]]);
        await endSession(sessionId);
        cleanup = null;
        location.hash = `#/mains/attempt/${attemptId}`;
      },
    }, 'Save case answer')))));
}

// ------------------------------------------------------------------ Essay mode
export async function essayMode(host, { ref = null } = {}) {
  let theme = ref ? ((await questionPool()).find((x) => x.ref === ref) || {}).text || '' : '';
  const quotes = (await app.db.getAll('atoms')).filter((a) => a.type === 'quote');
  document.body.classList.add('focus');
  const sessionId = await session('mains');
  let timer = null;
  const started = performance.now();
  onLeave(() => { if (timer) timer.stop(); endSession(sessionId); });
  const data = { brainstorm: '', outline: { intro: '', body: [], conclusion: '' }, introDraft: '', conclusionDraft: '' };
  const quoteBank = () => (quotes.length ? h('details', { class: 'card' }, h('summary', null, h('strong', { text: `Quote bank (${quotes.length})` })),
    h('ul', { class: 'plain small' }, quotes.map((x) => h('li', { text: String(x.answer && !/_{3,}/.test(x.text) ? `${x.text} — ${x.answer}` : x.text.replace(/_{3,}/, x.answer)) }))))
    : h('p', { class: 'small muted', text: 'Quote atoms (type "quote") from your packs appear here.' }));

  const stage0 = () => {
    const box = wordArea({ rows: 3, placeholder: 'Essay theme or topic', label: 'Essay theme', value: theme });
    clear(host).append(h('div', { class: 'rv mains-flow' }, head('Essay'),
      h('div', { class: 'rv-body' }, h('p', { class: 'small muted', text: 'Four stages: a 15-minute brainstorm map, a 10-minute outline sprint, then the intro and conclusion drafts.' }), box.el,
        h('button', { class: 'btn small', type: 'button', onclick: async () => { const p = await pickQuestion({ title: 'Choose an essay theme', filter: (x) => /essay/i.test(x.paper || ''), allowOwn: false }); if (p) { box.input.value = p.text; box.update(); } } }, 'Choose from essay PYQs')),
      h('div', { class: 'rv-foot' }, h('div', { class: 'foot-row' }, h('button', { class: 'btn primary grow', type: 'button', onclick: () => { theme = box.value(); if (!theme) { toast('Enter a theme first.', { kind: 'warn' }); return; } stage1(); } }, 'Start the brainstorm')))));
  };
  const stage1 = () => {
    timer = countdown({ ms: 15 * 60000, warnAt: 120000, onEnd: () => toast('Brainstorm time is up: move to the outline.', { kind: 'warn' }) });
    const box = wordArea({ rows: 10, placeholder: 'Every idea, example and angle you can think of, one per line', label: 'Brainstorm', mic: true });
    const chips = h('div', { class: 'cause-chips' }, dimensions().map((d) => h('button', { class: 'chip-btn', type: 'button', onclick: () => { box.input.value += `${box.input.value && !box.input.value.endsWith('\n') ? '\n' : ''}${cap(d)}: `; box.input.focus(); box.update(); } }, cap(d))));
    clear(host).append(h('div', { class: 'rv mains-flow' }, head('Essay · brainstorm map', timer.el),
      h('div', { class: 'rv-body' }, h('p', { class: 'question', text: theme }), h('p', { class: 'small muted', text: 'Walk the dimension wheel: tap a dimension to start a line for it.' }), chips, box.el, quoteBank()),
      h('div', { class: 'rv-foot' }, h('div', { class: 'foot-row' }, h('button', { class: 'btn primary grow', type: 'button', onclick: () => { data.brainstorm = box.value(); timer.stop(); stage2(); } }, 'Outline sprint')))));
    box.input.focus();
  };
  const stage2 = () => {
    timer = countdown({ ms: 10 * 60000, warnAt: 60000 });
    const intro = wordArea({ single: true, placeholder: 'Intro idea (an anecdote, a quote, a striking fact)', label: 'Intro idea' });
    const rows = Array.from({ length: 8 }, (_, k) => h('input', { type: 'text', class: 'field-input', placeholder: `Paragraph ${k + 1}${k >= 6 ? ' (optional)' : ''}`, 'aria-label': `Paragraph ${k + 1}` }));
    const concl = wordArea({ single: true, placeholder: 'Conclusion idea (forward-looking)', label: 'Conclusion idea' });
    clear(host).append(h('div', { class: 'rv mains-flow' }, head('Essay · outline', timer.el),
      h('div', { class: 'rv-body' }, h('p', { class: 'question', text: theme }), h('details', null, h('summary', { text: 'Your brainstorm' }), h('p', { class: 'pre small', text: data.brainstorm })), intro.el, h('div', { class: 'sprint-rows' }, rows), concl.el),
      h('div', { class: 'rv-foot' }, h('div', { class: 'foot-row' }, h('button', { class: 'btn primary grow', type: 'button', onclick: () => { data.outline = { intro: intro.value(), body: rows.map((r) => r.value.trim()).filter(Boolean), conclusion: concl.value() }; timer.stop(); stage3(); } }, 'Draft intro and conclusion')))));
  };
  const stage3 = () => {
    const intro = wordArea({ rows: 6, placeholder: 'Introduction draft (about 150 words)', label: 'Introduction draft', cap: 200, mic: true });
    const concl = wordArea({ rows: 6, placeholder: 'Conclusion draft (about 150 words)', label: 'Conclusion draft', cap: 200, mic: true });
    clear(host).append(h('div', { class: 'rv mains-flow' }, head('Essay · drafts'),
      h('div', { class: 'rv-body' }, h('p', { class: 'question', text: theme }),
        h('div', { class: 'card' }, h('p', { class: 'small muted', text: 'Outline' }), h('p', { class: 'small' }, h('strong', { text: 'Intro: ' }), data.outline.intro || '—'), h('ol', { class: 'small' }, data.outline.body.map((b) => h('li', { text: b }))), h('p', { class: 'small' }, h('strong', { text: 'Conclusion: ' }), data.outline.conclusion || '—')),
        intro.el, concl.el, quoteBank()),
      h('div', { class: 'rv-foot' }, h('div', { class: 'foot-row' }, h('button', {
        class: 'btn primary grow', type: 'button',
        onclick: async () => {
          data.introDraft = intro.value();
          data.conclusionDraft = concl.value();
          const attemptId = ulid(clock.now());
          const ms = Math.round(performance.now() - started);
          await appendEvents([['mains.essay', { attemptId, theme, ...data, words: wordCount(data.introDraft) + wordCount(data.conclusionDraft), ms, sessionId }], ['session.active', { sessionId, ms }]]);
          await endSession(sessionId);
          cleanup = null;
          location.hash = `#/mains/attempt/${attemptId}`;
        },
      }, 'Save essay work')))));
  };
  if (theme) stage1(); else stage0();
}

// ------------------------------------------------------------------ CAPF: précis and counter-arguments
export async function precis(host) {
  document.body.classList.add('focus');
  const sessionId = await session('mains');
  const started = performance.now();
  onLeave(() => endSession(sessionId));
  const passage = wordArea({ rows: 8, placeholder: 'Paste the passage', label: 'Passage' });
  const out = wordArea({ rows: 6, placeholder: 'Your précis: one third of the passage, in your own words', label: 'Précis', mic: true });
  const status = h('p', { class: 'small' });
  const update = () => {
    const c = precisCheck(passage.value(), out.value());
    status.textContent = passage.words() ? `Passage ${passage.words()} words · target ${c.target} (one third) · yours ${c.words}${c.words ? (c.ok ? ': within 10%, good.' : c.off > 0 ? ': too long.' : ': too short.') : ''}` : 'Paste a passage to set the target.';
    status.className = `small ${c.words && !c.ok ? 'warn-text' : ''}`;
  };
  passage.input.addEventListener('input', update);
  out.input.addEventListener('input', update);
  update();
  clear(host).append(h('div', { class: 'rv mains-flow' }, head('Précis (CAPF Paper II)'),
    h('div', { class: 'rv-body' }, h('p', { class: 'small muted', text: 'The one-third rule: a précis keeps every key idea in about a third of the words, without examples or repetition.' }), passage.el, out.el, status),
    h('div', { class: 'rv-foot' }, h('div', { class: 'foot-row' }, h('button', {
      class: 'btn primary grow', type: 'button',
      onclick: async () => {
        if (!passage.value() || !out.value()) { toast('Paste a passage and write the précis first.', { kind: 'warn' }); return; }
        const c = precisCheck(passage.value(), out.value());
        const attemptId = ulid(clock.now());
        const ms = Math.round(performance.now() - started);
        await appendEvents([['mains.precis', { attemptId, passage: passage.value(), target: c.target, words: c.words, ok: c.ok, text: out.value(), ms, sessionId }], ['session.active', { sessionId, ms }]]);
        await endSession(sessionId);
        cleanup = null;
        location.hash = `#/mains/attempt/${attemptId}`;
      },
    }, 'Save précis')))));
}

export async function counter(host) {
  document.body.classList.add('focus');
  const sessionId = await session('mains');
  const timer = countdown({ ms: 5 * 60000, warnAt: 60000 });
  onLeave(() => { timer.stop(); endSession(sessionId); });
  const claim = wordArea({ rows: 2, placeholder: 'The claim (type or paste one)', label: 'Claim' });
  const ctr = wordArea({ rows: 3, placeholder: 'The strongest counter-argument', label: 'Counter-argument', mic: true });
  const reb = wordArea({ rows: 3, placeholder: 'Your rebuttal', label: 'Rebuttal', mic: true });
  clear(host).append(h('div', { class: 'rv mains-flow' }, head('Counter-arguments', timer.el),
    h('div', { class: 'rv-body' }, h('p', { class: 'small muted', text: 'Claim → the strongest counter you can build → a rebuttal that meets it head-on.' }), claim.el, ctr.el, reb.el),
    h('div', { class: 'rv-foot' }, h('div', { class: 'foot-row' }, h('button', {
      class: 'btn primary grow', type: 'button',
      onclick: async () => {
        if (!claim.value() || !ctr.value()) { toast('Write the claim and a counter first.', { kind: 'warn' }); return; }
        const ms = Math.round(timer.elapsed());
        timer.stop();
        const attemptId = ulid(clock.now());
        await appendEvents([['mains.counter', { attemptId, claim: claim.value(), counter: ctr.value(), rebuttal: reb.value(), ms, sessionId }], ['session.active', { sessionId, ms }]]);
        await endSession(sessionId);
        cleanup = null;
        location.hash = `#/mains/attempt/${attemptId}`;
      },
    }, 'Save')))));
}

// Compare a saved answer or sprint with its model answer: dimensions and value-add types.
export { asSkeleton };
export function compareView(attempt, model) {
  const mineDims = attempt.dims && attempt.dims.length ? attempt.dims : (attempt.headings || []).map((x) => x.h);
  const ov = dimensionOverlap(model.dimensions || [], mineDims);
  const theirVa = new Map();
  for (const v of model.valueAdds || []) { const t = normalizeValueAdd(v.type); theirVa.set(t, (theirVa.get(t) || 0) + 1); }
  const mineVa = new Set(attempt.valueAdds || (attempt.headings || []).filter((x) => x.va).map((x) => valueAddCategory({ text: x.va, answer: '' })));
  const sk = asSkeleton(model.skeleton);
  return h('section', { class: 'card compare' },
    h('h3', { text: 'Compared with the model answer' }),
    h('div', { class: 'side-by-side' },
      h('div', null, h('p', { class: 'small muted', text: 'Yours' }),
        attempt.headings ? h('ol', { class: 'small' }, attempt.headings.map((x) => h('li', null, x.h, x.va ? h('span', { class: 'muted', text: ` · ${x.va}` }) : null))) : null,
        h('p', { class: 'small' }, h('strong', { text: 'Dimensions: ' }), mineDims.length ? mineDims.join(', ') : '—')),
      h('div', null, h('p', { class: 'small muted', text: model.topper ? `${model.topper.name || 'Topper'}${model.topper.rank ? `, AIR ${model.topper.rank}` : ''}` : 'Model answer' }),
        h('ol', { class: 'small' }, sk.body.map((b) => h('li', { text: b }))),
        h('p', { class: 'small' }, h('strong', { text: 'Dimensions: ' }), (model.dimensions || []).join(', ') || '—'))),
    h('p', { class: ov.missed.length ? 'warn-text small' : 'ok-text small', text: ov.missed.length ? `Dimensions you missed: ${ov.missed.join(', ')}.` : 'You covered every dimension of the model answer.' }),
    ov.covered.length ? h('p', { class: 'small', text: `Covered: ${ov.covered.join(', ')}.${ov.extra.length ? ` Yours alone: ${ov.extra.join(', ')}.` : ''}` }) : null,
    h('table', { class: 'counts-table compact' }, h('thead', null, h('tr', null, ['Value-add type', 'Model', 'You'].map((x) => h('th', { text: x })))),
      h('tbody', null, VALUE_ADD_TYPES.filter(([id]) => theirVa.has(id) || mineVa.has(id)).map(([id, label]) => h('tr', null, h('th', { text: label }), h('td', { text: String(theirVa.get(id) || 0) }), h('td', { text: mineVa.has(id) ? '✓' : '—' }))))),
    (model.whyItScores || []).length ? h('div', null, h('p', { class: 'small muted', text: 'Why it scores' }), h('ul', { class: 'plain small' }, model.whyItScores.map((x) => h('li', { text: x })))) : null);
}
