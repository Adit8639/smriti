// Sources: add PDFs (kept as files, or as text and page images to save space on a phone),
// link a PDF to a pack so atom source links open the right page, and map sources to topics
// with page ranges (suggested from the pack's cited pages or from keywords).

import { h, clear, toast, sheet, confirmSheet } from './ui.js';
import { app, allNodes, activeProfile, appendEvents, emit } from './store.js';
import { ingestPdf, isPhone, suggestByKeywords, suggestFromPack, sourcesForNode } from './sources.js';
import { nodePicker } from './sheets.js';
import { inProfileScope } from './tree.js';
import { forgetDoc } from './view-reader.js';
import { formatBytes, plural } from './util.js';

const SOURCE_BUDGET = 2;

async function packList() {
  return (await app.db.getAll('packs')).filter((p) => p.kind !== 'syllabus');
}

function guessPack(packs, title) {
  const t = String(title || '').toLowerCase();
  return packs.find((p) => (p.source && p.source.title && t.includes(p.source.title.toLowerCase())) || t.includes(p.title.toLowerCase())) || null;
}

// Add flow: options → read the file (progress) → save → map topics.
async function addFlow(file, defaults = {}) {
  const packs = await packList();
  const title = h('input', { type: 'text', class: 'field-input', value: defaults.title || file.name.replace(/\.pdf$/i, ''), 'aria-label': 'Title' });
  const keep = h('input', { type: 'radio', name: 'mode', value: 'pdf', checked: isPhone() ? null : true });
  const text = h('input', { type: 'radio', name: 'mode', value: 'text', checked: isPhone() ? true : null });
  const packSel = h('select', { 'aria-label': 'Pack this PDF is the source of' },
    h('option', { value: '' }, 'Not the source of a pack'),
    packs.map((p) => h('option', { value: p.id }, `${p.title} (${p.source ? p.source.title : p.id})`)));
  const g = defaults.packId ? packs.find((p) => p.id === defaults.packId) : guessPack(packs, `${title.value} ${file.name}`);
  if (g) packSel.value = g.id;
  const offset = h('input', { type: 'number', class: 'field-input short', value: String(defaults.offset || 0), 'aria-label': 'Page offset', inputmode: 'numeric' });
  const ok = await confirmSheet({
    title: 'Add source',
    confirmLabel: 'Add',
    message: h('div', { class: 'form' },
      h('p', { class: 'small muted', text: `${file.name} · ${formatBytes(file.bytes.byteLength)}. It stays on this device; nothing is uploaded.` }),
      h('label', { class: 'field' }, h('span', { text: 'Title' }), title),
      h('div', { class: 'field' }, h('span', { text: 'Keep on this device' }),
        h('label', { class: 'check' }, keep, ' The whole PDF (page view, best on a laptop)'),
        h('label', { class: 'check' }, text, ' Text and small page images only (saves space on a phone)')),
      h('label', { class: 'field' }, h('span', { text: 'Is it the book a pack cites? Then atom source links open its pages.' }), packSel),
      h('label', { class: 'field' }, h('span', { text: 'Page offset: PDF page number minus printed page number (0 if they match)' }), offset)),
  });
  if (!ok) return null;
  const mode = text.checked ? 'text' : 'pdf';
  const bar = h('progress', { max: '1', value: '0', class: 'progress' });
  const msg = h('p', { class: 'small', text: 'Reading pages…' });
  const s = sheet({ title: 'Adding source', body: h('div', null, msg, bar, h('p', { class: 'small muted', text: 'Text is extracted page by page in the background; keep this screen open.' })), actions: [] });
  let result;
  try {
    result = await ingestPdf({ name: file.name, bytes: file.bytes }, { mode, title: title.value, onProgress: (p, n) => { bar.max = n; bar.value = p; msg.textContent = `Reading page ${p} of ${n}…`; } });
    await app.db.put('sources', result.record);
    const ev = [['source.added', result.meta]];
    if (packSel.value) ev.push(['source.linked', { sourceId: result.meta.sourceId, packId: packSel.value, offset: Number.parseInt(offset.value, 10) || 0 }]);
    await appendEvents(ev);
  } catch (e) {
    s.close();
    toast(`Could not read that PDF: ${e.message}`, { kind: 'error', ms: 8000 });
    return null;
  }
  s.close();
  const blank = result.record.texts.filter((t) => !t.trim()).length;
  toast(`Added ${result.record.title}: ${result.record.pages} pages${blank ? `, ${blank} without text (scanned pages need OCR)` : ''}.`, { kind: 'ok', ms: 6000 });
  await mapFlow(result.record.id);
  return result.record.id;
}

// Topic mapping: suggestions with page ranges, editable, with the source budget warning.
export async function mapFlow(sourceId) {
  const record = await app.db.get('sources', sourceId);
  const meta = app.state.sources[sourceId];
  if (!meta) return;
  const nodes = allNodes();
  let sugg = [];
  if (meta.pack) {
    const atoms = await app.db.getAllByIndex('atoms', '_pack', meta.pack.packId);
    sugg = suggestFromPack(atoms, meta.pack.offset || 0);
  } else if (record) {
    const profile = activeProfile();
    sugg = suggestByKeywords(record.texts, [...nodes.values()].filter((n) => inProfileScope(n, profile)), 10);
  }
  const rows = new Map();
  for (const [nodeId, r] of Object.entries(meta.maps)) rows.set(nodeId, { nodeId, from: r.from, to: r.to, on: true, existing: true });
  for (const sg of sugg) if (!rows.has(sg.nodeId) && nodes.has(sg.nodeId)) rows.set(sg.nodeId, { nodeId: sg.nodeId, from: sg.from, to: sg.to, on: true, existing: false });
  const list = h('div', { class: 'map-list' });
  const pages = meta.pages || (record && record.pages) || 1;
  const draw = () => {
    clear(list);
    if (!rows.size) list.append(h('p', { class: 'small muted', text: 'No suggestions. Add topics yourself.' }));
    for (const r of rows.values()) {
      const n = nodes.get(r.nodeId);
      const others = sourcesForNode(app.state, r.nodeId).filter((x) => x.sourceId !== sourceId).length;
      const cb = h('input', { type: 'checkbox', checked: r.on ? true : null, 'aria-label': `Map ${n ? n.title : r.nodeId}` });
      cb.addEventListener('change', () => { r.on = cb.checked; });
      const from = h('input', { type: 'number', min: '1', max: String(pages), value: String(r.from), class: 'field-input short', 'aria-label': 'From page' });
      const to = h('input', { type: 'number', min: '1', max: String(pages), value: String(r.to), class: 'field-input short', 'aria-label': 'To page' });
      from.addEventListener('change', () => { r.from = Math.max(1, Math.min(pages, Number(from.value) || 1)); });
      to.addEventListener('change', () => { r.to = Math.max(r.from, Math.min(pages, Number(to.value) || r.from)); });
      list.append(h('div', { class: 'map-row' },
        h('label', { class: 'check' }, cb, h('span', { text: n ? n.title : r.nodeId })),
        h('div', { class: 'map-pages' }, h('span', { class: 'small muted', text: 'pages' }), from, h('span', { text: '–' }), to),
        others >= SOURCE_BUDGET ? h('p', { class: 'small warn-text', text: `This topic already has ${others} other sources. Limited sources, more revisions.` }) : null));
    }
  };
  draw();
  const s = sheet({
    title: `Topics in ${meta.title}`,
    wide: true,
    body: h('div', null,
      h('p', { class: 'small muted', text: meta.pack ? 'Suggested from the pages the linked pack cites.' : 'Suggested from topic keywords found in the text.' }),
      list,
      h('button', {
        class: 'btn', type: 'button',
        onclick: async () => {
          const id = await nodePicker({ title: 'Add a topic' });
          if (id && !rows.has(id)) { rows.set(id, { nodeId: id, from: 1, to: Math.min(pages, 1), on: true, existing: false }); draw(); }
        },
      }, 'Add a topic…')),
    actions: [
      { label: 'Cancel', onClick: () => s.close() },
      {
        label: 'Save topics', kind: 'primary',
        onClick: async () => {
          const ev = [];
          for (const r of rows.values()) {
            const cur = meta.maps[r.nodeId];
            if (r.on && (!cur || cur.from !== r.from || cur.to !== r.to)) ev.push(['source.mapped', { sourceId, nodeId: r.nodeId, from: r.from, to: Math.max(r.from, r.to) }]);
            if (!r.on && cur) ev.push(['source.mapped', { sourceId, nodeId: r.nodeId, from: null }]);
          }
          s.close();
          if (ev.length) {
            await appendEvents(ev);
            toast(`Saved ${plural(ev.length, 'topic change')}.`, { kind: 'ok' });
          }
          emit('rerender');
        },
      },
    ],
  });
}

async function linkFlow(sourceId) {
  const meta = app.state.sources[sourceId];
  const packs = await packList();
  const packSel = h('select', { 'aria-label': 'Pack' }, h('option', { value: '' }, 'Not the source of a pack'), packs.map((p) => h('option', { value: p.id }, p.title)));
  packSel.value = meta.pack ? meta.pack.packId : '';
  const offset = h('input', { type: 'number', class: 'field-input short', value: String(meta.pack ? meta.pack.offset : 0), 'aria-label': 'Page offset' });
  const ok = await confirmSheet({
    title: 'Link to a pack',
    confirmLabel: 'Save',
    message: h('div', { class: 'form' },
      h('label', { class: 'field' }, h('span', { text: 'Pack whose atoms cite this book' }), packSel),
      h('label', { class: 'field' }, h('span', { text: 'Page offset (PDF page − printed page)' }), offset)),
  });
  if (!ok) return;
  await appendEvents([['source.linked', { sourceId, packId: packSel.value || null, offset: Number.parseInt(offset.value, 10) || 0 }]]);
  toast('Saved.', { kind: 'ok' });
  emit('rerender');
}

export async function render() {
  const local = new Map((await app.db.getAll('sources')).map((r) => [r.id, r]));
  const st = app.state;
  const nodes = allNodes();
  const root = h('div', { class: 'sources' });
  const fileIn = h('input', { type: 'file', accept: 'application/pdf,.pdf', hidden: true, id: 'pdf-file' });
  fileIn.addEventListener('change', async () => {
    const f = fileIn.files[0];
    fileIn.value = '';
    if (!f) return;
    const bytes = await f.arrayBuffer();
    if (await addFlow({ name: f.name, bytes })) emit('rerender');
  });
  root.append(h('section', { class: 'card' },
    h('h2', { text: 'Sources' }),
    h('p', { class: 'small muted', text: 'Add the PDFs you study from. Text is extracted on this device; the file never leaves it. Map each source to its topics so the Learn Loop opens the right pages.' }),
    h('div', { class: 'button-row' },
      h('button', { class: 'btn primary', type: 'button', onclick: () => fileIn.click() }, 'Add PDF…'),
      h('button', {
        class: 'btn', type: 'button',
        onclick: async () => {
          try {
            const r = await fetch(new URL('packs/demo/demo-source.pdf', document.baseURI));
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            const bytes = await r.arrayBuffer();
            if (await addFlow({ name: 'demo-source.pdf', bytes }, { title: 'Demo Source', packId: 'demo-polity', offset: 0 })) emit('rerender');
          } catch (e) {
            toast(`Demo source unavailable: ${e.message}`, { kind: 'error' });
          }
        },
      }, 'Try the demo source')),
    fileIn));

  const ids = new Set([...Object.keys(st.sources), ...local.keys()]);
  if (!ids.size) {
    root.append(h('p', { class: 'muted small center', text: 'No sources yet.' }));
    return root;
  }
  for (const id of ids) {
    const meta = st.sources[id];
    const rec = local.get(id);
    const title = (meta && meta.title) || (rec && rec.title) || id;
    const maps = meta ? Object.entries(meta.maps) : [];
    const pack = meta && meta.pack;
    root.append(h('article', { class: 'card item', 'data-nav': '', tabindex: '0' },
      h('div', { class: 'item-head' },
        h('span', { class: 'badge', text: rec ? (rec.mode === 'text' ? 'Text only' : 'PDF') : 'Not on this device' }),
        h('span', { class: 'badge muted', text: `${(meta && meta.pages) || (rec && rec.pages) || '?'} pages` }),
        rec ? h('span', { class: 'badge muted', text: formatBytes(rec.mode === 'text' ? estimateSize(rec) : rec.bytes) }) : null),
      h('h3', { class: 'item-title', text: title }),
      pack ? h('p', { class: 'small', text: `Source of pack ${pack.packId}${pack.offset ? ` (offset ${pack.offset})` : ''}: its atoms' source links open here.` }) : null,
      maps.length ? h('p', { class: 'chips' }, maps.slice(0, 12).map(([nid, r]) => h('a', { class: 'chip', href: rec ? `#/reader/${encodeURIComponent(id)}/${r.from}` : `#/node/${encodeURIComponent(nid)}` }, `${(nodes.get(nid) || { title: nid }).title} · p. ${r.from}${r.to !== r.from ? `–${r.to}` : ''}`)), maps.length > 12 ? h('span', { class: 'small muted', text: ` +${maps.length - 12} more` }) : null) : h('p', { class: 'small muted', text: 'Not mapped to any topic yet.' }),
      h('p', { class: 'small muted', text: `${plural(st.sourceRevisions[id] || 0, 'note revision')} written from this source.` }),
      !rec ? h('p', { class: 'small warn-text', text: 'Added on another device. Add the same PDF here to read it on this device.' }) : null,
      h('div', { class: 'card-actions' },
        rec ? h('a', { class: 'btn primary', href: `#/reader/${encodeURIComponent(id)}/1` }, 'Open') : null,
        meta ? h('button', { class: 'btn', type: 'button', onclick: () => mapFlow(id) }, 'Topics') : null,
        meta ? h('button', { class: 'btn', type: 'button', onclick: () => linkFlow(id) }, 'Pack link') : null,
        rec ? h('button', {
          class: 'btn danger', type: 'button',
          onclick: async () => {
            const ok = await confirmSheet({ title: `Remove ${title} from this device?`, message: 'The PDF and its page text are deleted from this browser. Its topic links and the atoms you made from it stay, and come back to life if you add the same file again.', confirmLabel: 'Remove', danger: true });
            if (!ok) return;
            forgetDoc(id);
            await app.db.delete('sources', id);
            toast('Removed from this device.', { kind: 'ok' });
            emit('rerender');
          },
        }, 'Remove') : null)));
  }
  return root;
}

function estimateSize(rec) {
  let n = 0;
  for (const t of rec.texts || []) n += t.length;
  for (const b of rec.thumbs || []) n += b ? b.size : 0;
  return n;
}

