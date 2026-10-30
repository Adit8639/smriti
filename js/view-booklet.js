// Micro-booklet: the latest notes level of a subject's topics compiled into one clean,
// printable page. One subject per booklet.

import { h, toast } from './ui.js';
import { app, allNodes, activeProfile } from './store.js';
import { buildTree } from './tree.js';
import { noteText } from './view-notes.js';
import { formatDate, localDate, plural } from './util.js';
import * as clock from './clock.js';

// Topics under a node in syllabus order, the node itself first.
function subtree(tree, id) {
  const out = [];
  const stack = [id];
  while (stack.length) {
    const cur = stack.pop();
    out.push(cur);
    for (const k of tree.children(cur).slice().reverse()) stack.push(k);
  }
  return out;
}

export async function render(route) {
  const nodes = allNodes();
  const tree = buildTree(nodes, activeProfile(), true);
  const root = h('div', { class: 'booklet-view' });
  if (!route.arg) {
    // Subjects: depth 1–2 topics whose subtree has notes.
    const subjects = [];
    const depth = new Map();
    const stack = tree.roots.map((r) => [r, 0]);
    while (stack.length) {
      const [id, d] = stack.pop();
      depth.set(id, d);
      if (d <= 2) {
        const withNotes = subtree(tree, id).filter((x) => app.state.notes[x] && app.state.notes[x].latest).length;
        if (withNotes && d >= 1) subjects.push({ id, withNotes, d });
      }
      if (d < 2) for (const k of tree.children(id)) stack.push([k, d + 1]);
    }
    root.append(h('p', { class: 'intro', text: 'Pick a subject. The booklet takes the latest level you wrote for each of its topics.' }));
    if (!subjects.length) {
      root.append(h('div', { class: 'card hint' }, h('p', { text: 'No notes yet. Write R1 for a topic (Library → topic → Notes) and it appears here.' })));
      return root;
    }
    root.append(h('ul', { class: 'plain link-list' }, subjects.map((x) => h('li', null, h('a', { href: `#/booklet/${encodeURIComponent(x.id)}`, 'data-nav': '' }, nodes.get(x.id).title, h('span', { class: 'tree-meta', text: plural(x.withNotes, 'topic') }))))));
    return root;
  }
  const id = route.arg;
  const subject = nodes.get(id);
  if (!subject) { root.append(h('p', { text: 'Subject not found.' })); return root; }
  const entries = [];
  for (const nid of subtree(tree, id)) {
    const n = app.state.notes[nid];
    if (!n || !n.latest) continue;
    const text = await noteText(nid, n.latest.level);
    if (text) entries.push({ nid, level: n.latest.level, text, ts: n.latest.ts });
  }
  const paper = h('article', { class: 'booklet' },
    h('header', null, h('h1', { text: subject.title }), h('p', { class: 'small muted', text: `SMRITI micro-notes · ${formatDate(localDate(clock.now()))} · ${plural(entries.length, 'topic')}` })),
    entries.map((e) => {
      // Untick to leave a topic out of this booklet (the box itself is not printed).
      const cb = h('input', { type: 'checkbox', checked: true, 'aria-label': `Include ${nodes.get(e.nid).title}` });
      const sec = h('section', { class: 'booklet-entry' },
        h('h2', null, h('label', { class: 'no-print include' }, cb), nodes.get(e.nid).title, h('span', { class: 'badge', text: `R${e.level}` })),
        h('p', { class: 'pre', text: e.text }));
      cb.addEventListener('change', () => sec.classList.toggle('excluded', !cb.checked));
      return sec;
    }));
  root.append(h('div', { class: 'no-print button-row' },
    h('a', { class: 'btn', href: '#/booklet' }, '‹ Subjects'),
    h('button', { class: 'btn primary', type: 'button', onclick: () => { if (!entries.length) { toast('Nothing to print yet.', { kind: 'warn' }); return; } window.print(); } }, 'Print or save as PDF')), paper);
  return root;
}
