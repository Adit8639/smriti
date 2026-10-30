// Sentence embeddings in a worker: all-MiniLM-L6-v2 (int8 ONNX, Apache-2.0, vendored in
// /vendor/minilm) on ONNX Runtime Web (WASM, one thread). Loaded on first use only; the
// service worker keeps the files for offline use. Messages in: {id, cmd: 'load' | 'embed',
// texts}. Messages out: {id, ok, result | error} and {id, progress: {loaded, total}}.

import * as ort from '../vendor/ort/ort.wasm.bundle.min.mjs';

const VENDOR = new URL('../vendor/', import.meta.url);
const MODEL_URL = new URL('minilm/all-MiniLM-L6-v2-q8.onnx', VENDOR).href;
const VOCAB_URL = new URL('minilm/vocab.txt', VENDOR).href;
const MODEL_SHA256 = 'afdb6f1a0e45b715d0bb9b11772f032c399babd23bfc31fed1c170afc848bdb1';
const DIM = 384;
const MAX_TOKENS = 128;

ort.env.wasm.wasmPaths = new URL('ort/', VENDOR).href;
ort.env.wasm.numThreads = 1;

let session = null;
let vocab = null;
let loading = null;

async function fetchWithProgress(url, onProgress) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url.split('/').pop()}: HTTP ${res.status}`);
  const total = Number(res.headers.get('content-length')) || 0;
  if (!res.body || !total) return new Uint8Array(await res.arrayBuffer());
  const reader = res.body.getReader();
  const out = new Uint8Array(total);
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (loaded + value.length > out.length) throw new Error('download larger than announced');
    out.set(value, loaded);
    loaded += value.length;
    onProgress(loaded, total);
  }
  return loaded === total ? out : out.slice(0, loaded);
}

const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

// ---- BERT tokenizer (uncased): basic split, then WordPiece over the vocab
const isPunct = (ch) => {
  const cp = ch.codePointAt(0);
  return (cp >= 33 && cp <= 47) || (cp >= 58 && cp <= 64) || (cp >= 91 && cp <= 96) || (cp >= 123 && cp <= 126) || /\p{P}/u.test(ch);
};
const isCjk = (cp) => (cp >= 0x4e00 && cp <= 0x9fff) || (cp >= 0x3400 && cp <= 0x4dbf) || (cp >= 0x20000 && cp <= 0x2a6df) || (cp >= 0xf900 && cp <= 0xfaff);
function basicTokens(text) {
  let s = '';
  for (const ch of String(text)) {
    const cp = ch.codePointAt(0);
    if (cp === 0 || cp === 0xfffd || /\p{C}/u.test(ch) && !/\s/.test(ch)) continue;
    s += /\s/.test(ch) ? ' ' : isCjk(cp) ? ` ${ch} ` : ch;
  }
  s = s.normalize('NFD').replace(/\p{Mn}/gu, '').toLowerCase();
  const out = [];
  for (const word of s.split(/\s+/)) {
    let cur = '';
    for (const ch of word) {
      if (isPunct(ch)) { if (cur) out.push(cur); out.push(ch); cur = ''; } else cur += ch;
    }
    if (cur) out.push(cur);
  }
  return out;
}
function wordPiece(word) {
  const chars = [...word];
  if (chars.length > 100) return [vocab.unk];
  const ids = [];
  let start = 0;
  while (start < chars.length) {
    let end = chars.length;
    let id;
    while (start < end) {
      const piece = (start ? '##' : '') + chars.slice(start, end).join('');
      id = vocab.ids.get(piece);
      if (id !== undefined) break;
      end--;
    }
    if (id === undefined) return [vocab.unk];
    ids.push(id);
    start = end;
  }
  return ids;
}
function encode(text) {
  const body = basicTokens(text).flatMap(wordPiece).slice(0, MAX_TOKENS - 2);
  return [vocab.cls, ...body, vocab.sep];
}

async function load(id) {
  if (session) return { ready: true };
  if (!loading) {
    loading = (async () => {
      const progress = (loaded, total) => self.postMessage({ id, progress: { loaded, total } });
      const [model, vocabText] = await Promise.all([fetchWithProgress(MODEL_URL, progress), fetch(VOCAB_URL).then((r) => { if (!r.ok) throw new Error(`vocab.txt: HTTP ${r.status}`); return r.text(); })]);
      const sha = hex(await crypto.subtle.digest('SHA-256', model));
      if (sha !== MODEL_SHA256) throw new Error('The model file is damaged (checksum mismatch). Delete the site data for SMRITI\'s model cache and try again online.');
      const tokens = vocabText.split('\n').slice(0, 30522);
      vocab = { ids: new Map(tokens.map((t, i) => [t, i])), cls: tokens.indexOf('[CLS]'), sep: tokens.indexOf('[SEP]'), unk: tokens.indexOf('[UNK]') };
      session = await ort.InferenceSession.create(model, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
    })().catch((e) => { loading = null; throw e; });
  }
  await loading;
  return { ready: true };
}

async function embedOne(text) {
  const ids = encode(text);
  const n = ids.length;
  const big = (f) => BigInt64Array.from({ length: n }, (_, i) => BigInt(f(i)));
  const feeds = {
    input_ids: new ort.Tensor('int64', big((i) => ids[i]), [1, n]),
    attention_mask: new ort.Tensor('int64', big(() => 1), [1, n]),
  };
  if (session.inputNames.includes('token_type_ids')) feeds.token_type_ids = new ort.Tensor('int64', big(() => 0), [1, n]);
  const out = await session.run(feeds);
  const h = (out.last_hidden_state || out[session.outputNames[0]]).data;
  const v = new Float32Array(DIM);
  for (let t = 0; t < n; t++) for (let d = 0; d < DIM; d++) v[d] += h[t * DIM + d];
  let norm = 0;
  for (let d = 0; d < DIM; d++) { v[d] /= n; norm += v[d] * v[d]; }
  norm = Math.sqrt(norm) || 1;
  for (let d = 0; d < DIM; d++) v[d] /= norm;
  return v;
}

self.onmessage = async (e) => {
  const { id, cmd, texts } = e.data || {};
  try {
    if (cmd === 'load') { self.postMessage({ id, ok: true, result: await load(id) }); return; }
    if (cmd === 'embed') {
      await load(id);
      const out = [];
      for (let i = 0; i < texts.length; i++) {
        out.push(await embedOne(texts[i]));
        if (i % 16 === 15) self.postMessage({ id, progress: { done: i + 1, total: texts.length } });
      }
      self.postMessage({ id, ok: true, result: out }, out.map((v) => v.buffer));
      return;
    }
    throw new Error(`Unknown command ${cmd}`);
  } catch (err) {
    self.postMessage({ id, ok: false, error: String((err && err.message) || err) });
  }
};
