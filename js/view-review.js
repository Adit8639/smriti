// Review and practice sessions in focus mode (no navigation bar; actions at the bottom).
// #/review: today's queue. #/practice/<nodeId>: a topic's atoms, schedule unchanged.
// #/practice/probe/<probeId>: one probe, e.g. to try a match-the-list on purpose.

import { h, clear } from './ui.js';
import { app, allNodes } from './store.js';
import { Session, summaryView } from './session.js';
import { buildQueueNow } from './study.js';
import { formatDateTime } from './util.js';
import { quarantineStatus } from './rebuild.js';

let current = null;

export function leave() {
  document.body.classList.remove('focus');
  if (current && !current.ended) current.finish(true);
  current = null;
}

function frame(body) {
  return h('div', { class: 'focus-frame' }, body);
}

async function run(host, make) {
  document.body.classList.add('focus');
  const s = await make();
  if (!s) return;
  current = s;
  await s.start();
}

function doneScreen(host, sum, { title, counts, again }) {
  document.body.classList.remove('focus');
  const actions = [h('a', { class: 'btn primary', href: '#/today' }, 'Back to Today')];
  if (again) actions.push(h('button', { class: 'btn', type: 'button', onclick: again }, 'Review more'));
  clear(host).append(frame(summaryView(sum, { title, counts, actions })));
}

export async function render(route) {
  const host = h('div', { class: 'review-host' });
  const nodes = allNodes();

  if (route.name === 'review') {
    const start = async () => {
      const q = await buildQueueNow();
      if (!q.items.length) {
        document.body.classList.remove('focus');
        clear(host).append(frame(h('div', { class: 'card summary' },
          h('h2', { text: 'Nothing due right now' }),
          h('p', { text: q.nextDue ? `Next review: ${formatDateTime(q.nextDue)}.` : 'Import packs or add atoms to start reviewing.' }),
          q.counts.overflow ? h('p', { class: 'small warn-text', text: `${q.counts.overflow} reviews are over today's cap.` }) : null,
          h('div', { class: 'button-row' }, h('a', { class: 'btn primary', href: '#/today' }, 'Back to Today')))));
        return null;
      }
      return new Session({ host, mode: 'review', items: q.items, title: 'Review', counts: q.counts, onEnd: (sum) => doneScreen(host, sum, { title: 'Review done', counts: q.counts, again: () => run(host, start) }) });
    };
    setTimeout(() => run(host, start), 0);
    return host;
  }

  // Practice
  const arg = route.arg || '';
  if (arg.startsWith('probe/')) {
    const probeId = arg.slice(6);
    setTimeout(() => run(host, async () => {
      const probe = await app.db.get('probes', probeId);
      if (!probe) { clear(host).append(frame(h('div', { class: 'card' }, h('p', { text: 'That probe is not installed.' })))); return null; }
      const from = route.query.get('from') || '';
      return new Session({
        host, mode: 'practice', items: [{ type: 'probe', probe, atomId: probe.atoms[0], kind: 'practice' }], title: 'Practice',
        onEnd: (sum) => doneScreen(host, sum, { title: 'Practice done', again: () => { location.hash = `#/practice/probe/${encodeURIComponent(probeId)}?from=${encodeURIComponent(from)}&r=${Date.now()}`; } }),
      });
    }), 0);
    return host;
  }
  const nodeId = arg;
  setTimeout(() => run(host, async () => {
    const atoms = (await app.db.getAllByIndex('atoms', 'nodes', nodeId)).filter((a) => {
      const q = quarantineStatus(a, app.state);
      return (q === 'clear' || q === 'approved') && !(app.state.atoms[a.id] && app.state.atoms[a.id].retired);
    });
    if (!atoms.length) { clear(host).append(frame(h('div', { class: 'card' }, h('p', { text: 'This topic has no atoms to practise yet.' }), h('a', { class: 'btn', href: `#/node/${encodeURIComponent(nodeId)}` }, 'Back')))); return null; }
    const node = nodes.get(nodeId);
    const items = atoms.map((a) => ({ type: 'atom', atomId: a.id, kind: 'practice', node: nodeId }));
    return new Session({ host, mode: 'practice', items, title: `Practice: ${node ? node.title : nodeId}`, nodeId, onEnd: (sum) => doneScreen(host, sum, { title: 'Practice done' }) });
  }), 0);
  return host;
}
