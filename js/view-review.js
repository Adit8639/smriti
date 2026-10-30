// Review and practice sessions in focus mode (no navigation bar; actions at the bottom).
// #/review: today's queue. #/practice/<nodeId>: a topic's atoms, schedule unchanged.
// #/practice/probe/<probeId>: one probe, e.g. to try a match-the-list on purpose.

import { h, clear } from './ui.js';
import { app, allNodes } from './store.js';
import { Session, summaryView } from './session.js';
import { buildQueueNow } from './study.js';
import { formatDateTime } from './util.js';
import { quarantineStatus } from './rebuild.js';
import { call } from './data.js';

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
  if (!s || !host.isConnected) return;
  current = s;
  await s.start();
}

function doneScreen(host, sum, { title, counts, again, back = null }) {
  // A session ended by leaving the screen must not touch the next screen.
  if (!host.isConnected) return;
  document.body.classList.remove('focus');
  const actions = [back ? h('a', { class: 'btn primary', href: back[0] }, back[1]) : h('a', { class: 'btn primary', href: '#/today' }, 'Back to Today')];
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
  if (arg === 'pyqs') {
    // A PYQ set chosen in the Prelims Lab (ids in sessionStorage under the route's token).
    setTimeout(() => run(host, async () => {
      let set = null;
      try { set = JSON.parse(sessionStorage.getItem(route.query.get('set') || '') || 'null'); } catch (_) { set = null; }
      const pyqs = set && Array.isArray(set.ids) ? await call('lab.pyqsByIds', { ids: set.ids }) : [];
      if (!pyqs.length) { document.body.classList.remove('focus'); clear(host).append(frame(h('div', { class: 'card' }, h('p', { text: 'This PYQ set has expired. Choose it again in the Prelims Lab.' }), h('a', { class: 'btn', href: '#/lab?tab=pyqs' }, 'Prelims Lab')))); return null; }
      const items = pyqs.map((q) => ({ type: 'pyq', pyq: q, kind: 'pyq', node: (q.nodes || [''])[0] }));
      return new Session({ host, mode: 'practice', items, title: set.title || 'PYQs', onEnd: (sum) => doneScreen(host, sum, { title: 'PYQ set done', back: ['#/lab?tab=pyqs', 'Back to PYQs'] }) });
    }), 0);
    return host;
  }
  if (arg === 'atoms') {
    // Chosen atoms: reviewed for real (FSRS), or as practice with ?mode=practice.
    setTimeout(() => run(host, async () => {
      const ids = (route.query.get('ids') || '').split(',').map((x) => decodeURIComponent(x)).filter(Boolean);
      const mode = route.query.get('mode') === 'practice' ? 'practice' : 'review';
      const atoms = (await Promise.all(ids.map((id) => app.db.get('atoms', id)))).filter((a) => {
        if (!a) return false;
        const q = quarantineStatus(a, app.state);
        const rec = app.state.atoms[a.id];
        return (q === 'clear' || q === 'approved') && !(rec && (rec.retired || rec.suspended));
      });
      if (!atoms.length) { document.body.classList.remove('focus'); clear(host).append(frame(h('div', { class: 'card' }, h('p', { text: 'None of these atoms can be reviewed right now (not installed, in Quarantine, or suspended).' }), h('a', { class: 'btn', href: '#/today' }, 'Back to Today')))); return null; }
      const items = atoms.map((a) => ({ type: 'atom', atomId: a.id, kind: mode === 'practice' ? 'practice' : 'due', node: (a.nodes || [''])[0] }));
      return new Session({ host, mode, items, title: mode === 'practice' ? 'Practice' : 'Review these', onEnd: (sum) => doneScreen(host, sum, { title: 'Done' }) });
    }), 0);
    return host;
  }
  if (arg === 'traps') {
    // Trap drill: statements built on the chosen trap tags, mixed with true statements.
    setTimeout(() => run(host, async () => {
      const tags = (route.query.get('tags') || '').split(',').filter(Boolean);
      const r = await call('traps.drill', { tags, n: 20, seed: `${Date.now()}` });
      if (!r.items.length) { document.body.classList.remove('focus'); clear(host).append(frame(h('div', { class: 'card' }, h('h2', { text: 'No statements for this trap yet' }), h('p', { text: 'Trap drills use statements from your probes and PYQs that carry these trap tags. Import packs with statement probes (Forge F1/F2).' }), h('a', { class: 'btn', href: '#/lab?tab=traps' }, 'Back to the Trap Log')))); return null; }
      const items = r.items.map((x) => ({ type: 'probe', kind: 'drill', atomId: x.atoms[0] || null, probe: { id: x.id, format: 'tf', atoms: x.atoms, stem: 'True or false?', statements: [{ text: x.text, true: x.true, trap: x.trap, reason: x.reason }], explanation: x.explanation, difficulty: 2 } }));
      return new Session({
        host, mode: 'practice', items, title: `Trap drill: ${tags.map((t) => t.replace(/-/g, ' ')).join(', ')}`,
        // A false statement judged true is the trap working; a true one judged false is overcaution.
        autoCause: (c) => { const st = c.probe.statements[0]; return st.true ? { cause: 'overthought' } : { cause: 'trap', trap: st.trap }; },
        onEnd: (sum) => doneScreen(host, sum, { title: 'Trap drill done', back: ['#/lab?tab=traps', 'Back to the Trap Log'] }),
      });
    }), 0);
    return host;
  }
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
