// Quarantine deck: atoms with origin "model" or verify:true wait here until approved.

import { h, toast } from './ui.js';
import { app, allNodes, appendEvent, setDerived } from './store.js';
import { call } from './data.js';
import { contentHash } from './util.js';
import { gapText, sourceLabel } from './view-library.js';

let refreshTimer = null;
const refreshSoon = () => {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(async () => setDerived(await call('refresh')), 600);
};

export async function render() {
  const [list, packList] = await Promise.all([call('quarantine.list'), app.db.getAll('packs')]);
  const packs = new Map(packList.map((p) => [p.id, p]));
  const pyqIds = new Set(list.quarantined.concat(list.discarded).map((a) => a.source && a.source.pyq).filter(Boolean));
  const pyqs = new Map();
  for (const id of pyqIds) { const q = await app.db.get('pyqs', id); if (q) pyqs.set(id, q); }
  const nodes = allNodes();

  const root = h('div', { class: 'quarantine' });
  root.append(h('p', { class: 'intro', text: 'Atoms written by AI (origin "model") or flagged "verify" stay here until you check them against the source. Approving releases an atom to the study queue (from Phase 2); discarding keeps it out.' }));

  const counter = h('p', { class: 'scope-line' });
  const setCounter = (n) => { counter.textContent = n ? `${n} waiting · ${list.approved} approved so far` : `Nothing waiting · ${list.approved} approved so far`; };
  let waiting = list.quarantined.length;
  setCounter(waiting);
  root.append(counter);

  const card = (a, discarded) => {
    const el = h('article', { class: 'card item', tabindex: '0', 'data-nav': '', id: `item-${a.id}` });
    const why = [a.origin === 'model' ? 'added by AI' : null, a.verify ? 'marked verify' : null].filter(Boolean).join(' and ');
    const act = async (type, label) => {
      for (const b of el.querySelectorAll('button')) b.disabled = true;
      try {
        await appendEvent(type, type === 'atom.restored' ? { atomId: a.id } : { atomId: a.id, hash: contentHash(a) });
        el.replaceWith(h('p', { class: 'card muted small', text: `${label}: ${a.id}` }));
        if (!discarded) setCounter(--waiting);
        refreshSoon();
      } catch (e) {
        toast(`Could not save: ${e.message}`, { kind: 'error' });
        for (const b of el.querySelectorAll('button')) b.disabled = false;
      }
    };
    el.append(...[
      h('div', { class: 'item-head' }, h('span', { class: 'badge', text: a.type }), h('span', { class: 'badge warn', text: why }), h('code', { class: 'item-id', text: a.id })),
      h('p', { class: 'item-text' }, gapText(a.text)),
      h('p', { class: 'answer' }, h('span', { class: 'muted', text: 'Answer: ' }), String(a.answer)),
      h('p', { class: 'source' }, h('span', { class: 'muted', text: 'Source: ' }), sourceLabel(a, packs, pyqs)),
      a.note ? h('p', { class: 'small' }, h('span', { class: 'muted', text: 'Note: ' }), a.note) : null,
      h('p', { class: 'small muted' }, 'Topic: ', (a.nodes || []).map((id, i) => [i ? ', ' : '', h('a', { href: `#/node/${encodeURIComponent(id)}` }, nodes.get(id) ? nodes.get(id).title : id)])),
      h('div', { class: 'card-actions' }, discarded
        ? [h('button', { class: 'btn', onclick: () => act('atom.restored', 'Back in Quarantine') }, 'Restore to Quarantine')]
        : [
          h('button', { class: 'btn', onclick: () => act('atom.discarded', 'Discarded') }, 'Discard'),
          h('button', { class: 'btn primary', onclick: () => act('atom.approved', 'Approved') }, 'Approve'),
        ])].filter(Boolean));
    return el;
  };

  if (!list.quarantined.length) {
    root.append(h('div', { class: 'card hint' }, h('p', { text: 'Nothing is waiting for review.' })));
  } else {
    root.append(h('div', { class: 'stack' }, list.quarantined.map((a) => card(a, false))));
  }
  if (list.discarded.length) {
    root.append(h('details', { class: 'card' }, h('summary', { text: `Discarded (${list.discarded.length})` }),
      h('div', { class: 'stack' }, list.discarded.map((a) => card(a, true)))));
  }
  return root;
}
