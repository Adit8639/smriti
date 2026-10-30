// Shrink-Wrap Notes: each revision rewrites a topic from memory under a tighter cap —
// R1 300 words, R2 150, R3 60, R4 12 keywords — with the previous level hidden. After
// saving: the previous level side by side, and the atom checklist to mark what was dropped.

import { h, clear, toast } from './ui.js';
import { app, allNodes, appendEvents } from './store.js';
import { NOTE_CAPS } from './schema.js';
import { filled } from './cloze.js';
import { quarantineStatus } from './rebuild.js';
import { sourcesForNode } from './sources.js';
import { dictation } from './dictate.js';
import { wordCount, formatDate, localDate, plural } from './util.js';
import { ulid } from './ulid.js';
import * as clock from './clock.js';

export const capLabel = (level) => (level === 4 ? `${NOTE_CAPS[4]} keywords` : `${NOTE_CAPS[level]} words`);
export const keywordCount = (s) => String(s).split(/[,;\n]+/).map((x) => x.trim()).filter(Boolean).length;
export const sizeOf = (level, text) => (level === 4 ? keywordCount(text) : wordCount(text));

export async function noteText(nodeId, level) {
  const n = app.state.notes[nodeId];
  const l = n && n.levels[level];
  if (!l) return null;
  const ev = await app.db.get('events', l.eventId);
  return ev && ev.payload ? ev.payload.text : null;
}

const nextLevel = (n) => (!n || !n.latest ? 1 : Math.min(4, n.latest.level + 1));

async function eligibleAtoms(nodeId) {
  return (await app.db.getAllByIndex('atoms', 'nodes', nodeId)).filter((a) => {
    const q = quarantineStatus(a, app.state);
    const rec = app.state.atoms[a.id];
    return (q === 'clear' || q === 'approved') && !(rec && rec.retired);
  });
}

export async function render(route) {
  const nodeId = route.arg;
  const node = allNodes().get(nodeId);
  const root = h('div', { class: 'notes' });
  if (!node) { root.append(h('div', { class: 'card' }, h('p', { text: 'Topic not found.' }))); return root; }
  const n = app.state.notes[nodeId];
  const lvl = Number(route.query.get('level')) || nextLevel(n);
  const writing = route.query.get('write') === '1';
  root.append(h('nav', { class: 'crumbs' }, h('a', { href: '#/library' }, 'Library'), ' / ', h('a', { href: `#/node/${encodeURIComponent(nodeId)}` }, node.title), ' / Notes'));
  root.append(h('h2', { class: 'node-title', text: `Notes: ${node.title}` }));
  if (writing) { root.append(await writer(nodeId, node, lvl)); return root; }

  root.append(h('p', { class: 'small muted', text: `${plural(n ? n.revisions : 0, 'revision')} so far. Each one is written from memory under a tighter cap.` }));
  const levels = h('div', { class: 'stack' });
  for (const L of [1, 2, 3, 4]) {
    const info = n && n.levels[L];
    const text = info ? await noteText(nodeId, L) : null;
    levels.append(h('article', { class: 'card item' },
      h('div', { class: 'item-head' }, h('span', { class: `badge${info ? ' ok' : ''}`, text: `R${L}` }), h('span', { class: 'small muted', text: `cap ${capLabel(L)}` }),
        info ? h('span', { class: 'small muted', text: `${info.words} ${L === 4 ? 'keywords' : 'words'} · ${formatDate(localDate(info.ts))}${info.dropped !== null && info.dropped !== undefined ? ` · ${info.dropped} atoms dropped` : ''}` }) : null),
      info ? h('details', null, h('summary', { text: 'Show (only after you have rewritten from memory)' }), h('p', { class: 'pre', text: text || '' })) : h('p', { class: 'small muted', text: 'Not written yet.' })));
  }
  const packNotes = await app.db.getAllByIndex('notes', 'node', nodeId);
  root.append(levels);
  if (packNotes.length) {
    root.append(h('details', { class: 'card' }, h('summary', { text: `Notes from packs (${packNotes.length})` }),
      packNotes.sort((a, b) => a.level - b.level).map((x) => h('div', null, h('p', null, h('span', { class: 'badge', text: `R${x.level}` }), ` ${x._pack}`), h('p', { class: 'pre small', text: x.text })))));
  }
  root.append(h('div', { class: 'dock' },
    h('a', { class: 'btn', href: '#/booklet' }, 'Booklets'),
    h('a', { class: 'btn primary', href: `#/notes/${encodeURIComponent(nodeId)}?write=1&level=${nextLevel(n)}` }, `Write R${nextLevel(n)} (${capLabel(nextLevel(n))})`)));
  return root;
}

async function writer(nodeId, node, level) {
  const cap = NOTE_CAPS[level];
  const box = h('div', { class: 'writer' });
  const ta = h('textarea', { class: 'note-input', rows: level === 4 ? '4' : '12', 'aria-label': `R${level} note`, placeholder: level === 4 ? 'Up to 12 keywords, separated by commas' : `Write the topic from memory, at most ${cap} words` });
  const counter = h('p', { class: 'counter' });
  const save = h('button', { class: 'btn primary', type: 'button' }, `Save R${level}`);
  const started = performance.now();
  // Writing from memory is answer-producing time: it counts toward the active ratio.
  const sessionId = `notes-${ulid(clock.now())}`;
  appendEvents([['session.started', { sessionId, kind: 'notes', nodeId }]]).catch(() => {});
  const update = () => {
    const size = sizeOf(level, ta.value);
    counter.textContent = `${size} / ${cap} ${level === 4 ? 'keywords' : 'words'}`;
    const over = size > cap;
    counter.classList.toggle('over', over);
    save.disabled = over || size === 0;
    save.title = over ? `Over the R${level} cap: trim before saving` : '';
  };
  ta.addEventListener('input', update);
  update();
  const mic = dictation((t) => { ta.value = `${ta.value ? `${ta.value} ` : ''}${t}`; update(); });
  save.addEventListener('click', async () => {
    const text = ta.value.trim();
    const size = sizeOf(level, text);
    if (!size || size > cap) return;
    const prevLevel = level > 1 ? level - 1 : null;
    const prevText = prevLevel ? await noteText(nodeId, prevLevel) : null;
    const sourceIds = sourcesForNode(app.state, nodeId).map((x) => x.sourceId);
    save.disabled = true;
    let evs;
    try {
      evs = await appendEvents([
        ['note.saved', { nodeId, level, text, words: size, sourceIds }],
        ['session.active', { sessionId, ms: Math.round(performance.now() - started) }],
        ['session.ended', { sessionId }],
      ]);
    } catch (e) {
      save.disabled = false;
      toast(`Could not save: ${e.message}`, { kind: 'error' });
      return;
    }
    const packNote = (await app.db.getAllByIndex('notes', 'node', nodeId)).find((x) => x.level === level);
    clear(box).append(await review(nodeId, node, level, text, prevLevel, prevText, packNote, evs[0].id));
  });
  box.append(
    h('p', { class: 'intro', text: `Write R${level} (${capLabel(level)}) from memory. ${level > 1 ? `Your R${level - 1} stays hidden until you save.` : 'Write what matters most: you will compress it further next time.'}` }),
    ta, counter,
    h('div', { class: 'dock' }, mic, h('a', { class: 'btn', href: `#/notes/${encodeURIComponent(nodeId)}` }, 'Cancel'), save));
  setTimeout(() => ta.focus(), 50);
  return box;
}

async function review(nodeId, node, level, text, prevLevel, prevText, packNote, noteId) {
  const atoms = await eligibleAtoms(nodeId);
  const dropped = new Set();
  const list = h('div', { class: 'checklist' }, atoms.map((a) => {
    const cb = h('input', { type: 'checkbox' });
    cb.addEventListener('change', () => { if (cb.checked) dropped.add(a.id); else dropped.delete(a.id); });
    return h('label', { class: 'check-row' }, cb, h('span', { text: filled(a) }));
  }));
  const done = async (schedule) => {
    const ev = [['note.dropped', { nodeId, level, noteId, dropped: [...dropped] }]];
    if (schedule && dropped.size) ev.push(['atoms.scheduled', { atomIds: [...dropped], reason: 'dropped-in-notes' }]);
    await appendEvents(ev);
    toast(schedule && dropped.size ? `${plural(dropped.size, 'dropped atom')} scheduled for today.` : 'Saved.', { kind: 'ok' });
    location.hash = `#/notes/${encodeURIComponent(nodeId)}`;
  };
  return h('div', null,
    h('p', { class: 'verdict right', text: `R${level} saved (${sizeOf(level, text)} ${level === 4 ? 'keywords' : 'words'}).` }),
    h('div', { class: 'side-by-side' },
      h('section', { class: 'card' }, h('h3', { text: prevLevel ? `Your R${prevLevel}` : 'Before' }), h('p', { class: 'pre', text: prevText || (prevLevel ? 'Not written.' : 'This is your first level.') })),
      h('section', { class: 'card' }, h('h3', { text: `Your R${level}` }), h('p', { class: 'pre', text }))),
    packNote ? h('section', { class: 'card' }, h('h3', { text: `Pack R${level} (${packNote._pack}) for comparison` }), h('p', { class: 'pre', text: packNote.text })) : null,
    h('section', { class: 'card' },
      h('h3', { text: 'Which atoms did you drop?' }),
      h('p', { class: 'small muted', text: 'Tick each fact your new level no longer covers.' }),
      atoms.length ? list : h('p', { class: 'small muted', text: 'This topic has no atoms to check.' })),
    h('div', { class: 'dock' },
      h('button', { class: 'btn', type: 'button', onclick: () => done(false) }, 'Done'),
      h('button', { class: 'btn primary', type: 'button', onclick: () => done(true) }, 'Done, review dropped today')));
}
