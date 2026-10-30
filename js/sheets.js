// Bottom sheets shared by review, learn loop and library: error cause, trap tag, atom and
// topic pickers, and quick-add.

import { h, clear, sheet, toast } from './ui.js';
import { app, allNodes, appendEvent, applyDerived } from './store.js';
import { call } from './data.js';
import { ulid } from './ulid.js';
import * as clock from './clock.js';
import { filled, makeCloze } from './cloze.js';
import { TRAP_TAGS } from './schema.js';

export const CAUSE_LIST = [
  ['didnt-know', "Didn't know", 'Never learnt it: the atom starts again as new.'],
  ['forgot', 'Forgot', 'Knew it once: a normal lapse.'],
  ['confused', 'Confused with…', 'Mixed it up with another atom: logs a confusion pair.'],
  ['misread', 'Misread', 'Read the question wrong: goes to the Trap Log.'],
  ['overthought', 'Overthought', 'Talked myself out of it: counted in calibration.'],
  ['silly', 'Silly', 'A slip: counted in calibration.'],
  ['trap', 'Trap word', 'Fell for a trap word: goes to the Trap Log.'],
];

function keyed(panel, map) {
  panel.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    const fn = map[e.key];
    if (fn) { e.preventDefault(); e.stopPropagation(); fn(); }
  });
}

// Resolves {cause, other?, trap?} or null when put off for later.
export function causeSheet({ atom, defaultTrap = null, suggestions = [] }) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (done) return; done = true; s.close(); resolve(v); };
    const choose = async (cause) => {
      if (done) return;
      if (cause === 'confused') {
        const other = await atomPicker({ title: 'Confused it with which atom?', exclude: atom ? [atom.id] : [], suggestions });
        if (other) finish({ cause, other: other.id });
        return;
      }
      if (cause === 'misread' || cause === 'trap') {
        const trap = await trapPicker(defaultTrap);
        finish({ cause, trap: trap || null });
        return;
      }
      finish({ cause });
    };
    const body = h('div', { class: 'cause-grid' },
      h('p', { class: 'small muted', text: 'One tap: what made you miss it? (keys 1–7)' }),
      CAUSE_LIST.map(([id, label, help], i) => h('button', { class: 'cause-btn', type: 'button', onclick: () => choose(id) },
        h('span', { class: 'opt-key', text: String(i + 1) }), h('span', null, h('strong', { text: label }), h('span', { class: 'small muted block', text: help })))));
    const s = sheet({ title: 'Why the miss?', body, onClose: () => { if (!done) { done = true; resolve(null); } }, actions: [{ label: 'Decide later', onClick: () => finish(null) }] });
    const map = {};
    CAUSE_LIST.forEach(([id], i) => { map[String(i + 1)] = () => choose(id); });
    keyed(s.el, map);
    const first = s.el.querySelector('.cause-btn');
    if (first) first.focus();
  });
}

export function trapPicker(defaultTrap) {
  return new Promise((resolve) => {
    let done = false;
    const pick = (t) => { if (done) return; done = true; s.close(); resolve(t); };
    const body = h('div', { class: 'cause-grid' },
      h('p', { class: 'small muted', text: 'Which trap caught you?' }),
      TRAP_TAGS.map((t, i) => h('button', { class: `cause-btn${t === defaultTrap ? ' suggested' : ''}`, type: 'button', onclick: () => pick(t) },
        h('span', { class: 'opt-key', text: String(i + 1) }), h('strong', { text: t.replace(/-/g, ' ') }))),
      h('button', { class: 'cause-btn', type: 'button', onclick: () => pick(null) }, h('span', { class: 'opt-key', text: '0' }), h('strong', { text: 'Not sure' })));
    const s = sheet({ title: 'Trap tag', body, onClose: () => { if (!done) { done = true; resolve(defaultTrap || null); } } });
    const map = { 0: () => pick(null) };
    TRAP_TAGS.forEach((t, i) => { map[String(i + 1)] = () => pick(t); });
    keyed(s.el, map);
  });
}

const atomLabel = (a) => filled(a);

// Resolves the chosen atom or null.
export function atomPicker({ title, exclude = [], suggestions = [] }) {
  return new Promise((resolve) => {
    let done = false;
    const pick = async (id) => {
      if (done) return;
      const a = await app.db.get('atoms', id);
      if (!a) return;
      done = true;
      s.close();
      resolve(a);
    };
    const list = h('ul', { class: 'result-list' });
    const draw = (rows) => {
      clear(list);
      const shown = rows.filter((r) => !exclude.includes(r.id));
      if (!shown.length) { list.append(h('li', { class: 'muted small', text: 'No atoms found.' })); return; }
      for (const r of shown.slice(0, 30)) list.append(h('li', null, h('button', { class: 'result', type: 'button', onclick: () => pick(r.id) }, h('span', { class: 'result-label', text: r.label }))));
    };
    const input = h('input', { type: 'search', class: 'search', placeholder: 'Search atoms', 'aria-label': 'Search atoms', autocomplete: 'off' });
    let seq = 0;
    input.addEventListener('input', async () => {
      const my = ++seq;
      const q = input.value.trim();
      if (!q) { draw(suggestions.map((a) => ({ id: a.id, label: atomLabel(a) }))); return; }
      const hits = await call('search', { q, kinds: ['atom'], limit: 30 });
      if (my === seq) draw(hits.map((x) => ({ id: x.refId, label: x.label })));
    });
    const s = sheet({ title, body: h('div', null, input, suggestions.length ? h('p', { class: 'small muted', text: 'Likely candidates:' }) : null, list), onClose: () => { if (!done) { done = true; resolve(null); } } });
    draw(suggestions.map((a) => ({ id: a.id, label: atomLabel(a) })));
    input.focus();
  });
}

// Resolves a node id or null.
export function nodePicker({ title = 'Choose a topic', suggestions = [] } = {}) {
  return new Promise((resolve) => {
    let done = false;
    const nodes = allNodes();
    const pick = (id) => { if (done) return; done = true; s.close(); resolve(id); };
    const list = h('ul', { class: 'result-list' });
    const draw = (ids) => {
      clear(list);
      if (!ids.length) { list.append(h('li', { class: 'muted small', text: 'No topics found.' })); return; }
      for (const id of ids.slice(0, 30)) {
        const n = nodes.get(id);
        if (!n) continue;
        list.append(h('li', null, h('button', { class: 'result', type: 'button', onclick: () => pick(id) }, h('span', { class: 'result-label', text: n.title }), h('span', { class: 'result-node', text: id }))));
      }
    };
    const input = h('input', { type: 'search', class: 'search', placeholder: 'Search topics', 'aria-label': 'Search topics', autocomplete: 'off' });
    let seq = 0;
    input.addEventListener('input', async () => {
      const my = ++seq;
      const q = input.value.trim();
      if (!q) { draw(suggestions); return; }
      const hits = await call('search', { q, kinds: ['node'], limit: 30 });
      if (my === seq) draw(hits.map((x) => x.refId));
    });
    const s = sheet({ title, body: h('div', null, input, list), onClose: () => { if (!done) { done = true; resolve(null); } } });
    draw(suggestions);
    input.focus();
  });
}

// Quick add: front, back, topic and optional source/page. Resolves the new atom or null.
// prefill: {text, answer, nodeId, sourceId, sourceTitle, page}
export function quickAdd(prefill = {}) {
  return new Promise((resolve) => {
    let done = false;
    let nodeId = prefill.nodeId || null;
    const nodes = allNodes();
    const front = h('textarea', { rows: '3', class: 'field-input', 'aria-label': 'Front', placeholder: 'Front: a statement with ___ for the gap, or a question' });
    front.value = prefill.text || '';
    const back = h('input', { type: 'text', class: 'field-input', 'aria-label': 'Back', placeholder: 'Back: the answer' });
    back.value = prefill.answer || '';
    const nodeBtn = h('button', { class: 'btn', type: 'button' });
    const drawNode = () => { nodeBtn.textContent = nodeId && nodes.get(nodeId) ? nodes.get(nodeId).title : 'Choose a topic…'; };
    drawNode();
    nodeBtn.addEventListener('click', async () => {
      const picked = await nodePicker({ title: 'Topic for this atom', suggestions: prefill.nodeSuggestions || [] });
      if (picked) { nodeId = picked; drawNode(); }
      s.el.querySelector('textarea').focus();
    });
    const srcTitle = h('input', { type: 'text', class: 'field-input', 'aria-label': 'Source', placeholder: 'Source (optional), e.g. Laxmikanth 7th ed.' });
    srcTitle.value = prefill.sourceTitle || '';
    if (prefill.sourceId) srcTitle.readOnly = true;
    const page = h('input', { type: 'text', inputmode: 'numeric', class: 'field-input short', 'aria-label': 'Page', placeholder: 'Page' });
    page.value = prefill.page ? String(prefill.page) : '';
    const err = h('p', { class: 'small warn-text', hidden: true });
    // Suggested gaps (numbers, years, Article numbers, names): one tap makes the cloze.
    const chips = (prefill.targets || []).length ? h('div', { class: 'field' },
      h('span', { text: 'Make a gap' }),
      h('div', { class: 'chips' }, prefill.targets.map((t) => h('button', {
        class: 'chip', type: 'button',
        onclick: () => {
          const base = front.value.includes('___') ? front.value.replace(/_{3,}/, back.value || '___') : front.value;
          const c = makeCloze(base, t.text);
          if (!c) { toast(`"${t.text}" is not in the front text any more.`, { kind: 'warn' }); return; }
          front.value = c;
          back.value = t.text;
        },
      }, t.text)))) : null;
    const save = async () => {
      const text = front.value.trim();
      const answer = back.value.trim();
      const problems = [];
      if (!text) problems.push('write the front');
      if (!answer) problems.push('write the answer');
      if (!nodeId) problems.push('choose a topic');
      if (problems.length) { err.hidden = false; err.textContent = `Please ${problems.join(', ')}.`; return; }
      const pg = page.value.trim();
      const source = prefill.sourceId
        ? { sourceId: prefill.sourceId, page: Number(pg) || pg || undefined }
        : srcTitle.value.trim() ? { title: srcTitle.value.trim(), page: Number(pg) || pg || undefined } : { title: 'Added by me' };
      const atom = { id: `self.${ulid(clock.now())}`, type: prefill.type || 'fact', text, answer, nodes: [nodeId], source, origin: 'self', verify: false, stage: ['prelims', 'mains'] };
      done = true;
      s.setActions([{ label: 'Saving…', disabled: true }]);
      try {
        await appendEvent('atom.created', { atom });
        await applyDerived(await call('refresh'));
        s.close();
        toast('Added. It is in today’s queue.', { kind: 'ok' });
        resolve(atom);
      } catch (e) {
        s.close();
        toast(`Could not save: ${e.message}`, { kind: 'error' });
        resolve(null);
      }
    };
    const s = sheet({
      title: prefill.title || 'Quick add',
      body: h('div', { class: 'form' },
        h('label', { class: 'field' }, h('span', { text: 'Front' }), front),
        chips,
        h('label', { class: 'field' }, h('span', { text: 'Back' }), back),
        h('div', { class: 'field' }, h('span', { text: 'Topic' }), nodeBtn),
        h('div', { class: 'field-row' },
          h('label', { class: 'field grow' }, h('span', { text: 'Source' }), srcTitle),
          h('label', { class: 'field' }, h('span', { text: 'Page' }), page)),
        err),
      onClose: () => { if (!done) { done = true; resolve(null); } },
      actions: [{ label: 'Cancel', onClick: () => s.close() }, { label: 'Add atom', kind: 'primary', onClick: save }],
    });
    front.focus();
  });
}
