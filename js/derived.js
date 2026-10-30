// Derived caches: integrity, per-topic counts, the Quarantine count and the self-made atoms
// materialised into the atoms store (as pack "@self", rebuilt from atom.created events).
// Content reads and cache writes share one transaction. Runs in the data worker.

import { CONTENT_STORES } from './db.js';
import { rebuild } from './rebuild.js';
import { profileContext } from './profiles.js';
import { scanIntegrity, countByNode, countBySubtree, quarantineCount } from './integrity.js';
import { stableStringify } from './util.js';

export const SELF_PACK = '@self';

export const selfItems = (state) => Object.values(state.self).map((a) => ({ ...a, _pack: SELF_PACK, _v: 1 }));

function compute(data, state) {
  const self = selfItems(state);
  const content = { packs: data.packs };
  for (const s of CONTENT_STORES) content[s] = data[s];
  content.atoms = data.atoms.filter((a) => a._pack !== SELF_PACK).concat(self);
  const { starter } = profileContext(data.profiles);
  const integrity = scanIntegrity(content, starter, state);
  const nodeCounts = countByNode(content);
  const parentOf = new Map();
  for (const n of starter.values()) parentOf.set(n.id, n.parent);
  for (const n of content.nodes) parentOf.set(n.id, n.parent);
  const subtreeCounts = countBySubtree(content, parentOf);
  const counts = { packs: content.packs.length, events: state.count };
  for (const s of CONTENT_STORES) counts[s] = content[s].length;
  counts.self = self.length;
  const summary = {
    counts,
    quarantine: quarantineCount(content.atoms, state),
    orphans: integrity.orphans.length,
    orphanStates: integrity.orphanStates.length,
  };
  return { state, integrity, nodeCounts, subtreeCounts, summary, self };
}

// state: the current rebuilt state (the worker keeps it in step with the log); when omitted
// it is rebuilt from the whole event log.
export async function refreshDerived(db, state = null) {
  const st = state || rebuild(await db.getAll('events'));
  const reads = ['profiles', 'packs', ...CONTENT_STORES];
  const holder = {};
  await db.tx([...reads, 'cache'], 'readwrite', (s) => {
    const data = {};
    let pending = reads.length;
    for (const name of reads) {
      const r = s[name].getAll();
      r.onsuccess = () => {
        data[name] = r.result;
        if (--pending) return;
        // Still inside the transaction: compute synchronously, then write.
        const d = compute(data, st);
        const have = new Map(data.atoms.filter((a) => a._pack === SELF_PACK).map((a) => [a.id, a]));
        for (const a of d.self) {
          const old = have.get(a.id);
          if (!old || stableStringify(old) !== stableStringify(a)) s.atoms.put(a);
          have.delete(a.id);
        }
        for (const id of have.keys()) s.atoms.delete(id);
        delete d.self;
        holder.value = d;
        s.cache.put({ key: 'state', value: d.state });
        s.cache.put({ key: 'integrity', value: d.integrity });
        s.cache.put({ key: 'nodeCounts', value: d.nodeCounts });
        s.cache.put({ key: 'subtreeCounts', value: d.subtreeCounts });
        s.cache.put({ key: 'summary', value: d.summary });
      };
    }
  });
  return holder.value;
}
