// Page side of the sentence-embedding model: load it on request, embed texts, keep topic
// vectors in the cache store, and re-rank topic suggestions by meaning.

import { app } from './store.js';
import { fnv1a } from './util.js';

export const MODEL_ID = 'all-MiniLM-L6-v2/q8@afdb6f1a';
export const MODEL_MB = 34;
export const LAZY_CACHE = 'smriti-lazy-v1';
let worker = null;
let seq = 0;
const pending = new Map();

function getWorker() {
  if (!worker) {
    worker = new Worker(new URL('./embed-worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => {
      const { id, ok, result, error, progress } = e.data || {};
      const p = pending.get(id);
      if (!p) return;
      if (progress) { if (p.onProgress) p.onProgress(progress); return; }
      pending.delete(id);
      if (ok) p.resolve(result); else p.reject(new Error(error));
    };
    worker.onerror = (e) => {
      for (const p of pending.values()) p.reject(new Error(e.message || 'The model worker failed to start.'));
      pending.clear();
      worker = null;
    };
  }
  return worker;
}

function send(cmd, data = {}, onProgress = null) {
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject, onProgress });
    getWorker().postMessage({ id, cmd, ...data });
  });
}

// True when the model files are already on this device.
export async function modelCached() {
  try {
    const c = await caches.open(LAZY_CACHE);
    return !!(await c.match(new URL('vendor/minilm/all-MiniLM-L6-v2-q8.onnx', document.baseURI).href));
  } catch (_) {
    return false;
  }
}

export const loadModel = (onProgress) => send('load', {}, onProgress);
export const embed = (texts, onProgress) => send('embed', { texts }, onProgress);

const nodeText = (n) => [n.title, ...(n.keywords || []), n.description || ''].join('. ');

// Vectors for topics, computed once per topic text and kept in the cache store.
export async function nodeVectors(nodes, onProgress) {
  const rec = await app.db.get('cache', 'nodeVectors');
  const have = rec && rec.value && rec.value.model === MODEL_ID ? rec.value.vecs : {};
  const want = nodes.map((n) => ({ id: n.id, key: fnv1a(nodeText(n)), text: nodeText(n) }));
  const missing = want.filter((w) => !have[w.id] || have[w.id].key !== w.key);
  if (missing.length) {
    const vecs = await embed(missing.map((m) => m.text), onProgress);
    missing.forEach((m, i) => { have[m.id] = { key: m.key, v: vecs[i] }; });
    await app.db.put('cache', { key: 'nodeVectors', value: { model: MODEL_ID, vecs: have } });
  }
  return new Map(want.map((w) => [w.id, have[w.id].v]));
}

const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };

// Re-ranks each candidate's topics: 60% meaning (cosine) and 40% keywords; page-map
// topics stay first.
export function rerank(candidates, candVecs, nodeVecs, top = 3) {
  const ids = [...nodeVecs.keys()];
  return candidates.map((c, i) => {
    const v = candVecs[i];
    const kw = new Map((c.nodes || []).filter((n) => n.by === 'keywords').map((n) => [n.nodeId, n.score]));
    const fixed = (c.nodes || []).filter((n) => n.by === 'page map');
    const scored = ids.map((id) => {
      const cos = dot(v, nodeVecs.get(id));
      return { nodeId: id, cos, score: 0.6 * cos + 0.4 * (kw.get(id) || 0) };
    }).sort((a, b) => b.score - a.score);
    const picked = scored.filter((s) => !fixed.some((f) => f.nodeId === s.nodeId)).slice(0, top - fixed.length)
      .map((s) => ({ nodeId: s.nodeId, score: Math.round(s.score * 100) / 100, by: kw.has(s.nodeId) ? 'meaning + keywords' : 'meaning' }));
    return { ...c, nodes: [...fixed, ...picked] };
  });
}
