// Sources: PDFs added on this device. The file (or, in text-only mode, its page text and
// small page images) stays in the browser's sources store; title, page count and topic
// links travel between devices as events. A source's id comes from the file's SHA-256, so
// the same PDF added on both devices links the same atoms.

import { openPdf, pageText, closePdf } from './pdf.js';
import { tokens } from './cloze.js';

export const isPhone = () => /Android|iPhone|iPad/i.test(navigator.userAgent) || Math.min(screen.width, screen.height) < 600;

export async function sha256Hex(buf) {
  const d = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const nextTick = () => new Promise((r) => setTimeout(r, 0));

async function thumb(page, width = 480) {
  const v1 = page.getViewport({ scale: 1 });
  const vp = page.getViewport({ scale: width / v1.width });
  const canvas = document.createElement('canvas');
  canvas.width = Math.floor(vp.width);
  canvas.height = Math.floor(vp.height);
  await page.render({ canvas, canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.6));
}

// Reads a PDF: hash, per-page text and (text-only mode) page images.
// Returns {record, meta} where record goes to the sources store and meta into the event.
export async function ingestPdf({ name, bytes }, { mode = 'pdf', title = null, onProgress = () => {} } = {}) {
  const hash = await sha256Hex(bytes);
  const id = `src-${hash.slice(0, 16)}`;
  const doc = await openPdf(bytes.slice(0));
  const n = doc.numPages;
  const texts = [];
  const thumbs = mode === 'text' ? [] : null;
  for (let p = 1; p <= n; p++) {
    // One unreadable page (odd fonts, broken objects) must not sink the whole book.
    let page = null;
    try {
      page = await doc.getPage(p);
      texts.push(await pageText(page));
    } catch (e) {
      texts.push('');
    }
    if (thumbs) {
      try { thumbs.push(page ? await thumb(page) : null); } catch (e) { thumbs.push(null); }
    }
    if (page) page.cleanup();
    onProgress(p, n);
    if (p % 4 === 0) await nextTick();
  }
  let metaTitle = null;
  try {
    const m = await doc.getMetadata();
    metaTitle = m && m.info && typeof m.info.Title === 'string' && m.info.Title.trim() ? m.info.Title.trim() : null;
  } catch (_) { /* no metadata */ }
  await closePdf(doc);
  const t = (title && title.trim()) || metaTitle || name.replace(/\.pdf$/i, '');
  const record = {
    id, title: t, fileName: name, bytes: bytes.byteLength, pages: n, mode, hash,
    blob: mode === 'pdf' ? new Blob([bytes], { type: 'application/pdf' }) : null,
    texts, thumbs, addedAt: Date.now(),
  };
  return { record, meta: { sourceId: id, title: t, pages: n, bytes: bytes.byteLength, fileName: name } };
}

// Topic suggestions from keyword hits per page: [{nodeId, score, from, to}], best first.
export function suggestByKeywords(texts, nodes, top = 8) {
  const pages = texts.map((t) => {
    const m = new Map();
    for (const w of tokens(t)) m.set(w, (m.get(w) || 0) + 1);
    return { m, lower: t.toLowerCase() };
  });
  const out = [];
  for (const n of nodes) {
    const kws = [...new Set([...(n.keywords || []), n.title].map((k) => String(k).toLowerCase().trim()).filter((k) => k.length >= 3))];
    if (!kws.length) continue;
    const perPage = pages.map((pg) => {
      let hits = 0;
      for (const k of kws) {
        const ws = tokens(k);
        if (!ws.length) continue;
        if (ws.length === 1) { hits += pg.m.get(ws[0]) || 0; continue; }
        if (ws.every((w) => pg.m.has(w)) && pg.lower.includes(k)) hits += 2;
      }
      return hits;
    });
    const total = perPage.reduce((a, b) => a + b, 0);
    if (total < 3) continue;
    const max = Math.max(...perPage);
    const peak = perPage.indexOf(max);
    const floor = Math.max(1, Math.ceil(max * 0.3));
    let from = peak;
    let to = peak;
    while (from > 0 && perPage[from - 1] >= floor) from--;
    while (to < perPage.length - 1 && perPage[to + 1] >= floor) to++;
    out.push({ nodeId: n.id, score: total, from: from + 1, to: to + 1 });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, top);
}

// For a PDF linked to a pack: each topic's page range from its atoms' cited pages. Pages
// are grouped into clusters (gaps of more than two pages split them) and the heaviest
// cluster wins, counting an atom's main topic double, so one stray cross-reference does
// not stretch a topic over half the book.
export function suggestFromPack(atoms, offset = 0) {
  const pages = new Map();
  for (const a of atoms) {
    const pg = Number.parseInt(a.source && a.source.page, 10);
    if (!Number.isFinite(pg)) continue;
    (a.nodes || []).forEach((n, i) => {
      if (!pages.has(n)) pages.set(n, []);
      pages.get(n).push([pg + offset, i === 0 ? 2 : 1]);
    });
  }
  const out = [];
  for (const [nodeId, list] of pages) {
    list.sort((x, y) => x[0] - y[0]);
    const clusters = [];
    for (const [pg, w] of list) {
      const c = clusters[clusters.length - 1];
      if (c && pg - c.to <= 2) { c.to = pg; c.score += w; }
      else clusters.push({ from: pg, to: pg, score: w });
    }
    clusters.sort((x, y) => y.score - x.score || x.from - y.from);
    out.push({ nodeId, ...clusters[0] });
  }
  return out.sort((a, b) => a.from - b.from);
}

// Topics whose mapped page range covers the page, tightest range first.
export function nodesForPage(state, sourceId, page) {
  const src = state.sources[sourceId];
  if (!src) return [];
  return Object.entries(src.maps).filter(([, r]) => page >= r.from && page <= r.to).sort((a, b) => (a[1].to - a[1].from) - (b[1].to - b[1].from)).map(([id]) => id);
}

// Sources mapped to a topic: [{sourceId, from, to}]
export function sourcesForNode(state, nodeId) {
  const out = [];
  for (const [id, s] of Object.entries(state.sources)) if (s.maps[nodeId]) out.push({ sourceId: id, ...s.maps[nodeId] });
  return out;
}

export { reflow } from './cloze.js';
