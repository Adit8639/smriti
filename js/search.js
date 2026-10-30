// Full-text search over nodes, atoms, PYQs and CA items with the vendored MiniSearch.
// The index lives in the data worker and is rebuilt after content changes.

import MiniSearch from '../vendor/minisearch/minisearch.js';

const fill = (text, answer) => (typeof text === 'string' ? text.replace(/_{3,}/g, `[${answer}]`) : '');

export function buildIndex(nodes, content) {
  const ms = new MiniSearch({
    fields: ['title', 'text'],
    storeFields: ['kind', 'label', 'nodeId', 'refId'],
    searchOptions: { prefix: true, fuzzy: 0.2, boost: { title: 3 } },
  });
  const docs = [];
  for (const n of nodes) {
    docs.push({ id: `n:${n.id}`, kind: 'node', label: n.title, title: n.title, text: [n.id, ...(n.keywords || []), n.description || ''].join(' '), nodeId: n.id, refId: n.id });
  }
  for (const a of content.atoms) {
    const label = fill(a.text, a.answer);
    docs.push({ id: `a:${a.id}`, kind: 'atom', label, title: '', text: `${label} ${a.answer} ${(a.tags || []).join(' ')}`, nodeId: (a.nodes || [])[0] || null, refId: a.id });
  }
  for (const q of content.pyqs) {
    docs.push({ id: `q:${q.id}`, kind: 'pyq', label: `${q.year}: ${q.stem}`, title: '', text: `${q.stem} ${(q.options || []).join(' ')}`, nodeId: (q.nodes || [])[0] || null, refId: q.id });
  }
  for (const x of content.ca) {
    docs.push({ id: `c:${x.id}`, kind: 'ca', label: x.headline, title: x.headline, text: x.whyInNews || '', nodeId: (x.anchors || [])[0] || null, refId: x.id });
  }
  ms.addAll(docs);
  return ms;
}

export function runSearch(ms, q, limit = 40) {
  const query = q.trim();
  if (!query) return [];
  let hits = ms.search(query, { combineWith: 'AND' });
  if (!hits.length) hits = ms.search(query);
  return hits.slice(0, limit).map((h) => ({ kind: h.kind, label: h.label, nodeId: h.nodeId, refId: h.refId, score: h.score }));
}
