// Library: syllabus tree with search, and the topic (node) page with everything linked to it.

import { solvePyqs } from './view-lab.js';
import { newsFor } from './view-ca.js';
import { h, clear, icon } from './ui.js';
import { app, allNodes, activeProfile } from './store.js';
import { buildTree, ancestors } from './tree.js';
import { quarantineStatus } from './rebuild.js';
import { STATE_NAMES } from './fsrs.js';
import { readerTarget, openSource } from './links.js';
import { sourcesForNode } from './sources.js';
import { quickAdd } from './sheets.js';
import { call } from './data.js';
import { formatDate, addDays, plural, wordCount, isObj, localDate } from './util.js';

const LS_EXPANDED = 'smriti.expanded';
const LS_ALL = 'smriti.libShowAll';

let query = '';
const expanded = new Set(readLS(LS_EXPANDED, []));
let showAll = readLS(LS_ALL, false);

function readLS(key, fallback) {
  try { const v = localStorage.getItem(key); return v === null ? fallback : JSON.parse(v); } catch (_) { return fallback; }
}
function writeLS(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch (_) { /* preference only */ }
}

export function countsText(t) {
  if (!t) return 'empty';
  const parts = [];
  if (t.atoms) parts.push(plural(t.atoms, 'atom'));
  if (t.pyqs) parts.push(plural(t.pyqs, 'PYQ'));
  if (t.ca) parts.push(`${t.ca} CA`);
  return parts.length ? parts.join(' · ') : 'empty';
}

export async function render(route) {
  if (route.name === 'node') return renderNode(route.arg, route.query.get('focus'));
  return renderTree();
}

// ---------------------------------------------------------------- tree

function renderTree() {
  const profile = activeProfile();
  const nodes = allNodes();
  const totals = app.derived.subtreeCounts || {};
  const root = h('div', { class: 'library' });

  const input = h('input', {
    type: 'search', id: 'lib-search', class: 'search', value: query, autocomplete: 'off', enterkeyhint: 'search',
    placeholder: 'Search topics, facts, PYQs, CA', 'aria-label': 'Search the library (shortcut: /)',
  });
  const results = h('div', { class: 'results', 'aria-live': 'polite' });
  const treeBox = h('div', { class: 'tree-box' });
  root.append(h('div', { class: 'search-wrap' }, icon('search', 'icon search-icon'), input), results, treeBox);

  const drawTree = () => {
    clear(treeBox);
    const tree = buildTree(nodes, profile, showAll);
    const total = tree.visible ? tree.visible.size : nodes.size;
    treeBox.append(h('div', { class: 'scope-line' },
      h('span', { text: `${showAll ? 'All exams' : profile ? profile.name : 'All exams'} · ${plural(total, 'topic')}` }),
      profile ? h('button', { class: 'btn small', onclick: () => { showAll = !showAll; writeLS(LS_ALL, showAll); drawTree(); } }, showAll ? 'Only this exam' : 'Show all exams') : null));

    const summary = app.derived.summary;
    if (!summary || !summary.counts.atoms) {
      treeBox.append(h('div', { class: 'card hint' },
        h('p', { text: 'No study content yet. The tree below is the starter syllabus from your exam profile; content arrives as packs.' }),
        h('a', { class: 'btn primary', href: '#/data' }, 'Import a pack or try the demo')));
    }

    const row = (id, depth) => {
      const n = nodes.get(id);
      const kids = tree.children(id);
      const open = expanded.has(id);
      const li = h('li', { role: 'treeitem', 'aria-expanded': kids.length ? String(open) : null });
      const toggle = () => {
        if (open) expanded.delete(id); else expanded.add(id);
        writeLS(LS_EXPANDED, [...expanded]);
        li.replaceWith(row(id, depth));
        const again = treeBox.querySelector(`[data-twisty="${CSS.escape(id)}"]`);
        if (again) again.focus();
      };
      li.append(h('div', { class: 'tree-row', style: `--depth:${depth}` },
        kids.length
          ? h('button', { class: `twisty${open ? ' open' : ''}`, 'data-twisty': id, 'aria-label': `${open ? 'Collapse' : 'Expand'} ${n.title}`, onclick: toggle }, icon('chevron'))
          : h('span', { class: 'twisty-spacer' }),
        h('a', { class: 'tree-link', href: `#/node/${encodeURIComponent(id)}`, 'data-nav': '' },
          h('span', { class: 'tree-title', text: n.title }),
          h('span', { class: 'tree-meta', text: countsText(totals[id]) }))));
      if (open && kids.length) li.append(h('ul', { role: 'group' }, kids.map((k) => row(k, depth + 1))));
      return li;
    };
    treeBox.append(h('ul', { class: 'tree', role: 'tree', 'aria-label': 'Syllabus' }, tree.roots.map((id) => row(id, 0))));

    if (tree.unplaced.length) {
      treeBox.append(h('details', { class: 'card' },
        h('summary', { text: `Unplaced topics (${tree.unplaced.length}): parent not installed` }),
        h('ul', { class: 'plain' }, tree.unplaced.map((id) => h('li', null, h('a', { href: `#/node/${encodeURIComponent(id)}`, 'data-nav': '' }, nodes.get(id).title), ' ', h('code', { text: `parent ${nodes.get(id).parent}` }))))));
    }
    const integ = app.derived.integrity;
    if (integ && integ.orphans.length) treeBox.append(orphanList(integ.orphans));
  };

  let timer = null;
  let seq = 0;
  const runSearch = async () => {
    query = input.value;
    const my = ++seq;
    if (!query.trim()) { clear(results); treeBox.hidden = false; return; }
    const hits = await call('search', { q: query });
    if (my !== seq) return;
    treeBox.hidden = true;
    clear(results);
    if (!hits.length) { results.append(h('p', { class: 'muted', text: 'No matches.' })); return; }
    const KIND = { node: 'Topic', atom: 'Atom', pyq: 'PYQ', ca: 'CA' };
    results.append(h('ul', { class: 'result-list' }, hits.map((r) => {
      const node = r.nodeId ? nodes.get(r.nodeId) : null;
      const href = r.nodeId ? `#/node/${encodeURIComponent(r.nodeId)}${r.kind === 'node' ? '' : `?focus=${encodeURIComponent(r.refId)}`}` : null;
      return h('li', null, h(href ? 'a' : 'div', { class: 'result', href, 'data-nav': '', tabindex: href ? null : '0' },
        h('span', { class: `badge kind-${r.kind}`, text: KIND[r.kind] }),
        h('span', { class: 'result-label', text: r.label }),
        node && r.kind !== 'node' ? h('span', { class: 'result-node', text: node.title }) : null));
    })));
  };
  input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(runSearch, 150); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && input.value) { e.stopPropagation(); input.value = ''; runSearch(); }
  });

  drawTree();
  if (query.trim()) runSearch();
  return root;
}

function orphanList(orphans) {
  return h('details', { class: 'card warn' },
    h('summary', { text: `Orphaned items (${orphans.length}): they point at content that is not installed` }),
    h('p', { class: 'muted', text: 'Orphans stay installed and keep their history. Installing the missing pack resolves them.' }),
    h('ul', { class: 'plain small' }, orphans.slice(0, 100).map((o) => h('li', null, h('code', { text: `${o.store} ${o.id}` }), ` → missing ${o.missing.join(', ')}`))),
    orphans.length > 100 ? h('p', { class: 'muted', text: `…and ${orphans.length - 100} more` }) : null);
}

// ---------------------------------------------------------------- node page

export function gapText(text) {
  const parts = String(text).split(/(_{3,})/);
  return parts.map((p) => (/^_{3,}$/.test(p) ? h('span', { class: 'gap', 'aria-label': 'blank' }, '____') : p));
}

export function sourceLabel(item, packs, pyqs) {
  const s = item.source;
  if (!isObj(s)) return typeof s === 'string' ? s : 'No source';
  if (s.sourceId) {
    const src = app.state.sources[s.sourceId];
    return `${src ? src.title : 'A source not on this device'}${s.page !== undefined ? `, p. ${s.page}` : ''} · made by me`;
  }
  if (!s.pack && s.title) return `${s.title}${s.page !== undefined && s.page !== '' ? `, p. ${s.page}` : ''}${item.origin === 'self' ? ' · made by me' : ''}`;
  if (s.pyq) {
    const q = pyqs.get(s.pyq);
    return q ? `PYQ ${q.year} · ${q.id}` : `PYQ ${s.pyq} (not installed)`;
  }
  const p = packs.get(s.pack);
  const title = p ? (p.source && p.source.title) || p.title : s.pack;
  const page = s.page !== undefined ? `, p. ${s.page}` : '';
  if (item.origin === 'model') return `${title}${page} · added by AI, verify`;
  return `${title}${page}`;
}

const STATUS_BADGE = {
  quarantined: ['Quarantine', 'warn'],
  approved: ['Approved', 'ok'],
  discarded: ['Discarded', 'muted'],
};

function scheduleLine(rec) {
  if (!rec || !rec.card) return 'Not reviewed yet';
  const c = rec.card;
  return `${STATE_NAMES[c.state]} · due ${formatDate(localDate(c.due))} · ${rec.reviews || 0} reviews, ${c.lapses} lapses`;
}

function atomCard(a, ctx) {
  const st = quarantineStatus(a, app.state);
  const badge = STATUS_BADGE[st];
  const orphan = ctx.orphans.get(`atoms:${a.id}`);
  const rec = app.state.atoms[a.id];
  const target = readerTarget(a);
  return h('article', { class: 'card item', id: `item-${a.id}`, tabindex: '0', 'data-nav': '' },
    h('div', { class: 'item-head' },
      h('span', { class: 'badge', text: a.type }),
      badge ? h('span', { class: `badge ${badge[1]}`, text: badge[0] }) : null,
      rec && rec.suspended ? h('a', { class: 'badge warn', href: `#/rebuild/${encodeURIComponent(a.id)}`, text: 'Leech: rebuild' }) : null,
      rec && rec.retired ? h('span', { class: 'badge muted', text: 'Split (retired)' }) : null,
      a.origin === 'self' ? h('span', { class: 'badge muted', text: 'Mine' }) : null,
      orphan ? h('span', { class: 'badge warn', text: 'Orphaned', title: `missing ${orphan.join(', ')}` }) : null,
      h('code', { class: 'item-id', text: a.id })),
    h('p', { class: 'item-text' }, gapText(a.text)),
    h('p', { class: 'answer' }, h('span', { class: 'muted', text: 'Answer: ' }), String(a.answer)),
    h('p', { class: 'source' }, h('span', { class: 'muted', text: 'Source: ' }), sourceLabel(a, ctx.packs, ctx.pyqs),
      target ? [' ', h('button', { class: 'link-btn', type: 'button', onclick: () => openSource(target) }, `Open page ${target.page}`)] : null),
    h('p', { class: 'small muted', text: scheduleLine(rec) }),
    rec && rec.mnemonic ? h('p', { class: 'small' }, h('span', { class: 'muted', text: 'My mnemonic: ' }), rec.mnemonic) : null,
    a.note ? h('p', { class: 'small' }, h('span', { class: 'muted', text: 'Note: ' }), a.note) : null,
    a.mnemonic ? h('p', { class: 'small' }, h('span', { class: 'muted', text: 'Mnemonic: ' }), a.mnemonic) : null,
    a.eventDate ? h('p', { class: 'small muted', text: `Event ${formatDate(a.eventDate)}${a.shelfLifeDays ? ` · counts for Prelims until ${formatDate(addDays(a.eventDate, a.shelfLifeDays))}` : ''}` }) : null,
    a.confusables && a.confusables.length ? h('p', { class: 'small' }, h('span', { class: 'muted', text: 'Confusable with: ' }),
      a.confusables.map((cid, i) => {
        const c = ctx.atomsById.get(cid);
        const label = c ? String(c.text).replace(/_{3,}/g, `[${c.answer}]`) : `${cid} (not installed)`;
        const target = c && c.nodes && c.nodes[0];
        return [i ? '; ' : '', target ? h('a', { href: `#/node/${encodeURIComponent(target)}?focus=${encodeURIComponent(cid)}` }, label) : label];
      })) : null);
}

function probeCard(q, ctx) {
  const details = [];
  if (q.statements) {
    details.push(h('ol', { class: 'statements' }, q.statements.map((s) => h('li', null, s.text, ' ',
      h('span', { class: `badge ${s.true ? 'ok' : 'warn'}`, text: s.true ? 'true' : `false${s.trap ? ` · ${s.trap}` : ''}` }),
      s.reason ? h('span', { class: 'muted small', text: ` ${s.reason}` }) : null))));
  }
  if (q.options) details.push(h('ol', { class: 'options', type: 'a' }, q.options.map((o, i) => h('li', { class: i === q.answer ? 'correct' : null }, o, i === q.answer ? ' ✓' : ''))));
  if (q.pairs) details.push(h('ul', { class: 'plain' }, q.pairs.map(([l, r]) => h('li', null, `${l} — ${r}`))));
  if (q.items) details.push(h('ol', null, q.items.map((x) => h('li', { text: x }))));
  if (q.keyPoints) details.push(h('ul', null, q.keyPoints.map((x) => h('li', { text: x }))));
  if (q.format === 'cloze' || (q.format === 'tf' && typeof q.answer === 'boolean')) details.push(h('p', { text: `Answer: ${q.answer}` }));
  const orphan = ctx.orphans.get(`probes:${q.id}`);
  return h('article', { class: 'card item', id: `item-${q.id}`, tabindex: '0', 'data-nav': '' },
    h('div', { class: 'item-head' }, h('span', { class: 'badge', text: q.format }), h('span', { class: 'badge muted', text: `difficulty ${q.difficulty}` }),
      orphan ? h('span', { class: 'badge warn', text: 'Orphaned' }) : null, h('code', { class: 'item-id', text: q.id })),
    h('p', { class: 'item-text pre' }, gapText(q.stem)),
    h('details', null, h('summary', { text: 'Show answer' }), details, h('p', { class: 'small' }, h('span', { class: 'muted', text: 'Why: ' }), q.explanation)),
    h('div', { class: 'card-actions' }, h('a', { class: 'btn small', href: `#/practice/probe/${encodeURIComponent(q.id)}?from=${encodeURIComponent(ctx.nodeId)}` }, 'Try it (practice)')));
}

function pyqCard(q, ctx) {
  const paper = app.ctx.papers.get(q.paper);
  return h('article', { class: 'card item', id: `item-${q.id}`, tabindex: '0', 'data-nav': '' },
    h('div', { class: 'item-head' },
      h('span', { class: 'badge', text: `PYQ ${q.year}` }),
      q.format ? h('span', { class: 'badge', text: q.format }) : null,
      q.answerSource ? h('span', { class: `badge ${q.answerSource === 'official' ? 'ok' : 'warn'}`, text: `key: ${q.answerSource}` }) : null,
      h('code', { class: 'item-id', text: q.id })),
    h('p', { class: 'small muted', text: paper ? paper.name : q.paper }),
    h('p', { class: 'item-text pre', text: q.stem }),
    q.options ? h('details', null, h('summary', { text: 'Show answer' }),
      h('ol', { class: 'options', type: 'a' }, q.options.map((o, i) => h('li', { class: i === q.answer ? 'correct' : null }, o, i === q.answer ? ' ✓' : ''))),
      q.elimination ? h('p', { class: 'pre small' }, h('span', { class: 'muted', text: 'Elimination: ' }), q.elimination) : null,
      q.traps && q.traps.length ? h('p', { class: 'small' }, h('span', { class: 'muted', text: 'Traps: ' }), q.traps.map((t) => `statement ${t.statement}: ${t.tag}`).join('; ')) : null)
      : h('p', { class: 'small', text: `${q.directive || ''} · ${q.marks || '?'} marks · ${q.words || '?'} words` }),
    q.options ? h('div', { class: 'card-actions' }, h('button', { class: 'btn small', type: 'button', onclick: () => solvePyqs([q.id], `PYQ ${q.year}`) }, 'Solve it')) : null);
}

function caCard(x, ctx) {
  const nodes = allNodes();
  return h('article', { class: 'card item', id: `item-${x.id}`, tabindex: '0', 'data-nav': '' },
    h('div', { class: 'item-head' }, h('span', { class: 'badge kind-ca', text: formatDate(x.date) }), h('code', { class: 'item-id', text: x.id })),
    h('h3', { class: 'item-title', text: x.headline }),
    h('p', { text: x.whyInNews }),
    h('p', { class: 'small muted', text: `Counts for Prelims until ${formatDate(addDays(x.date, x.shelfLifeDays))} (${x.shelfLifeDays}-day shelf life)` }),
    h('p', { class: 'chips' }, x.anchors.map((id) => h('a', { class: 'chip', href: `#/node/${encodeURIComponent(id)}` }, nodes.get(id) ? nodes.get(id).title : `${id} (missing)`))),
    x.mainsAngle && x.mainsAngle.length ? h('p', { class: 'small' }, h('span', { class: 'muted', text: 'Mains angle: ' }), x.mainsAngle.join('; ')) : null,
    x.probableQs && x.probableQs.length ? h('ul', { class: 'small' }, x.probableQs.map((q) => h('li', null, h('span', { class: 'muted', text: `${q.stage}: ` }), q.text))) : null);
}

function noteCard(n) {
  return h('article', { class: 'card item', id: `item-${n.id}`, tabindex: '0', 'data-nav': '' },
    h('div', { class: 'item-head' }, h('span', { class: 'badge', text: `R${n.level}` }), h('span', { class: 'muted small', text: `${wordCount(n.text)} words` })),
    h('p', { class: 'item-text pre', text: n.text }));
}

function answerCard(a) {
  return h('article', { class: 'card item', id: `item-${a.id}`, tabindex: '0', 'data-nav': '' },
    h('div', { class: 'item-head' }, h('span', { class: 'badge', text: 'Model answer' }), h('span', { class: 'badge muted', text: `${a.marks} marks · ${a.directive}` }), h('code', { class: 'item-id', text: a.id })),
    h('h3', { class: 'item-title', text: a.question }),
    h('details', null, h('summary', { text: 'Show skeleton' }),
      h('p', null, h('span', { class: 'muted', text: 'Intro: ' }), a.skeleton.intro),
      h('ol', null, a.skeleton.body.map((b) => h('li', { text: b }))),
      h('p', null, h('span', { class: 'muted', text: 'Conclusion: ' }), a.skeleton.conclusion),
      a.valueAdds && a.valueAdds.length ? h('ul', { class: 'small' }, a.valueAdds.map((v) => h('li', null, h('span', { class: 'muted', text: `${v.type}: ` }), v.text))) : null));
}

const NODE_STATUS = { new: ['New', 'muted'], learning: ['Learning', 'warn'], learned: ['Learned', 'ok'] };

function studyPanel(id, n, atoms) {
  const st = app.state.nodes[id] || { status: 'new' };
  const [label, kind] = NODE_STATUS[st.status] || NODE_STATUS.new;
  const loopId = app.state.activeLoop[id];
  const loop = loopId && app.state.loops[loopId];
  const steps = { pretest: 1, read: 2, recall: 3, probes: 4, output: 5 };
  const notes = app.state.notes[id];
  const maps = sourcesForNode(app.state, id);
  return h('section', { class: 'card study' },
    h('div', { class: 'item-head' },
      h('span', { class: `badge ${kind}`, text: label }),
      st.recallPct !== null && st.recallPct !== undefined ? h('span', { class: 'small muted', text: `last recall ${st.recallPct}%` }) : null,
      st.completed ? h('span', { class: 'small muted', text: `${st.completed} loop${st.completed > 1 ? 's' : ''} done` }) : null,
      notes ? h('span', { class: 'small muted', text: `notes R${notes.latest.level}, ${notes.revisions} revision${notes.revisions > 1 ? 's' : ''}` }) : null),
    maps.length ? h('p', { class: 'chips' }, maps.map((m) => h('a', { class: 'chip', href: `#/reader/${encodeURIComponent(m.sourceId)}/${m.from}` }, `${(app.state.sources[m.sourceId] || { title: m.sourceId }).title} · p. ${m.from}${m.to !== m.from ? `–${m.to}` : ''}`)),
      maps.length >= 3 ? h('span', { class: 'small warn-text', text: ' Limited sources, more revisions.' }) : null) : null,
    h('div', { class: 'button-row' },
      atoms.length || loop ? h('a', { class: 'btn primary', href: loop ? `#/learn/${encodeURIComponent(loopId)}` : `#/learn/start/${encodeURIComponent(id)}` }, loop ? `Resume Learn Loop (step ${steps[loop.step] || 1}/5)` : 'Start Learn Loop') : null,
      h('a', { class: 'btn', href: `#/notes/${encodeURIComponent(id)}` }, 'Notes'),
      atoms.length ? h('a', { class: 'btn', href: `#/practice/${encodeURIComponent(id)}` }, 'Practice') : null,
      h('button', { class: 'btn', type: 'button', onclick: async () => { const a = await quickAdd({ nodeId: id }); if (a) location.hash = `#/node/${encodeURIComponent(id)}?focus=${encodeURIComponent(a.id)}`; } }, 'Add atom')));
}

async function renderNode(id, focus) {
  const nodes = allNodes();
  const n = nodes.get(id);
  if (!n) {
    return h('div', { class: 'card' }, h('h2', { text: 'Topic not found' }), h('p', { text: `No topic has the id ${id}.` }), h('a', { class: 'btn', href: '#/library' }, 'Back to Library'));
  }
  const db = app.db;
  const [packList, atoms, pyqs, ca, notes] = await Promise.all([
    db.getAll('packs'),
    db.getAllByIndex('atoms', 'nodes', id),
    db.getAllByIndex('pyqs', 'nodes', id),
    db.getAllByIndex('ca', 'anchors', id),
    db.getAllByIndex('notes', 'node', id),
  ]);
  const probeMap = new Map();
  for (const a of atoms) for (const q of await db.getAllByIndex('probes', 'atoms', a.id)) probeMap.set(q.id, q);
  const answers = n.parent === null || n.parent === undefined ? await db.getAllByIndex('answers', 'paper', n.paper) : [];
  const packs = new Map(packList.map((p) => [p.id, p]));
  const atomsById = new Map(atoms.map((a) => [a.id, a]));
  const pyqsById = new Map(pyqs.map((q) => [q.id, q]));
  for (const a of atoms) {
    for (const cid of a.confusables || []) if (!atomsById.has(cid)) { const c = await db.get('atoms', cid); if (c) atomsById.set(cid, c); }
    if (isObj(a.source) && a.source.pyq && !pyqsById.has(a.source.pyq)) { const q = await db.get('pyqs', a.source.pyq); if (q) pyqsById.set(q.id, q); }
  }
  const orphans = new Map((app.derived.integrity ? app.derived.integrity.orphans : []).map((o) => [`${o.store}:${o.id}`, o.missing]));
  const ctx = { packs, pyqs: pyqsById, atomsById, orphans, nodeId: id };
  const direct = app.derived.nodeCounts[id] || {};
  const totals = app.derived.subtreeCounts || {};
  const total = totals[id];
  const kids = [...nodes.values()].filter((x) => x.parent === id);
  const paper = app.ctx.papers.get(n.paper);

  const news = await newsFor(id);
  const vadds = atoms.filter((a) => a.type === 'valueadd');
  const section = (title, list, card) => (list.length
    ? h('section', null, h('h3', { class: 'section-title', text: `${title} (${list.length})` }), list.map((x) => card(x, ctx)))
    : null);

  const root = h('div', { class: 'node-page' },
    h('nav', { class: 'crumbs', 'aria-label': 'Breadcrumb' },
      h('a', { href: '#/library' }, 'Library'),
      ancestors(nodes, id).map((a) => [' / ', h('a', { href: `#/node/${encodeURIComponent(a.id)}` }, a.title)])),
    h('h2', { class: 'node-title', text: n.title }),
    h('p', { class: 'small muted' }, h('code', { text: n.id }), ` · ${paper ? paper.name : n.paper} · ${n._pack ? `from pack ${n._pack}` : 'starter syllabus'}`),
    n.description ? h('p', { text: n.description }) : null,
    n.keywords && n.keywords.length ? h('p', { class: 'chips' }, n.keywords.map((k) => h('span', { class: 'chip', text: k }))) : null,
    news.length ? h('div', { class: 'news-chips' }, h('span', { class: 'small muted', text: 'In the news: ' }),
      news.slice(0, 8).map((x) => h('a', { class: 'chip chip-news', href: `#/ca/item/${encodeURIComponent(x.id)}` }, `${x.date.slice(0, 7)} · ${x.headline.length > 60 ? `${x.headline.slice(0, 57)}…` : x.headline}`))) : null,
    vadds.length ? h('p', { class: 'small' }, h('strong', { text: 'Value-add bank: ' }), `${vadds.length} here · `,
      h('a', { href: `#/practice/atoms?mode=practice&ids=${vadds.map((a) => encodeURIComponent(a.id)).join(',')}` }, 'drill them')) : null,
    h('p', { class: 'counts' },
      h('span', null, h('strong', { text: 'Here: ' }), countsText(direct)),
      kids.length ? h('span', null, h('strong', { text: ' · With subtopics: ' }), countsText(total)) : null),
    studyPanel(id, n, atoms),
    kids.length ? h('section', null, h('h3', { class: 'section-title', text: `Subtopics (${kids.length})` }),
      h('ul', { class: 'plain link-list' }, kids.map((k) => h('li', null, h('a', { href: `#/node/${encodeURIComponent(k.id)}`, 'data-nav': '' }, k.title, h('span', { class: 'tree-meta', text: countsText(totals[k.id]) })))))) : null,
    section('Atoms', atoms, atomCard),
    section('Probes', [...probeMap.values()].sort((a, b) => (a.id < b.id ? -1 : 1)), probeCard),
    pyqs.length ? h('section', null,
      h('div', { class: 'row-between' }, h('h3', { class: 'section-title', text: `PYQs (${pyqs.length})` }),
        pyqs.some((q) => q.options) ? h('button', { class: 'btn small primary', type: 'button', onclick: () => solvePyqs(pyqs.filter((q) => q.options).map((q) => q.id), `PYQs: ${n.title}`) }, 'Solve all') : null),
      pyqs.sort((a, b) => b.year - a.year).map((x) => pyqCard(x, ctx))) : null,
    section('Current affairs', ca.sort((a, b) => (a.date < b.date ? 1 : -1)), caCard),
    section('Notes', notes.sort((a, b) => a.level - b.level), noteCard),
    section('Model answers for this paper', answers, answerCard));

  if (focus) {
    requestAnimationFrame(() => {
      const el = root.querySelector(`#item-${CSS.escape(focus)}`);
      if (el) { el.classList.add('focused'); el.focus(); el.scrollIntoView({ block: 'center' }); }
    });
  }
  return root;
}
