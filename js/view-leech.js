// Leeches: atoms suspended after repeated lapses. A Rebuild card offers three fixes:
// write a mnemonic, split the atom into smaller ones, or attach a contrast with the atom
// it keeps getting mixed up with. Rebuilding unsuspends the atom (or retires it, on split).

import { h, toast } from './ui.js';
import { app, allNodes, appendEvents, applyDerived } from './store.js';
import { call } from './data.js';
import { buildQueueNow } from './study.js';
import { atomPicker } from './sheets.js';
import { filled } from './cloze.js';
import { sourceLabel } from './view-library.js';
import { leechThreshold } from './rebuild.js';
import { STATE_NAMES } from './fsrs.js';
import { ulid } from './ulid.js';
import * as clock from './clock.js';
import { CAUSE_LIST } from './sheets.js';

export async function render(route) {
  if (route.name === 'rebuild') return rebuildCard(route.arg);
  const q = await buildQueueNow();
  const root = h('div', { class: 'leeches' },
    h('p', { class: 'intro', text: `An atom that lapses ${leechThreshold(app.state)} times is suspended: more of the same reviews would not fix it. Rebuild it and it returns to the queue today.` }));
  if (!q.leeches.length) {
    root.append(h('div', { class: 'card hint' }, h('p', { text: 'No leeches. Nothing is suspended.' })));
    return root;
  }
  for (const id of q.leeches) {
    const a = await app.db.get('atoms', id);
    if (!a) continue;
    const rec = app.state.atoms[id] || {};
    root.append(h('a', { class: 'card item deck', href: `#/rebuild/${encodeURIComponent(id)}`, 'data-nav': '' },
      h('p', { class: 'item-text', text: filled(a) }),
      h('p', { class: 'small muted', text: `${rec.card ? rec.card.lapses : 0} lapses · ${rec.reviews || 0} reviews` })));
  }
  return root;
}

async function rebuildCard(atomId) {
  const atom = await app.db.get('atoms', atomId);
  const root = h('div', { class: 'rebuild' });
  if (!atom) {
    root.append(h('div', { class: 'card' }, h('p', { text: 'This atom is not installed.' }), h('a', { class: 'btn', href: '#/leeches' }, 'Back')));
    return root;
  }
  const rec = app.state.atoms[atomId] || {};
  const packs = new Map((await app.db.getAll('packs')).map((p) => [p.id, p]));
  const nodes = allNodes();
  const partners = Object.values(app.state.confusions).filter((c) => c.a === atomId || c.b === atomId).map((c) => (c.a === atomId ? c.b : c.a));
  const suggestions = [];
  for (const id of [...partners, ...(atom.confusables || [])]) {
    const x = await app.db.get('atoms', id);
    if (x && !suggestions.some((y) => y.id === x.id)) suggestions.push(x);
  }
  const causes = Object.entries(rec.causes || {}).map(([k, n]) => `${(CAUSE_LIST.find((c) => c[0] === k) || [k, k])[1]} ×${n}`).join(', ');

  const done = async (events, msg) => {
    try {
      await appendEvents(events);
      await applyDerived(await call('refresh'));
      toast(msg, { kind: 'ok' });
      location.hash = '#/leeches';
    } catch (e) {
      toast(`Could not save: ${e.message}`, { kind: 'error' });
    }
  };

  // Mnemonic
  const mn = h('textarea', { rows: '3', class: 'field-input', placeholder: 'A hook you will remember: an image, an acronym, a story…', 'aria-label': 'Mnemonic' });
  mn.value = rec.mnemonic || atom.mnemonic || '';
  // Split
  const parts = h('div', { class: 'parts' });
  const addPart = (text = '', answer = '') => {
    const f = h('textarea', { rows: '2', class: 'field-input', placeholder: 'Front (use ___ for the gap)', 'aria-label': 'Part front' });
    f.value = text;
    const b = h('input', { type: 'text', class: 'field-input', placeholder: 'Answer', 'aria-label': 'Part answer' });
    b.value = answer;
    parts.append(h('div', { class: 'part' }, f, b));
  };
  addPart(atom.text, String(atom.answer));
  addPart('', '');

  root.append(
    h('section', { class: 'card' },
      h('div', { class: 'item-head' }, h('span', { class: 'badge warn', text: rec.suspended ? 'Suspended' : 'Active' }), h('code', { class: 'item-id', text: atom.id })),
      h('p', { class: 'item-text', text: filled(atom) }),
      h('p', { class: 'small muted', text: `Source: ${sourceLabel(atom, packs, new Map())} · Topic: ${(atom.nodes || []).map((n) => (nodes.get(n) || { title: n }).title).join(', ')}` }),
      h('p', { class: 'small', text: `${rec.card ? `${rec.card.lapses} lapses, ${rec.reviews || 0} reviews, state ${STATE_NAMES[rec.card.state]}` : 'No reviews'}${causes ? ` · causes: ${causes}` : ''}` }),
      partners.length ? h('p', { class: 'small', text: `Confused with ${partners.length} atom${partners.length > 1 ? 's' : ''}.` }) : null),
    h('section', { class: 'card' },
      h('h2', { text: '1. Write a mnemonic' }),
      mn,
      h('div', { class: 'button-row' }, h('button', {
        class: 'btn primary', type: 'button',
        onclick: () => {
          const text = mn.value.trim();
          if (!text) { toast('Write the mnemonic first.', { kind: 'warn' }); return; }
          done([['atom.rebuilt', { atomId, kind: 'mnemonic', text }]], 'Rebuilt with a mnemonic. It is back in today’s queue.');
        },
      }, 'Save mnemonic'))),
    h('section', { class: 'card' },
      h('h2', { text: '2. Split it into smaller atoms' }),
      h('p', { class: 'small muted', text: 'Each part becomes your own atom on the same topic and source. The original retires.' }),
      parts,
      h('div', { class: 'button-row' },
        h('button', { class: 'btn', type: 'button', onclick: () => addPart() }, 'Add a part'),
        h('button', {
          class: 'btn primary', type: 'button',
          onclick: () => {
            const list = [...parts.querySelectorAll('.part')].map((p) => [p.querySelector('textarea').value.trim(), p.querySelector('input').value.trim()]).filter(([f, b]) => f && b);
            if (list.length < 2) { toast('Write at least two parts, each with a front and an answer.', { kind: 'warn' }); return; }
            const src = atom.source && atom.source.pack ? { pack: atom.source.pack, page: atom.source.page } : atom.source;
            const made = list.map(([text, answer]) => ({ id: `self.${ulid(clock.now())}`, type: atom.type || 'fact', text, answer, nodes: atom.nodes, source: src, origin: 'self', verify: false, stage: atom.stage, splitFrom: atomId }));
            done([...made.map((m) => ['atom.created', { atom: m }]), ['atom.rebuilt', { atomId, kind: 'split', into: made.map((m) => m.id) }]], `Split into ${made.length} atoms. They are in today’s queue.`);
          },
        }, 'Save the split'))),
    h('section', { class: 'card' },
      h('h2', { text: '3. Attach a contrast' }),
      h('p', { class: 'small muted', text: 'Pick the atom you keep mixing it up with: a contrast card for the pair is scheduled today.' }),
      h('div', { class: 'button-row' }, h('button', {
        class: 'btn primary', type: 'button',
        onclick: async () => {
          const other = await atomPicker({ title: 'Mixed up with which atom?', exclude: [atomId], suggestions });
          if (other) done([['atom.rebuilt', { atomId, kind: 'contrast', with: other.id }]], 'Contrast attached and scheduled today.');
        },
      }, 'Choose the other atom'))));
  return root;
}
