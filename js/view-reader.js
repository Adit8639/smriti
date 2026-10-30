// Reader: a source page as rendered PDF (with selectable text) or as plain page text.
// Select text → Make atom, pre-filled with the text, source page, a suggested topic and
// suggested cloze targets. Used as a route, as an overlay from source links, and inside
// the Learn Loop's read step.

import { h, clear, toast, pushLayer } from './ui.js';
import { app, allNodes } from './store.js';
import { openPdf, pdfjs, closePdf } from './pdf.js';
import { quickAdd } from './sheets.js';
import { clozeTargets } from './cloze.js';
import { nodesForPage, suggestByKeywords, reflow } from './sources.js';
import { activeProfile } from './store.js';
import { inProfileScope } from './tree.js';

const docs = new Map(); // sourceId -> Promise<PDFDocumentProxy>
const LS_VIEW = 'smriti.readerView';

function getDoc(record) {
  if (!docs.has(record.id)) docs.set(record.id, record.blob.arrayBuffer().then((buf) => openPdf(buf)));
  return docs.get(record.id);
}

export function forgetDoc(sourceId) {
  const p = docs.get(sourceId);
  docs.delete(sourceId);
  if (p) p.then((d) => closePdf(d)).catch(() => {});
}

const readPref = () => { try { return localStorage.getItem(LS_VIEW) || 'page'; } catch (_) { return 'page'; } };
const writePref = (v) => { try { localStorage.setItem(LS_VIEW, v); } catch (_) { /* preference only */ } };

// opts: {sourceId, page, range:{from,to}, nodeId, onPage(page), compact}
export async function mountReader(host, opts) {
  const record = await app.db.get('sources', opts.sourceId);
  const meta = app.state.sources[opts.sourceId];
  if (!record) {
    clear(host).append(h('div', { class: 'card hint' },
      h('h2', { text: meta ? meta.title : 'Source not on this device' }),
      h('p', { text: 'This source is not on this device. Add the same PDF file under Sources and it links up automatically (it is matched by its contents).' }),
      h('a', { class: 'btn', href: '#/sources' }, 'Go to Sources')));
    return { destroy() {} };
  }
  const total = record.pages;
  const range = opts.range && opts.range.from ? { from: Math.max(1, opts.range.from), to: Math.min(total, opts.range.to || opts.range.from) } : { from: 1, to: total };
  let page = Math.min(range.to, Math.max(range.from, Number(opts.page) || range.from));
  let view = record.mode === 'text' ? 'text' : readPref();
  let destroyed = false;
  let renderSeq = 0;

  const pageBox = h('div', { class: 'reader-page' });
  const pageNo = h('input', { type: 'number', min: String(range.from), max: String(range.to), value: String(page), class: 'page-no', 'aria-label': 'Page number', inputmode: 'numeric' });
  const limited = range.from > 1 || range.to < total;
  const label = h('span', { class: 'small muted', text: ` of ${total}${limited ? ` · this topic: ${range.from === range.to ? `page ${range.from}` : `pages ${range.from}–${range.to}`}` : ''}` });
  const makeBtn = h('button', { class: 'btn primary', type: 'button', disabled: true }, 'Make atom');
  const viewBtn = record.mode === 'pdf' ? h('button', { class: 'btn small', type: 'button', 'aria-pressed': String(view === 'text') }, view === 'text' ? 'Page view' : 'Text view') : null;
  const prev = h('button', { class: 'btn', type: 'button', 'aria-label': 'Previous page' }, '‹ Prev');
  const next = h('button', { class: 'btn', type: 'button', 'aria-label': 'Next page' }, 'Next ›');

  const root = h('div', { class: `reader${opts.compact ? ' compact' : ''}` },
    h('div', { class: 'reader-bar' },
      h('strong', { class: 'reader-title', text: record.title }),
      h('span', { class: 'reader-pos' }, 'Page ', pageNo, label),
      viewBtn),
    pageBox,
    h('div', { class: 'reader-foot' }, prev, makeBtn, next));
  clear(host).append(root);

  const go = (p) => {
    const t = Math.min(range.to, Math.max(range.from, p));
    if (t === page) return;
    page = t;
    pageNo.value = String(page);
    draw();
    if (opts.onPage) opts.onPage(page);
  };
  prev.addEventListener('click', () => go(page - 1));
  next.addEventListener('click', () => go(page + 1));
  pageNo.addEventListener('change', () => go(Number(pageNo.value) || page));
  if (viewBtn) viewBtn.addEventListener('click', () => {
    view = view === 'text' ? 'page' : 'text';
    writePref(view);
    viewBtn.textContent = view === 'text' ? 'Page view' : 'Text view';
    viewBtn.setAttribute('aria-pressed', String(view === 'text'));
    draw();
  });

  const selectedText = () => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !pageBox.contains(sel.anchorNode)) return '';
    return sel.toString().replace(/\s+/g, ' ').trim();
  };
  const onSel = () => { makeBtn.disabled = !selectedText(); };
  document.addEventListener('selectionchange', onSel);

  makeBtn.addEventListener('click', async () => {
    const text = selectedText().slice(0, 500);
    if (!text) { toast('Select some text on the page first.', { kind: 'warn' }); return; }
    const mapped = nodesForPage(app.state, record.id, page);
    let nodeSuggestions = mapped;
    if (!nodeSuggestions.length) {
      const profile = activeProfile();
      const nodes = [...allNodes().values()].filter((n) => inProfileScope(n, profile));
      nodeSuggestions = suggestByKeywords([text], nodes, 5).map((s) => s.nodeId);
    }
    if (opts.nodeId && !nodeSuggestions.includes(opts.nodeId)) nodeSuggestions.unshift(opts.nodeId);
    window.getSelection().removeAllRanges();
    makeBtn.disabled = true;
    await quickAdd({
      title: 'Make atom', text, answer: '', nodeId: opts.nodeId || nodeSuggestions[0] || null, nodeSuggestions,
      sourceId: record.id, sourceTitle: `${record.title}`, page, targets: clozeTargets(text),
    });
  });

  const onKey = (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || document.body.classList.contains('sheet-open')) return;
    if (e.key === 'ArrowRight' || e.key === 'j') { e.preventDefault(); go(page + 1); }
    if (e.key === 'ArrowLeft' || e.key === 'k') { e.preventDefault(); go(page - 1); }
  };
  document.addEventListener('keydown', onKey);

  async function drawPdf(seq) {
    const doc = await getDoc(record);
    const pg = await doc.getPage(page);
    if (destroyed || seq !== renderSeq) return;
    const lib = await pdfjs();
    const v1 = pg.getViewport({ scale: 1 });
    const width = Math.max(240, Math.min(pageBox.clientWidth || host.clientWidth || 360, 1100));
    const scale = width / v1.width;
    const vp = pg.getViewport({ scale });
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const canvas = h('canvas', { class: 'reader-canvas', 'aria-hidden': 'true' });
    canvas.width = Math.floor(vp.width * dpr);
    canvas.height = Math.floor(vp.height * dpr);
    canvas.style.width = `${Math.floor(vp.width)}px`;
    canvas.style.height = `${Math.floor(vp.height)}px`;
    const layer = h('div', { class: 'textLayer' });
    const wrap = h('div', { class: 'pdf-page', style: `width:${Math.floor(vp.width)}px;height:${Math.floor(vp.height)}px;--total-scale-factor:${scale};--scale-round-x:1px;--scale-round-y:1px` }, canvas, layer);
    clear(pageBox).append(wrap);
    await pg.render({ canvas, canvasContext: canvas.getContext('2d'), viewport: vp, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined }).promise;
    if (destroyed || seq !== renderSeq) return;
    const tl = new lib.TextLayer({ textContentSource: pg.streamTextContent(), container: layer, viewport: vp });
    await tl.render();
  }

  function drawText() {
    const parts = [];
    const text = record.texts[page - 1] || '';
    parts.push(h('div', { class: 'reader-text' }, text ? reflow(text).map((t) => h('p', { text: t })) : h('span', { class: 'muted', text: 'No text on this page (it may be an image; scanned pages need OCR, which is not available offline).' })));
    // Text-only sources keep a small image of each page for tables and diagrams.
    if (record.mode === 'text' && record.thumbs && record.thumbs[page - 1]) {
      const img = h('img', { class: 'reader-thumb', alt: `Page ${page}` });
      const det = h('details', { class: 'reader-image', open: !text ? true : null }, h('summary', { text: 'Page image' }), img);
      const url = URL.createObjectURL(record.thumbs[page - 1]);
      img.src = url;
      img.addEventListener('load', () => URL.revokeObjectURL(url), { once: true });
      parts.push(det);
    }
    clear(pageBox).append(...parts);
  }

  async function draw() {
    const seq = ++renderSeq;
    prev.disabled = page <= range.from;
    next.disabled = page >= range.to;
    makeBtn.disabled = true;
    if (view === 'text' || record.mode === 'text' || !record.blob) { drawText(); return; }
    pageBox.classList.add('loading');
    try {
      await drawPdf(seq);
    } catch (e) {
      if (seq === renderSeq) { drawText(); toast(`Page view failed, showing text: ${e.message}`, { kind: 'warn' }); }
    } finally {
      pageBox.classList.remove('loading');
    }
  }
  await draw();

  return {
    get page() { return page; },
    destroy() {
      destroyed = true;
      document.removeEventListener('selectionchange', onSel);
      document.removeEventListener('keydown', onKey);
    },
  };
}

let routeReader = null;
export function leave() {
  if (routeReader) routeReader.destroy();
  routeReader = null;
}

export async function render(route) {
  const [sourceId, pg] = String(route.arg || '').split('/');
  const host = h('div', { class: 'reader-host' });
  setTimeout(async () => { routeReader = await mountReader(host, { sourceId, page: Number(pg) || 1 }); }, 0);
  return host;
}

// Full-screen reader on top of whatever is open (review, learn loop), closed with Back.
export async function openReaderOverlay(target) {
  const host = h('div', { class: 'overlay-body' });
  let reader = null;
  let unlayer = null;
  const close = () => { if (!ov.isConnected) return; if (unlayer) unlayer(); if (reader) reader.destroy(); ov.remove(); document.body.classList.remove('overlay-open'); document.removeEventListener('keydown', esc, true); };
  const esc = (e) => { if (e.key === 'Escape' && !document.body.classList.contains('sheet-open')) { e.preventDefault(); e.stopPropagation(); close(); } };
  const ov = h('div', { class: 'overlay', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Source' },
    h('div', { class: 'overlay-head' }, h('button', { class: 'btn small', type: 'button', onclick: close }, '‹ Back'), h('span', { class: 'small muted', text: 'Source' })),
    host);
  document.body.append(ov);
  document.body.classList.add('overlay-open');
  document.addEventListener('keydown', esc, true);
  unlayer = pushLayer(close);
  reader = await mountReader(host, { sourceId: target.sourceId, page: target.page });
  return close;
}
