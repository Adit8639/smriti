// Probe renderers for every format, touch and keyboard. mountProbe() draws the prompt and
// answer controls and returns a controller: ready(), response(), reveal(), key().

import { h, clear } from './ui.js';
import { shuffled, hasGap } from './probes.js';

const LETTERS = ['a', 'b', 'c', 'd'];

function gapNodes(text) {
  return String(text).split(/(_{3,})/).map((p) => (/^_{3,}$/.test(p) ? h('span', { class: 'gap', 'aria-label': 'blank' }, '____') : p));
}

function prompt(probe) {
  return h('div', { class: 'pv-stem pre' }, gapNodes(probe.stem));
}

// ---- multiple choice ----------------------------------------------------------------
function optionsBlock(probe, st, notify, disabledFn) {
  const btns = probe.options.map((o, i) => h('button', {
    class: 'opt', type: 'button', 'data-nav': '', 'aria-pressed': 'false',
    onclick: () => {
      if (st.revealed || (disabledFn && disabledFn())) return;
      st.choice = i;
      btns.forEach((b, j) => b.setAttribute('aria-pressed', String(j === i)));
      notify();
    },
  }, h('span', { class: 'opt-key', text: `(${LETTERS[i]})` }), h('span', { class: 'opt-text', text: o })));
  const box = h('div', { class: 'opts', role: 'group', 'aria-label': 'Options' }, btns);
  return {
    el: box,
    btns,
    reveal() {
      btns.forEach((b, j) => {
        b.disabled = true;
        if (j === probe.answer) b.classList.add('right');
        else if (j === st.choice) b.classList.add('wrong');
      });
    },
    pick(i) { if (btns[i]) btns[i].click(); },
    setDisabled(v) { btns.forEach((b) => { b.disabled = v; }); },
  };
}

// ---- true / false marking -------------------------------------------------------------
function statementsBlock(statements, st, notify, { labels = true } = {}) {
  st.marks = st.marks || statements.map(() => undefined);
  const rows = statements.map((s, i) => {
    const set = (v) => {
      if (st.revealed) return;
      st.marks[i] = v;
      t.setAttribute('aria-pressed', String(v === true));
      f.setAttribute('aria-pressed', String(v === false));
      notify();
    };
    const t = h('button', { class: 'tf t', type: 'button', 'aria-pressed': 'false', 'aria-label': `Statement ${i + 1} true`, onclick: () => set(true) }, 'True');
    const f = h('button', { class: 'tf f', type: 'button', 'aria-pressed': 'false', 'aria-label': `Statement ${i + 1} false`, onclick: () => set(false) }, 'False');
    const why = h('p', { class: 'stmt-why small', hidden: true });
    const row = h('div', { class: 'stmt', 'data-nav': '', tabindex: '0' },
      h('p', { class: 'stmt-text' }, labels ? h('strong', { text: `${i + 1}. ` }) : null, s.text.replace(/^Statement-(I|II):\s*/, (m) => m)),
      h('div', { class: 'tf-row' }, t, f), why);
    return { row, set, why, t, f };
  });
  return {
    el: h('div', { class: 'stmts' }, rows.map((r) => r.row)),
    rows,
    done: () => st.marks.every((m) => m !== undefined),
    markNext(v) {
      const i = st.marks.findIndex((m) => m === undefined);
      if (i >= 0) rows[i].set(v);
    },
    reveal() {
      rows.forEach((r, i) => {
        const s = statements[i];
        r.t.disabled = true;
        r.f.disabled = true;
        const ok = st.marks[i] === s.true;
        r.row.classList.add(ok ? 'right' : 'wrong');
        r.why.hidden = false;
        r.why.textContent = `${s.true ? 'True' : `False${s.trap ? ` (trap: ${s.trap})` : ''}`}. ${s.reason || ''}`;
      });
    },
  };
}

// ---- tap to pair ------------------------------------------------------------------------
function pairBlock(probe, st, notify, seed) {
  const n = probe.pairs.length;
  const order = shuffled(n, seed);              // display position -> original right index
  st.pairing = st.pairing || Array(n).fill(null); // left i -> original right index
  let sel = null;                                 // selected left index
  const leftBtns = probe.pairs.map((p, i) => h('button', {
    class: 'pair-l', type: 'button', 'data-nav': '',
    onclick: () => {
      if (st.revealed) return;
      if (st.pairing[i] !== null) { st.pairing[i] = null; sel = null; draw(); notify(); return; }
      sel = sel === i ? null : i;
      draw();
    },
  }));
  const rightBtns = order.map((j, pos) => h('button', {
    class: 'pair-r', type: 'button', 'data-nav': '',
    onclick: () => {
      if (st.revealed) return;
      const left = sel !== null ? sel : st.pairing.findIndex((x) => x === null);
      if (left < 0) return;
      const prev = st.pairing.indexOf(j);
      if (prev >= 0) st.pairing[prev] = null;
      st.pairing[left] = j;
      sel = null;
      draw();
      notify();
    },
  }));
  const label = (j) => String(order.indexOf(j) + 1);
  function draw() {
    leftBtns.forEach((b, i) => {
      clear(b).append(h('span', { class: 'opt-key', text: String.fromCharCode(65 + i) }), h('span', { class: 'opt-text' }, gapNodes(probe.pairs[i][0])),
        h('span', { class: 'pair-link', text: st.pairing[i] !== null ? `→ ${label(st.pairing[i])}` : '' }));
      b.classList.toggle('selected', sel === i);
      b.setAttribute('aria-pressed', String(sel === i));
    });
    rightBtns.forEach((b, pos) => {
      const j = order[pos];
      const owner = st.pairing.indexOf(j);
      clear(b).append(h('span', { class: 'opt-key', text: String(pos + 1) }), h('span', { class: 'opt-text', text: probe.pairs[j][1] }),
        h('span', { class: 'pair-link', text: owner >= 0 ? `← ${String.fromCharCode(65 + owner)}` : '' }));
      b.classList.toggle('used', owner >= 0);
    });
  }
  draw();
  return {
    el: h('div', { class: 'pairs' },
      h('div', { class: 'pair-col' }, h('p', { class: 'small muted', text: 'Tap an item, then its match' }), leftBtns),
      h('div', { class: 'pair-col' }, rightBtns)),
    done: () => st.pairing.every((x) => x !== null),
    reveal() {
      leftBtns.forEach((b, i) => {
        b.disabled = true;
        const ok = st.pairing[i] === i;
        b.classList.add(ok ? 'right' : 'wrong');
        if (!ok) b.append(h('span', { class: 'pair-fix small', text: ` correct: ${probe.pairs[i][1]}` }));
      });
      rightBtns.forEach((b) => { b.disabled = true; });
    },
    keyPick(k) {
      if (/^[1-9]$/.test(k) && rightBtns[Number(k) - 1]) { rightBtns[Number(k) - 1].click(); return true; }
      const li = k.toUpperCase().charCodeAt(0) - 65;
      if (/^[a-z]$/i.test(k) && leftBtns[li]) { leftBtns[li].click(); return true; }
      return false;
    },
  };
}

// ---- tap to order -----------------------------------------------------------------------
function orderBlock(probe, st, notify, seed) {
  const n = probe.items.length;
  const show = shuffled(n, seed);
  st.order = st.order || [];
  const placed = h('ol', { class: 'order-placed' });
  const btns = show.map((orig) => h('button', {
    class: 'order-item', type: 'button', 'data-nav': '',
    onclick: () => {
      if (st.revealed) return;
      const at = st.order.indexOf(orig);
      if (at >= 0) st.order.splice(at, 1);
      else st.order.push(orig);
      draw();
      notify();
    },
  }));
  function draw() {
    btns.forEach((b, pos) => {
      const orig = show[pos];
      const at = st.order.indexOf(orig);
      clear(b).append(h('span', { class: 'opt-key', text: at >= 0 ? String(at + 1) : '·' }), h('span', { class: 'opt-text', text: probe.items[orig] }));
      b.classList.toggle('used', at >= 0);
    });
    clear(placed);
    st.order.forEach((orig) => placed.append(h('li', { text: probe.items[orig] })));
  }
  draw();
  return {
    el: h('div', { class: 'order' }, h('p', { class: 'small muted', text: 'Tap the items in order, earliest first. Tap again to take one back.' }), h('div', { class: 'order-pool' }, btns), placed),
    done: () => st.order.length === n,
    reveal() {
      btns.forEach((b) => { b.disabled = true; });
      clear(placed);
      st.order.forEach((orig, pos) => placed.append(h('li', { class: orig === pos ? 'right' : 'wrong', text: probe.items[orig] })));
      if (!st.order.every((v, i) => v === i)) placed.after(h('div', { class: 'order-fix' }, h('p', { class: 'small muted', text: 'Correct order:' }), h('ol', null, probe.items.map((x) => h('li', { text: x })))));
    },
    keyPick(k) {
      if (/^[1-9]$/.test(k) && btns[Number(k) - 1]) { btns[Number(k) - 1].click(); return true; }
      return false;
    },
  };
}

// ---- mount --------------------------------------------------------------------------------
// opts: {seed, onChange(ready)}
export function mountProbe(container, probe, { seed = probe.id, onChange = () => {} } = {}) {
  const st = { revealed: false };
  const root = h('div', { class: `pv pv-${probe.format}` });
  clear(container).append(root);
  const notify = () => onChange(ctl.ready());
  let block = null;
  let stmts = null;
  let opts = null;
  let input = null;
  let textarea = null;

  switch (probe.format) {
    case 'cloze':
    case 'qa': {
      root.append(prompt(probe));
      input = h('input', { type: 'text', class: 'pv-type', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', enterkeyhint: 'done', placeholder: probe.format === 'cloze' ? 'Type the missing word (optional)' : 'Type your answer (optional)', 'aria-label': 'Your answer' });
      input.addEventListener('input', () => { st.typed = input.value; notify(); });
      root.append(input, h('p', { class: 'small muted', text: 'Recall it first. Typing is optional: you can also just mark yourself after the reveal.' }));
      break;
    }
    case 'tf': {
      root.append(prompt(probe));
      if (probe.statements) {
        stmts = statementsBlock(probe.statements, st, notify, { labels: probe.statements.length > 1 });
        root.append(stmts.el);
      } else {
        stmts = statementsBlock([{ text: probe.stem, true: probe.answer }], st, notify, { labels: false });
        root.append(stmts.el);
      }
      break;
    }
    case 'statement': {
      // Statements written into the stem are shown once, as markable rows.
      const lines = String(probe.stem).split('\n');
      const isStmt = (l) => probe.statements.some((x) => l.includes(x.text.slice(0, 40)));
      const first = lines.findIndex(isStmt);
      const last = lines.length - 1 - lines.slice().reverse().findIndex(isStmt);
      const intro = first >= 0 ? lines.slice(0, first).join('\n') : probe.stem;
      const outro = first >= 0 ? lines.slice(last + 1).join('\n') : '';
      root.append(h('div', { class: 'pv-stem pre' }, gapNodes(intro)));
      stmts = statementsBlock(probe.statements, st, () => { opts.setDisabled(!stmts.done()); notify(); });
      root.append(stmts.el);
      if (outro.trim()) root.append(h('p', { class: 'pv-stem pre', text: outro }));
      root.append(h('p', { class: 'small muted', text: 'Mark each statement true or false first; the options unlock after that.' }));
      opts = optionsBlock(probe, st, notify, () => !stmts.done());
      opts.setDisabled(true);
      root.append(opts.el);
      break;
    }
    case 'assertionReason': {
      root.append(prompt(probe));
      opts = optionsBlock(probe, st, notify);
      root.append(opts.el);
      break;
    }
    case 'match':
    case 'contrast': {
      root.append(prompt(probe));
      if (probe.options && probe.format === 'match') {
        root.append(h('ul', { class: 'plain small' }, probe.pairs.map(([l, r]) => h('li', { text: `${l} — ${r}` }))));
        opts = optionsBlock(probe, st, notify);
        root.append(opts.el);
      } else {
        block = pairBlock(probe, st, notify, seed);
        root.append(block.el);
      }
      break;
    }
    case 'order': {
      root.append(prompt(probe));
      block = orderBlock(probe, st, notify, seed);
      root.append(block.el);
      break;
    }
    case 'explain': {
      root.append(prompt(probe));
      textarea = h('textarea', { class: 'pv-write', rows: '7', placeholder: 'Write (or dictate) everything you can explain, then press Done.', 'aria-label': 'Your explanation' });
      textarea.addEventListener('input', () => { st.text = textarea.value; });
      root.append(textarea);
      st.stage = 'write';
      break;
    }
    default: {
      root.append(prompt(probe));
      if (probe.options) { opts = optionsBlock(probe, st, notify); root.append(opts.el); }
      break;
    }
  }

  const ctl = {
    probe,
    root,
    state: st,
    ready() {
      switch (probe.format) {
        case 'cloze': case 'qa': return true;
        case 'tf': return stmts.done();
        case 'statement': return stmts.done() && Number.isInteger(st.choice);
        case 'match': case 'contrast': return block ? block.done() : Number.isInteger(st.choice);
        case 'order': return block.done();
        case 'explain': return st.stage === 'check';
        default: return Number.isInteger(st.choice);
      }
    },
    response() {
      switch (probe.format) {
        case 'cloze': case 'qa': return { typed: (st.typed || '').trim() || null, self: st.self };
        case 'tf': return { marks: st.marks.slice() };
        case 'statement': return { marks: st.marks.slice(), choice: st.choice };
        case 'match': case 'contrast': return block ? { pairing: st.pairing.slice() } : { choice: st.choice };
        case 'order': return { order: st.order.slice() };
        case 'explain': return { text: (st.text || '').slice(0, 4000), ticked: (st.ticked || []).slice() };
        default: return { choice: st.choice };
      }
    },
    // Explain: moves from writing to the key-point checklist.
    toCheck() {
      if (probe.format !== 'explain' || st.stage !== 'write') return;
      st.stage = 'check';
      textarea.readOnly = true;
      st.ticked = probe.keyPoints.map(() => false);
      const list = h('div', { class: 'checklist' },
        h('p', { class: 'small muted', text: 'Tick each key point your answer covered.' }),
        probe.keyPoints.map((k, i) => {
          const cb = h('input', { type: 'checkbox' });
          cb.addEventListener('change', () => { st.ticked[i] = cb.checked; notify(); });
          return h('label', { class: 'check-row' }, cb, h('span', { text: k }));
        }));
      root.append(list);
      notify();
    },
    setDictated(text) {
      if (textarea) { textarea.value = `${textarea.value ? `${textarea.value} ` : ''}${text}`; st.text = textarea.value; }
      else if (input) { input.value = text; st.typed = text; notify(); }
    },
    reveal() {
      st.revealed = true;
      if (input) input.readOnly = true;
      if (stmts) stmts.reveal();
      if (opts) opts.reveal();
      if (block) block.reveal();
    },
    key(k) {
      if (st.revealed) return false;
      if (opts && /^[a-d]$/.test(k) && (probe.format !== 'statement' || stmts.done())) { opts.pick(LETTERS.indexOf(k)); return true; }
      if (stmts && (k === 't' || k === 'f')) { stmts.markNext(k === 't'); return true; }
      if (block && block.keyPick) return block.keyPick(k);
      return false;
    },
    focusInput() {
      if (input) input.focus();
      else if (textarea) textarea.focus();
    },
  };
  return ctl;
}

export function pyqProbe(q) {
  return {
    id: `pyq:${q.id}`,
    format: 'pyq',
    atoms: q.atoms || [],
    stem: q.stem,
    options: q.options,
    answer: q.answer,
    explanation: q.elimination || '',
    difficulty: 2,
    pyq: q,
  };
}

export { hasGap };
