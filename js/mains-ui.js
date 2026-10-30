// Small building blocks for the Mains Studio: a countdown, a text box with a live word
// count, chip pickers, the question picker and the dimension wheel from settings.

import { h, clear, sheet } from './ui.js';
import { app } from './store.js';
import { DEFAULT_DIMENSIONS, directiveName, mainsQuestions } from './mains.js';
import { wordCount } from './util.js';
import { dictation } from './dictate.js';

export const dimensions = () => {
  const d = app.state.settings.dimensions;
  return Array.isArray(d) && d.length ? d : DEFAULT_DIMENSIONS;
};
export const cap = (s) => String(s).charAt(0).toUpperCase() + String(s).slice(1);

const fmt = (ms) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

// A countdown that keeps time only while the page is visible. onEnd fires once at zero.
export function countdown({ ms, onEnd = () => {}, warnAt = 15000, big = false }) {
  const el = h('span', { class: `timer${big ? ' big' : ''}`, role: 'timer', 'aria-live': 'off', text: fmt(ms) });
  let left = ms;
  let last = performance.now();
  let ended = false;
  let stopped = false;
  const tick = () => {
    if (stopped) return;
    const now = performance.now();
    if (document.visibilityState === 'visible') left -= now - last;
    last = now;
    el.textContent = left >= 0 ? fmt(left) : `+${fmt(-left)}`;
    el.classList.toggle('warn', left <= warnAt && left > 0);
    el.classList.toggle('over', left <= 0);
    if (left <= 0 && !ended) {
      ended = true;
      try { if (navigator.vibrate) navigator.vibrate([200, 100, 200]); } catch (_) { /* optional */ }
      onEnd();
    }
  };
  const t = setInterval(tick, 250);
  return {
    el,
    elapsed: () => ms - left,
    left: () => left,
    stop() { stopped = true; clearInterval(t); },
  };
}

// Textarea (or input) with a live word count; cap marks it over when exceeded.
export function wordArea({ rows = 4, placeholder = '', value = '', cap: limit = null, label, single = false, mic = false }) {
  const input = single ? h('input', { type: 'text', class: 'field-input', placeholder, 'aria-label': label || placeholder, value })
    : h('textarea', { class: 'field-input', rows: String(rows), placeholder, 'aria-label': label || placeholder });
  if (!single) input.value = value;
  const counter = h('span', { class: 'counter small' });
  const update = () => {
    const n = wordCount(input.value);
    counter.textContent = limit ? `${n} / ${limit} words` : `${n} words`;
    counter.classList.toggle('over', !!limit && n > limit);
  };
  input.addEventListener('input', update);
  update();
  const tools = h('div', { class: 'field-tools' }, counter);
  if (mic) {
    const m = dictation((text) => { input.value = `${input.value ? `${input.value} ` : ''}${text}`; update(); }, { short: single });
    if (m) tools.prepend(m);
  }
  return { el: h('div', { class: 'word-area' }, input, tools), input, words: () => wordCount(input.value), value: () => input.value.trim(), update };
}

// Multi-select chips. Returns {el, value()}.
export function chipSelect(options, selected = [], { label = '' } = {}) {
  const on = new Set(selected);
  const btns = options.map(([id, text]) => {
    const b = h('button', { class: `chip-btn${on.has(id) ? ' on' : ''}`, type: 'button', 'aria-pressed': String(on.has(id)) }, text);
    b.addEventListener('click', () => {
      if (on.has(id)) on.delete(id); else on.add(id);
      b.classList.toggle('on', on.has(id));
      b.setAttribute('aria-pressed', String(on.has(id)));
    });
    return b;
  });
  return { el: h('div', { class: 'cause-chips', role: 'group', 'aria-label': label }, btns), value: () => options.map(([id]) => id).filter((id) => on.has(id)) };
}

// All Mains questions from installed content.
export async function questionPool() {
  const [pyqs, answers, ca] = await Promise.all([app.db.getAll('pyqs'), app.db.getAll('answers'), app.db.getAll('ca')]);
  return mainsQuestions({ pyqs, answers, ca, papers: app.ctx.papers });
}

// Resolves {ref, text, directive, paper, marks, …} or null. filter(q) narrows the pool.
export function pickQuestion({ title = 'Choose a question', filter = null, allowOwn = true, marks = true } = {}) {
  return new Promise(async (resolve) => {
    const pool = (await questionPool()).filter((q) => !filter || filter(q));
    let done = false;
    const finish = (v) => { if (done) return; done = true; s.close(); resolve(v); };
    const list = h('ul', { class: 'result-list' });
    const search = h('input', { type: 'search', class: 'search', placeholder: 'Search questions', 'aria-label': 'Search questions', autocomplete: 'off' });
    const draw = () => {
      clear(list);
      const q = search.value.trim().toLowerCase();
      const rows = pool.filter((x) => !q || x.text.toLowerCase().includes(q));
      for (const x of rows.slice(0, 60)) {
        list.append(h('li', null, h('button', { class: 'result', type: 'button', onclick: () => finish(x) },
          h('span', { class: 'result-label', text: x.text }),
          h('span', { class: 'result-node', text: [x.source, directiveName(x.directive), x.marks ? `${x.marks} marks` : null].filter(Boolean).join(' · ') }))));
      }
      if (!rows.length) list.append(h('li', { class: 'muted small', text: pool.length ? 'No question matches.' : 'No Mains questions installed yet: Mains PYQs (F2), topper answers (F4) and CA packs (F3) bring them. You can type your own below.' }));
    };
    search.addEventListener('input', draw);
    const own = wordArea({ rows: 3, placeholder: 'Or type your own question', label: 'Your own question' });
    const marksSel = h('select', { 'aria-label': 'Marks' }, h('option', { value: '10', text: '10 marks' }), h('option', { value: '15', text: '15 marks' }));
    const body = h('div', null, search, list,
      allowOwn ? h('div', { class: 'own-q' }, h('p', { class: 'small muted', text: 'Your own question' }), own.el, marks ? marksSel : null,
        h('button', { class: 'btn small', type: 'button', onclick: () => { const text = own.value(); if (text) finish({ ref: null, text, directive: null, paper: null, marks: Number(marksSel.value), nodes: [], dims: [], answerId: null, source: 'Your question' }); } }, 'Use my question')) : null);
    const s = sheet({ title, body, onClose: () => { if (!done) { done = true; resolve(null); } } });
    draw();
  });
}
