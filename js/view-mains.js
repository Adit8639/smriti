// Mains Studio. #/mains?tab=write|toolkit|valueadds|history, the flows under
// #/mains/<flow> (see mains-flows.js) and saved attempts at #/mains/attempt/<id>.

import { h, add, clear, toast } from './ui.js';
import { app, activeProfile, allNodes, appendEvents, emit } from './store.js';
import { DIRECTIVES, DEFAULT_DIMENSIONS, VALUE_ADD_TYPES, VALUE_ADD_LABEL, valueAddCategory, normalizeValueAdd, RUBRIC, skeletonDiff, directiveName, bestModelAnswer, precisCheck } from './mains.js';
import { dimensions, cap } from './mains-ui.js';
import * as flows from './mains-flows.js';
import { quarantineStatus } from './rebuild.js';
import { filled } from './cloze.js';
import { formatDateTime, plural } from './util.js';

const TABS = [['write', 'Write'], ['toolkit', 'Toolkit'], ['valueadds', 'Value-adds'], ['history', 'History']];
const KIND = { sprint: 'Skeleton sprint', answer: 'Timed answer', shadow: 'Shadow Writing', case: 'GS-IV case', essay: 'Essay', precis: 'Précis', counter: 'Counter-arguments' };

export function leave() { flows.leaveFlow(); }

export async function render(route) {
  const arg = route.arg || '';
  const host = h('div', { class: 'mains-host' });
  const q = route.query;
  const run = (fn) => { setTimeout(() => fn().catch((e) => { toast(`Something went wrong: ${e.message}`, { kind: 'error' }); console.error(e); }), 0); return host; };
  if (arg === 'sprint') return run(() => flows.sprint(host, { refs: (q.get('refs') || '').split(',').filter(Boolean), n: Number(q.get('n')) || 5 }));
  if (arg === 'answer') return run(() => flows.timedAnswer(host, { ref: q.get('ref'), marks: Number(q.get('marks')) || null }));
  if (arg.startsWith('shadow/')) return run(() => flows.shadow(host, { answerId: arg.slice(7), drill: q.has('drill') ? Number(q.get('drill')) : null }));
  if (arg === 'drill') return run(() => flows.directiveDrill(host, {}));
  if (arg === 'case') return run(() => flows.caseMode(host, { ref: q.get('ref') }));
  if (arg === 'essay') return run(() => flows.essayMode(host, { ref: q.get('ref') }));
  if (arg === 'precis') return run(() => flows.precis(host));
  if (arg === 'counter') return run(() => flows.counter(host));
  if (arg.startsWith('attempt/')) return attemptView(arg.slice(8));
  const tab = TABS.some(([id]) => id === q.get('tab')) ? q.get('tab') : 'write';
  const body = h('div', { class: 'lab-body' });
  const root = h('div', { class: 'mains' },
    h('nav', { class: 'tabs', 'aria-label': 'Mains Studio sections' }, TABS.map(([id, label]) => h('a', { class: `tab${id === tab ? ' active' : ''}`, href: `#/mains?tab=${id}`, 'aria-current': id === tab ? 'page' : null }, label))),
    body);
  await ({ write: writeTab, toolkit: toolkitTab, valueadds: valueTab, history: historyTab }[tab])(body);
  return root;
}

// ------------------------------------------------------------------ write
async function writeTab(body) {
  const answers = await app.db.getAll('answers');
  const c = app.state.mains.counts;
  const capf = activeProfile() && activeProfile().exam === 'capf-ac';
  const nSel = h('select', { 'aria-label': 'Questions in the sprint' }, [3, 5, 10].map((n) => h('option', { value: String(n), text: `${n} questions × 90 s`, selected: n === 5 ? true : null })));
  const card = (title, text, action, extra = null, count = 0) => h('section', { class: 'card lab-card' },
    h('div', { class: 'row-between' }, h('h2', { text: title }), count ? h('span', { class: 'badge', text: `${count} done` }) : null),
    h('p', { class: 'small muted', text }), extra, action);
  add(body,
    card('Skeleton Sprint', 'Questions back to back, 90 seconds each: an intro line, 4–6 dimension headings with one value-add each, and a way forward. Typed or dictated.',
      h('button', { class: 'btn primary', type: 'button', onclick: () => { location.hash = `#/mains/sprint?n=${nSel.value}`; } }, 'Start a sprint'), nSel, c.sprint),
    card('Timed answer', 'Write on paper against the clock (10 marks: 7 min, 150 words; 15 marks: 11 min, 250 words), photograph it, then self-score six lines of the rubric and compare with a model answer.',
      h('a', { class: 'btn primary', href: '#/mains/answer' }, 'Choose a question'), null, c.answer),
    card('Shadow Writing', 'Read a topper answer for two minutes; it hides; rebuild its skeleton from memory; see what you kept and what you dropped.',
      answers.length ? h('ul', { class: 'plain shadow-list' }, answers.slice(0, 30).map((a) => h('li', null,
        h('a', { class: 'btn small', href: `#/mains/shadow/${encodeURIComponent(a.id)}` }, 'Shadow'),
        (a.drills || []).map((_, i) => h('a', { class: 'btn small', href: `#/mains/shadow/${encodeURIComponent(a.id)}?drill=${i}` }, `Drill ${i + 1}`)),
        h('span', { class: 'small', text: ` ${a.question}` }))))
        : h('p', { class: 'small muted', text: 'Model answers arrive with topper packs (Forge F4). The demo pack has one.' }), null, c.shadow),
    card('GS-IV case (15 min)', 'Stakeholders → values in conflict → options with pros and cons → your course, justified.', h('a', { class: 'btn', href: '#/mains/case' }, 'Start a case'), null, c.case),
    card('Essay', 'A theme, a 15-minute brainstorm map along the dimension wheel, a 10-minute outline sprint, then intro and conclusion drafts, with your quote bank to hand.', h('a', { class: 'btn', href: '#/mains/essay' }, 'Start an essay'), null, c.essay),
    capf ? card('Précis (CAPF)', 'The one-third rule with a live word counter.', h('a', { class: 'btn', href: '#/mains/precis' }, 'Write a précis'), null, c.precis) : null,
    capf ? card('Counter-arguments (CAPF)', 'Claim → strongest counter → rebuttal, in five minutes.', h('a', { class: 'btn', href: '#/mains/counter' }, 'Start a drill'), null, c.counter) : null,
    !capf ? h('details', { class: 'card' }, h('summary', null, h('strong', { text: 'CAPF Paper II drills' })), h('p', { class: 'small muted', text: 'Précis with the one-third rule, and counter-argument drills.' }),
      h('div', { class: 'button-row' }, h('a', { class: 'btn small', href: '#/mains/precis' }, 'Précis'), h('a', { class: 'btn small', href: '#/mains/counter' }, 'Counter-arguments'))) : null);
}

// ------------------------------------------------------------------ toolkit
async function toolkitTab(body) {
  const dims = dimensions();
  const list = h('div', { class: 'chips' });
  const save = async (next) => { await appendEvents([['settings.set', { key: 'dimensions', value: next }]]); emit('rerender'); };
  for (const d of dims) list.append(h('span', { class: 'chip' }, cap(d), h('button', { class: 'chip-x', type: 'button', 'aria-label': `Remove ${d}`, onclick: () => { if (dims.length <= 3) { toast('Keep at least three dimensions.', { kind: 'warn' }); return; } save(dims.filter((x) => x !== d)); } }, '×')));
  const add = h('input', { type: 'text', class: 'field-input', placeholder: 'Add a dimension', 'aria-label': 'Add a dimension' });
  body.append(
    h('section', { class: 'card' },
      h('h2', { text: 'Directive decoder' }),
      h('p', { class: 'small muted', text: 'What each directive asks, the structure it expects, and the one check your answer must pass.' }),
      h('a', { class: 'btn primary', href: '#/mains/drill' }, 'Drill: which directive is this answer obeying?'),
      app.state.mains.drill.n ? h('p', { class: 'small muted', text: `Drill so far: ${app.state.mains.drill.right} of ${app.state.mains.drill.n} right.` }) : null),
    h('div', { class: 'directive-grid' }, DIRECTIVES.map((d) => h('section', { class: 'card directive' },
      h('h3', { text: d.name }), h('p', { class: 'small', text: d.asks }),
      h('ol', { class: 'small' }, d.structure.map((x) => h('li', { text: x }))),
      h('p', { class: 'small check-line' }, h('strong', { text: 'Check: ' }), d.check)))),
    h('section', { class: 'card' },
      h('h2', { text: 'Dimension wheel' }),
      h('p', { class: 'small muted', text: 'Used by sprints, the essay brainstorm and the compare view. Edit it to match how you think; it syncs with your backup.' }),
      list,
      h('div', { class: 'field-row' }, h('div', { class: 'grow' }, add),
        h('button', { class: 'btn', type: 'button', onclick: () => { const v = add.value.trim().toLowerCase(); if (!v) return; if (dims.includes(v)) { toast('Already on the wheel.'); return; } save([...dims, v]); } }, 'Add'),
        h('button', { class: 'btn', type: 'button', onclick: () => save(DEFAULT_DIMENSIONS.slice()) }, 'Reset to the 12'))));
}

// ------------------------------------------------------------------ value-add bank
async function valueTab(body) {
  const nodes = allNodes();
  const atoms = (await app.db.getAll('atoms')).filter((a) => a.type === 'valueadd' && (() => { const q = quarantineStatus(a, app.state); return q === 'clear' || q === 'approved'; })());
  const answers = await app.db.getAll('answers');
  const byCat = new Map(VALUE_ADD_TYPES.map(([id]) => [id, []]));
  for (const a of atoms) byCat.get(valueAddCategory(a)).push(a);
  const fromAnswers = [];
  for (const a of answers) for (const v of a.valueAdds || []) fromAnswers.push({ type: normalizeValueAdd(v.type), text: v.text, question: a.question });
  const ids = atoms.map((a) => a.id);
  body.append(h('section', { class: 'card' },
    h('h2', { text: 'Value-add bank' }),
    h('p', { class: 'small muted', text: 'Articles, judgments, committees, reports and indices, data with year, schemes, examples, quotes and diagram ideas: each one an atom you can drill. Topic pages show their own bank.' }),
    atoms.length ? h('a', { class: 'btn primary', href: `#/practice/atoms?mode=practice&ids=${ids.slice(0, 60).map(encodeURIComponent).join(',')}` }, `Drill ${Math.min(60, ids.length)} value-adds`) : h('p', { class: 'muted', text: 'No value-add atoms yet: packs mark them with type "valueadd" (the mains layer of F1 and F3).' })));
  for (const [id, label] of VALUE_ADD_TYPES) {
    const list = byCat.get(id);
    const extra = fromAnswers.filter((x) => x.type === id);
    if (!list.length && !extra.length) continue;
    body.append(h('section', { class: 'card' }, h('h3', { text: `${label} (${list.length + extra.length})` }),
      h('ul', { class: 'plain small va-list' },
        list.slice(0, 40).map((a) => h('li', null, filled(a), h('span', { class: 'muted', text: ` · ${(nodes.get((a.nodes || [])[0]) || {}).title || ''}` }))),
        extra.slice(0, 20).map((x) => h('li', null, x.text, h('span', { class: 'muted', text: ' · from a model answer' }))))));
  }
}

// ------------------------------------------------------------------ history
async function historyTab(body) {
  const list = Object.entries(app.state.mains.attempts).map(([id, a]) => ({ id, ...a })).sort((a, b) => b.ts - a.ts);
  if (!list.length) { body.append(h('p', { class: 'muted', text: 'No attempts yet. Every sprint, answer, shadow, case, essay and drill you save shows up here.' })); return; }
  body.append(h('div', { class: 'stack' }, list.slice(0, 100).map((a) => h('a', { class: 'card item', href: `#/mains/attempt/${a.id}`, 'data-nav': '' },
    h('div', { class: 'row-between' }, h('span', { class: 'badge', text: KIND[a.kind] || a.kind }),
      a.kind === 'answer' ? h('span', { class: 'badge muted', text: `${a.total} / 12` }) : a.kind === 'shadow' && a.score !== null ? h('span', { class: 'badge muted', text: `${Math.round(a.score * 100)}% recalled` }) : null),
    h('span', { text: a.title || '(untitled)' }),
    h('span', { class: 'small muted', text: formatDateTime(a.ts) })))));
}

// ------------------------------------------------------------------ one attempt
async function attemptView(id) {
  const a = app.state.mains.attempts[id];
  const e = a && a.eventId ? await app.db.get('events', a.eventId) : null;
  if (!a || !e) return h('div', { class: 'card' }, h('p', { text: 'This attempt is not on this device yet (sync a backup), or it does not exist.' }), h('a', { class: 'btn', href: '#/mains?tab=history' }, 'History'));
  const p = e.payload;
  const root = h('div', { class: 'mains-attempt' }, h('nav', { class: 'crumbs' }, h('a', { href: '#/mains?tab=history' }, 'Mains Studio'), ' / ', KIND[a.kind]));
  const answers = await app.db.getAll('answers');
  const qText = (p.q && p.q.text) || p.theme || p.claim || '';
  if (qText) root.append(h('section', { class: 'card' }, h('p', { class: 'question', text: qText }), h('p', { class: 'small muted', text: `${formatDateTime(e.ts)}${p.ms ? ` · ${Math.round(p.ms / 60000 * 10) / 10} min` : ''}${p.q && p.q.directive ? ` · ${directiveName(p.q.directive)}` : ''}` })));
  if (a.kind === 'sprint') {
    root.append(h('section', { class: 'card' }, h('p', null, h('strong', { text: 'Intro: ' }), p.intro || '—'),
      h('ol', null, (p.headings || []).map((x) => h('li', null, x.h, x.va ? h('span', { class: 'muted', text: ` · ${x.va}` }) : null))),
      h('p', null, h('strong', { text: 'Way forward: ' }), p.wayForward || '—'),
      h('p', { class: 'small muted', text: `${Math.round((p.ms || 0) / 1000)} s of ${Math.round((p.limitMs || 90000) / 1000)} s${p.auto ? ' (saved when time ran out)' : ''}` })));
    const model = bestModelAnswer(p.q || {}, answers);
    if (model) root.append(flows.compareView(p, model));
  } else if (a.kind === 'answer') {
    const photos = h('div', { class: 'photo-row' });
    for (const pid of p.photoIds || []) {
      const rec = await app.db.get('sources', pid);
      if (rec && rec.blob) photos.append(h('img', { class: 'answer-photo', src: URL.createObjectURL(rec.blob), alt: 'Your answer' }));
      else photos.append(h('p', { class: 'small muted', text: 'Photo kept on the device that took it.' }));
    }
    root.append(h('section', { class: 'card' },
      h('p', { class: 'big-number' }, h('strong', { text: `${p.total}` }), ' / 12'),
      h('p', { class: 'small', text: `Written in ${Math.round((p.writeMs || 0) / 60000 * 10) / 10} of ${Math.round((p.limitMs || 0) / 60000)} minutes${p.words ? ` · about ${p.words} words` : ''}.` }),
      h('table', { class: 'counts-table compact' }, h('tbody', null, RUBRIC.map(([k, label, levels]) => h('tr', null, h('th', { text: label }), h('td', { text: `${p.rubric[k]} / 2` }), h('td', { class: 'small muted', text: levels[p.rubric[k]] || '' }))))),
      (p.dims || []).length ? h('p', { class: 'small' }, h('strong', { text: 'Dimensions: ' }), p.dims.map(cap).join(', ')) : null,
      (p.valueAdds || []).length ? h('p', { class: 'small' }, h('strong', { text: 'Value-adds: ' }), p.valueAdds.map((v) => VALUE_ADD_LABEL[v] || v).join(', ')) : null,
      (p.photoIds || []).length ? photos : null));
    const model = p.modelId ? answers.find((x) => x.id === p.modelId) : bestModelAnswer(p.q || {}, answers);
    if (model) root.append(flows.compareView(p, model));
    if (p.q && p.q.ref) root.append(h('a', { class: 'btn', href: `#/mains/answer?ref=${encodeURIComponent(p.q.ref)}` }, 'Write it again'));
  } else if (a.kind === 'shadow') {
    const model = answers.find((x) => x.id === p.answerId);
    const base = model ? (Number.isInteger(p.drill) && model.drills && model.drills[p.drill] ? flows.asSkeleton(model.drills[p.drill].hiddenSkeleton) : flows.asSkeleton(model.skeleton)) : null;
    if (base) {
      const d = skeletonDiff(base, p.rebuilt || {});
      root.append(h('section', { class: 'card' },
        h('p', { class: 'big-number' }, h('strong', { text: `${Math.round(d.score * 100)}%` }), ' of the body headings recalled'),
        h('p', { class: 'small', text: `Intro ${Math.round(d.intro * 100)}% and conclusion ${Math.round(d.conclusion * 100)}% of the key words.` }),
        h('h3', { text: 'Recalled' }), d.matched.length ? h('ul', { class: 'plain small diff-ok' }, d.matched.map((m) => h('li', null, `✓ ${m.model}`, h('span', { class: 'muted', text: ` (you: ${m.mine})` })))) : h('p', { class: 'small muted', text: 'None.' }),
        h('h3', { text: 'Dropped' }), d.missed.length ? h('ul', { class: 'plain small diff-miss' }, d.missed.map((m) => h('li', { text: `✗ ${m}` }))) : h('p', { class: 'small ok-text', text: 'Nothing dropped.' }),
        d.extra.length ? [h('h3', { text: 'Yours, not in the model' }), h('ul', { class: 'plain small' }, d.extra.map((m) => h('li', { text: m })))] : null),
        h('a', { class: 'btn', href: `#/mains/shadow/${encodeURIComponent(p.answerId)}${Number.isInteger(p.drill) ? `?drill=${p.drill}` : ''}` }, 'Shadow it again'));
    }
  } else if (a.kind === 'case') {
    root.append(h('section', { class: 'card' },
      h('h3', { text: 'Stakeholders' }), h('ul', { class: 'plain small' }, (p.stakeholders || []).map((x) => h('li', { text: x }))),
      h('h3', { text: 'Values in conflict' }), h('ul', { class: 'plain small' }, (p.values || []).map((x) => h('li', { text: x }))),
      h('h3', { text: 'Options' }), h('ol', { class: 'small' }, (p.options || []).map((o, i) => h('li', { class: i === p.choice ? 'correct' : '' }, h('strong', { text: o.text }), o.pros ? ` · pros: ${o.pros}` : '', o.cons ? ` · cons: ${o.cons}` : ''))),
      h('h3', { text: 'Course and justification' }), h('p', { class: 'pre', text: p.justification })));
  } else if (a.kind === 'essay') {
    root.append(h('section', { class: 'card' },
      h('h3', { text: 'Brainstorm' }), h('p', { class: 'pre small', text: p.brainstorm || '—' }),
      h('h3', { text: 'Outline' }), h('p', { class: 'small' }, h('strong', { text: 'Intro: ' }), (p.outline && p.outline.intro) || '—'), h('ol', { class: 'small' }, ((p.outline && p.outline.body) || []).map((b) => h('li', { text: b }))), h('p', { class: 'small' }, h('strong', { text: 'Conclusion: ' }), (p.outline && p.outline.conclusion) || '—'),
      h('h3', { text: 'Introduction draft' }), h('p', { class: 'pre', text: p.introDraft || '—' }),
      h('h3', { text: 'Conclusion draft' }), h('p', { class: 'pre', text: p.conclusionDraft || '—' })));
  } else if (a.kind === 'precis') {
    const c = precisCheck(p.passage || '', p.text || '');
    root.append(h('section', { class: 'card' }, h('p', { class: c.ok ? 'ok-text' : 'warn-text', text: `${c.words} words against a target of ${c.target}${c.ok ? ': within 10%.' : '.'}` }),
      h('h3', { text: 'Your précis' }), h('p', { class: 'pre', text: p.text }), h('details', null, h('summary', { text: 'The passage' }), h('p', { class: 'pre small', text: p.passage }))));
  } else if (a.kind === 'counter') {
    root.append(h('section', { class: 'card' }, h('h3', { text: 'Claim' }), h('p', { text: p.claim }), h('h3', { text: 'Strongest counter' }), h('p', { class: 'pre', text: p.counter }), h('h3', { text: 'Rebuttal' }), h('p', { class: 'pre', text: p.rebuttal || '—' })));
  }
  return root;
}
