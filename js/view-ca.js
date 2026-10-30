// CA–Static Bridge. #/ca: months of current affairs; #/ca/<YYYY-MM>: a month, with
// reconciliation (every item anchored to a static topic before the month can be marked
// done); #/ca/item/<id>: why in news → static anchors → Prelims atoms → Mains angle →
// probable questions, plus connected stories and related PYQs and static atoms.

import { h, clear, toast } from './ui.js';
import { app, allNodes, appendEvents, emit } from './store.js';
import { call } from './data.js';
import { nodePicker } from './sheets.js';
import { filled } from './cloze.js';
import { archiveDay, DEFAULT_SHELF_DAYS } from './queue.js';
import { quarantineStatus } from './rebuild.js';
import * as clock from './clock.js';
import { formatDate, localDate, addDays, plural } from './util.js';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const monthName = (m) => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;

// Anchors that count: the item's own plus those added on a device, that resolve to a topic.
export function anchorsOf(x, nodes = allNodes()) {
  const added = Object.keys(app.state.caAnchors[x.id] || {});
  const all = [...new Set([...(x.anchors || []), ...added])];
  return { all, resolved: all.filter((id) => nodes.has(id)), added: new Set(added) };
}

export const isAnchored = (x, nodes) => anchorsOf(x, nodes).resolved.length > 0;

// CA items anchored to a topic (for the topic page's "In the news" chips).
export async function newsFor(nodeId) {
  const nodes = allNodes();
  return (await app.db.getAll('ca')).filter((x) => anchorsOf(x, nodes).resolved.includes(nodeId)).sort((a, b) => (a.date < b.date ? 1 : -1));
}

export async function render(route) {
  const arg = route.arg || '';
  if (arg.startsWith('item/')) return itemView(arg.slice(5));
  if (/^\d{4}-\d{2}$/.test(arg)) return monthView(arg);
  return hub();
}

async function hub() {
  const nodes = allNodes();
  const items = await app.db.getAll('ca');
  const months = new Map();
  for (const x of items) {
    const m = String(x.date).slice(0, 7);
    const g = months.get(m) || { n: 0, anchored: 0 };
    g.n++;
    if (isAnchored(x, nodes)) g.anchored++;
    months.set(m, g);
  }
  const list = [...months.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1));
  const open = list.filter(([m]) => !(app.state.caMonths[m] && app.state.caMonths[m].done)).length;
  return h('div', { class: 'ca-hub' },
    h('section', { class: 'card' },
      h('h2', { text: 'CA–Static Bridge' }),
      h('p', { class: 'small muted', text: `Every current-affairs item is anchored to a static topic: why it is in the news, the static anchor, the Prelims facts, the Mains angle and probable questions. CA facts count for Prelims for their shelf life (${DEFAULT_SHELF_DAYS} days by default), then archive; they stay searchable. A month closes only when every item is anchored.` }),
      list.length ? h('p', { class: 'small', text: `${plural(list.length, 'month')}, ${open} open.` }) : h('p', { class: 'muted', text: 'No current affairs yet. Forge a month with F3 (one month per run) and import it in Data; the demo pack has three items.' })),
    list.length ? h('div', { class: 'stack' }, list.map(([m, g]) => {
      const done = app.state.caMonths[m] && app.state.caMonths[m].done;
      return h('a', { class: 'card item ca-month', href: `#/ca/${m}`, 'data-nav': '' },
        h('div', { class: 'row-between' }, h('strong', { text: monthName(m) }), h('span', { class: `badge ${done ? 'ok' : g.anchored < g.n ? 'warn' : 'muted'}`, text: done ? 'Done' : g.anchored < g.n ? `${g.n - g.anchored} unanchored` : 'Ready to close' })),
        h('span', { class: 'small muted', text: `${plural(g.n, 'item')} · ${g.anchored} anchored` }));
    })) : null);
}

async function monthView(month) {
  const nodes = allNodes();
  const items = (await app.db.getAll('ca')).filter((x) => String(x.date).startsWith(month)).sort((a, b) => (a.date < b.date ? -1 : 1));
  const unanchored = items.filter((x) => !isAnchored(x, nodes));
  const done = app.state.caMonths[month] && app.state.caMonths[month].done;
  const toggle = h('button', {
    class: `btn ${done ? '' : 'primary'}`, type: 'button', disabled: !done && unanchored.length > 0,
    onclick: async () => {
      await appendEvents([['ca.monthDone', { month, done: !done }]]);
      toast(done ? `${monthName(month)} reopened.` : `${monthName(month)} marked done.`, { kind: 'ok' });
      emit('rerender');
    },
  }, done ? 'Reopen month' : 'Mark month done');
  return h('div', { class: 'ca-month-view' },
    h('nav', { class: 'crumbs' }, h('a', { href: '#/ca' }, 'CA–Static Bridge'), ' / ', monthName(month)),
    h('section', { class: 'card' },
      h('h2', { text: monthName(month) }),
      h('p', { class: 'small', text: `${plural(items.length, 'item')}, ${items.length - unanchored.length} anchored.` }),
      !done && unanchored.length ? h('p', { class: 'warn-text small', text: `Anchor ${unanchored.length === 1 ? 'the last item' : `these ${unanchored.length} items`} to a static topic before closing the month.` }) : null,
      toggle),
    h('div', { class: 'stack' }, items.map((x) => {
      const a = anchorsOf(x, nodes);
      return h('a', { class: 'card item ca-row', href: `#/ca/item/${encodeURIComponent(x.id)}`, 'data-nav': '' },
        h('div', { class: 'row-between' }, h('span', { class: 'badge kind-ca', text: formatDate(x.date) }), a.resolved.length ? h('span', { class: 'badge ok', text: `${plural(a.resolved.length, 'anchor')}` }) : h('span', { class: 'badge warn', text: 'Unanchored' })),
        h('strong', { text: x.headline }),
        h('span', { class: 'small muted', text: x.whyInNews }));
    })));
}

async function itemView(id) {
  const x = await app.db.get('ca', id);
  if (!x) return h('div', { class: 'card' }, h('p', { text: 'This item is not installed.' }), h('a', { class: 'btn', href: '#/ca' }, 'CA–Static Bridge'));
  const nodes = allNodes();
  const a = anchorsOf(x, nodes);
  const today = localDate(clock.now());
  const dayStart = new Date(clock.now()).setHours(0, 0, 0, 0);
  const caShelf = new Map((x.atoms || []).map((aid) => [aid, x.shelfLifeDays]));
  const atoms = (await Promise.all((x.atoms || []).map((aid) => app.db.get('atoms', aid)))).filter(Boolean);
  const live = atoms.filter((t) => { const q = quarantineStatus(t, app.state); return q === 'clear' || q === 'approved'; });
  const atomRow = (t) => {
    const end = archiveDay(t, caShelf);
    const status = end === null ? h('span', { class: 'badge muted', text: 'Static fact' })
      : dayStart > end ? h('span', { class: 'badge muted', text: `Archived ${formatDate(localDate(end))}` })
        : h('span', { class: 'badge ok', text: `Counts until ${formatDate(localDate(end))}` });
    return h('li', null, h('span', { text: filled(t) }), ' ', status);
  };
  const related = h('div', null, h('p', { class: 'small muted', text: 'Finding related PYQs and static atoms…' }));
  const mainsQs = (x.probableQs || []).map((p, i) => ({ ...p, i })).filter((p) => p.stage === 'mains');
  const root = h('div', { class: 'ca-item' },
    h('nav', { class: 'crumbs' }, h('a', { href: '#/ca' }, 'CA–Static Bridge'), ' / ', h('a', { href: `#/ca/${String(x.date).slice(0, 7)}` }, monthName(String(x.date).slice(0, 7)))),
    h('section', { class: 'card bridge-step' },
      h('p', { class: 'step-label', text: '1 · Why in news' }),
      h('h2', { text: x.headline }),
      h('p', { class: 'small muted', text: `${formatDate(x.date)} · counts for Prelims until ${formatDate(addDays(x.date, x.shelfLifeDays))} (${x.shelfLifeDays}-day shelf life)${addDays(x.date, x.shelfLifeDays) < today ? ' · archived' : ''}` }),
      h('p', { text: x.whyInNews })),
    h('section', { class: 'card bridge-step' },
      h('p', { class: 'step-label', text: '2 · Static anchors' }),
      h('div', { class: 'chips' }, a.all.map((nid) => {
        const n = nodes.get(nid);
        return h('span', { class: `chip${n ? '' : ' missing'}` },
          n ? h('a', { href: `#/node/${encodeURIComponent(nid)}` }, n.title) : `${nid} (topic not installed)`,
          a.added.has(nid) ? h('button', { class: 'chip-x', type: 'button', 'aria-label': `Remove anchor ${n ? n.title : nid}`, onclick: async () => { await appendEvents([['ca.anchored', { caId: x.id, nodeId: nid, remove: true }]]); emit('rerender'); } }, '×') : null);
      })),
      !a.resolved.length ? h('p', { class: 'warn-text small', text: 'Not anchored to an installed topic yet: add one, or the month cannot close.' }) : null,
      h('button', { class: 'btn small', type: 'button', onclick: async () => { const nid = await nodePicker({ title: 'Anchor to which static topic?', suggestions: a.resolved }); if (nid) { await appendEvents([['ca.anchored', { caId: x.id, nodeId: nid }]]); emit('rerender'); } } }, 'Add an anchor')),
    h('section', { class: 'card bridge-step' },
      h('p', { class: 'step-label', text: '3 · Prelims facts' }),
      atoms.length ? h('ul', { class: 'plain bridge-atoms' }, atoms.map(atomRow)) : h('p', { class: 'small muted', text: 'No atoms listed for this item.' }),
      live.length ? h('a', { class: 'btn small', href: `#/practice/atoms?ids=${live.map((t) => encodeURIComponent(t.id)).join(',')}` }, `Review ${live.length > 1 ? `these ${live.length}` : 'this'} now`) : null),
    h('section', { class: 'card bridge-step' },
      h('p', { class: 'step-label', text: '4 · Mains angle' }),
      (x.mainsAngle || []).length ? h('ul', { class: 'plain' }, x.mainsAngle.map((m) => h('li', { text: m }))) : h('p', { class: 'small muted', text: 'No Mains angle given.' })),
    h('section', { class: 'card bridge-step' },
      h('p', { class: 'step-label', text: '5 · Probable questions' }),
      (x.probableQs || []).length ? h('ul', { class: 'plain' }, x.probableQs.map((p) => h('li', null, h('span', { class: 'badge muted', text: p.stage === 'mains' ? 'Mains' : 'Prelims' }), ' ', p.text))) : h('p', { class: 'small muted', text: 'None given.' }),
      mainsQs.length ? h('a', { class: 'btn small', href: `#/mains/sprint?refs=${mainsQs.map((p) => encodeURIComponent(`ca:${x.id}#${p.i}`)).join(',')}` }, 'Skeleton sprint on the Mains questions') : null),
    (x.connections || []).length ? h('section', { class: 'card' }, h('h3', { text: 'Same story in other months' }),
      h('div', { class: 'chips' }, x.connections.map((cid) => h('a', { class: 'chip', href: `#/ca/item/${encodeURIComponent(cid)}` }, cid)))) : null,
    h('section', { class: 'card' }, h('h3', { text: 'Related PYQs and static atoms' }), related));
  relatedFor(x, related).catch(() => clear(related).append(h('p', { class: 'small muted', text: 'Search is unavailable right now.' })));
  return root;
}

// Top related PYQs and static atoms by a library search on the item's words.
export async function relatedFor(x, host) {
  const q = `${x.headline} ${x.whyInNews}`.replace(/[^\p{L}\p{N}\s-]/gu, ' ').split(/\s+/).filter((w) => w.length > 3).slice(0, 14).join(' ');
  const own = new Set(x.atoms || []);
  const [pyqs, atoms] = await Promise.all([call('search', { q, kinds: ['pyq'], limit: 3 }), call('search', { q, kinds: ['atom'], limit: 8 })]);
  const statics = atoms.filter((r) => !own.has(r.refId)).slice(0, 3);
  clear(host);
  if (!pyqs.length && !statics.length) { host.append(h('p', { class: 'small muted', text: 'Nothing related found in your library yet.' })); return; }
  if (pyqs.length) host.append(h('p', { class: 'small muted', text: 'PYQs' }), h('ul', { class: 'plain small' }, pyqs.map((r) => h('li', null, h('a', { href: `#/node/${encodeURIComponent(r.nodeId || '')}?focus=${encodeURIComponent(r.refId)}` }, r.label.slice(0, 160))))));
  if (statics.length) host.append(h('p', { class: 'small muted', text: 'Static atoms' }), h('ul', { class: 'plain small' }, statics.map((r) => h('li', null, h('a', { href: `#/node/${encodeURIComponent(r.nodeId || '')}?focus=${encodeURIComponent(r.refId)}` }, r.label.slice(0, 160))))));
}
