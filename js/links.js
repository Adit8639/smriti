// Where an atom's source lives in the Reader, if this device has that source.
// Pack atoms cite printed pages of their pack's book; a PDF linked to that pack (with a page
// offset) turns the citation into a PDF page.

import { app } from './store.js';
import { isObj } from './util.js';

export function readerTarget(atom) {
  const s = isObj(atom && atom.source) ? atom.source : null;
  if (!s) return null;
  const page = Number.parseInt(s.page, 10);
  if (s.sourceId) return { sourceId: s.sourceId, page: Number.isFinite(page) && page > 0 ? page : 1 };
  if (s.pack && app.state.packSources[s.pack] && Number.isFinite(page)) {
    const ps = app.state.packSources[s.pack];
    return { sourceId: ps.sourceId, page: Math.max(1, page + (ps.offset || 0)) };
  }
  return null;
}

export async function openSource(target) {
  const m = await import('./view-reader.js');
  return m.openReaderOverlay(target);
}
