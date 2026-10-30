// Rebuilds every cache from the event log and the content stores. The reads and the cache
// writes share one transaction, so an event appended meanwhile can never be overwritten by
// an older snapshot. Runs in the data worker after imports, uninstalls and exports.

import { CONTENT_STORES } from './db.js';
import { rebuild } from './rebuild.js';
import { profileContext } from './profiles.js';
import { scanIntegrity, countByNode, countBySubtree, quarantineCount } from './integrity.js';

function compute(data) {
  const content = { packs: data.packs };
  for (const s of CONTENT_STORES) content[s] = data[s];
  const state = rebuild(data.events);
  const { starter } = profileContext(data.profiles);
  const integrity = scanIntegrity(content, starter, state);
  const nodeCounts = countByNode(content);
  const parentOf = new Map();
  for (const n of starter.values()) parentOf.set(n.id, n.parent);
  for (const n of content.nodes) parentOf.set(n.id, n.parent);
  const subtreeCounts = countBySubtree(content, parentOf);
  const counts = { packs: content.packs.length, events: data.events.length };
  for (const s of CONTENT_STORES) counts[s] = content[s].length;
  const summary = {
    counts,
    quarantine: quarantineCount(content.atoms, state),
    orphans: integrity.orphans.length,
    orphanStates: integrity.orphanStates.length,
  };
  return { state, integrity, nodeCounts, subtreeCounts, summary };
}

export async function refreshDerived(db) {
  const reads = ['events', 'profiles', 'packs', ...CONTENT_STORES];
  const holder = {};
  await db.tx([...reads, 'cache'], 'readwrite', (s) => {
    const data = {};
    let pending = reads.length;
    for (const name of reads) {
      const r = s[name].getAll();
      r.onsuccess = () => {
        data[name] = r.result;
        if (--pending) return;
        // Still inside the transaction: compute synchronously, then write the caches.
        const d = compute(data);
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
