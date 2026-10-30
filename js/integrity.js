// Pure scans over installed content: orphaned references, per-node counts and the
// Quarantine count. The data worker writes their results to the cache store.

import { isObj } from './util.js';
import { quarantineStatus } from './rebuild.js';

// content: {nodes, atoms, probes, pyqs, ca, answers, notes, packs} as arrays
// starter: Map of profile starter nodes
export function scanIntegrity(content, starter, state) {
  const nodeIds = new Set([...starter.keys(), ...content.nodes.map((n) => n.id)]);
  const atomIds = new Set(content.atoms.map((a) => a.id));
  const pyqIds = new Set(content.pyqs.map((q) => q.id));
  const caIds = new Set(content.ca.map((x) => x.id));
  const packIds = new Set(content.packs.map((p) => p.id));

  const orphans = [];
  const add = (store, item, missing) => {
    if (missing.length) orphans.push({ store, id: item.id, pack: item._pack, missing });
  };
  const miss = (list, set, kind) => (Array.isArray(list) ? list.filter((r) => !set.has(r)).map((r) => `${kind} ${r}`) : []);

  for (const n of content.nodes) add('nodes', n, typeof n.parent === 'string' && !nodeIds.has(n.parent) ? [`parent ${n.parent}`] : []);
  for (const a of content.atoms) {
    const m = miss(a.nodes, nodeIds, 'node').concat(miss(a.confusables, atomIds, 'atom'));
    if (isObj(a.source) && typeof a.source.pyq === 'string' && !pyqIds.has(a.source.pyq)) m.push(`pyq ${a.source.pyq}`);
    if (isObj(a.source) && typeof a.source.pack === 'string' && !packIds.has(a.source.pack)) m.push(`pack ${a.source.pack}`);
    add('atoms', a, m);
  }
  for (const q of content.probes) add('probes', q, miss(q.atoms, atomIds, 'atom'));
  for (const q of content.pyqs) add('pyqs', q, miss(q.nodes, nodeIds, 'node').concat(miss(q.atoms, atomIds, 'atom')));
  for (const x of content.ca) add('ca', x, miss(x.anchors, nodeIds, 'node').concat(miss(x.atoms, atomIds, 'atom'), miss(x.connections, caIds, 'ca')));
  for (const a of content.answers) add('answers', a, isObj(a.source) && !packIds.has(a.source.pack) ? [`pack ${a.source.pack}`] : []);
  for (const n of content.notes) add('notes', n, nodeIds.has(n.node) ? [] : [`node ${n.node}`]);

  // Learning history that points at atoms no longer installed: kept, flagged.
  const orphanStates = Object.keys(state.atoms).filter((id) => !atomIds.has(id));

  // Items left over from an older version of a pack (backup merges never delete).
  const packVersion = new Map(content.packs.map((p) => [p.id, p.version]));
  const stale = {};
  for (const store of ['nodes', 'atoms', 'probes', 'pyqs', 'ca', 'answers', 'notes']) {
    for (const x of content[store]) {
      const v = packVersion.get(x._pack);
      if (v !== undefined && x._v < v) stale[x._pack] = (stale[x._pack] || 0) + 1;
    }
  }

  return { orphans, orphanStates, stale };
}

// Direct (not rolled-up) counts per node id.
export function countByNode(content) {
  const counts = {};
  const bump = (id, k) => {
    const c = counts[id] || (counts[id] = { atoms: 0, probes: 0, pyqs: 0, ca: 0, notes: 0 });
    c[k]++;
  };
  const atomNodes = new Map();
  for (const a of content.atoms) {
    const ns = Array.isArray(a.nodes) ? a.nodes : [];
    atomNodes.set(a.id, ns);
    for (const n of ns) bump(n, 'atoms');
  }
  // A probe counts toward the nodes of the atoms it tests.
  for (const q of content.probes) {
    const ns = new Set();
    for (const id of q.atoms || []) for (const n of atomNodes.get(id) || []) ns.add(n);
    for (const n of ns) bump(n, 'probes');
  }
  for (const q of content.pyqs) for (const n of q.nodes || []) bump(n, 'pyqs');
  for (const x of content.ca) for (const n of x.anchors || []) bump(n, 'ca');
  for (const x of content.notes) bump(x.node, 'notes');
  return counts;
}

// Subtree counts: each item counts once for every node on the paths from its nodes up to
// the root, so an atom tagged to two sibling topics is not counted twice by their parent.
// parentOf: Map node id -> parent id
export function countBySubtree(content, parentOf) {
  const counts = {};
  const memo = new Map();
  const chain = (id) => {
    let c = memo.get(id);
    if (c) return c;
    c = [];
    const seen = new Set();
    let cur = id;
    while (typeof cur === 'string' && !seen.has(cur)) {
      seen.add(cur);
      c.push(cur);
      cur = parentOf.get(cur);
    }
    memo.set(id, c);
    return c;
  };
  const add = (nodeIds, k) => {
    const s = new Set();
    for (const n of nodeIds) for (const a of chain(n)) s.add(a);
    for (const a of s) {
      const c = counts[a] || (counts[a] = { atoms: 0, probes: 0, pyqs: 0, ca: 0, notes: 0 });
      c[k]++;
    }
  };
  const atomNodes = new Map();
  for (const a of content.atoms) {
    const ns = Array.isArray(a.nodes) ? a.nodes : [];
    atomNodes.set(a.id, ns);
    add(ns, 'atoms');
  }
  for (const q of content.probes) add((q.atoms || []).flatMap((id) => atomNodes.get(id) || []), 'probes');
  for (const q of content.pyqs) add(q.nodes || [], 'pyqs');
  for (const x of content.ca) add(x.anchors || [], 'ca');
  for (const x of content.notes) add([x.node], 'notes');
  return counts;
}

export function quarantineCount(atoms, state) {
  let n = 0;
  for (const a of atoms) if (quarantineStatus(a, state) === 'quarantined') n++;
  return n;
}
