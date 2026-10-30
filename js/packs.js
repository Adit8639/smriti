// Content pack import: dry-run planning (new / updated / unchanged / removed), commit,
// uninstall and stale-item clean-up. Runs in the data worker; tests call it directly.

import { CONTENT_STORES, deleteByIndex } from './db.js';
import { validatePack, checkReferences, parsePackText } from './schema.js';
import { profileContext } from './profiles.js';
import { sameContent } from './util.js';
import { makeEvent } from './events.js';

const MAX_LISTED = 12;
const emptyCounts = () => ({ new: 0, updated: 0, unchanged: 0, removed: 0 });

export async function loadImportContext(db) {
  const profiles = await db.getAll('profiles');
  const { papers, exams, starter } = profileContext(profiles);
  const packs = new Map((await db.getAll('packs')).map((p) => [p.id, p]));
  const owners = {};
  for (const s of CONTENT_STORES) owners[s] = new Map(await db.keyPairs(s, '_pack'));
  const nodeParents = new Map();
  for (const n of starter.values()) nodeParents.set(n.id, n.parent);
  for (const n of await db.getAll('nodes')) nodeParents.set(n.id, n.parent);
  return { papers, exams, starter, packs, owners, nodeParents };
}

export async function loadPackItems(db, packId) {
  const out = {};
  for (const s of CONTENT_STORES) out[s] = await db.getAllByIndex(s, '_pack', packId);
  return out;
}

// files: [{name, text}]. Returns one entry per file; entry.action is install | update |
// repair | unchanged | reject. Nothing is written.
export async function planPackImport(db, files) {
  const ctx = await loadImportContext(db);
  const entries = files.map((f) => {
    const e = {
      fileName: f.name, packId: null, title: null, version: null, kind: null, installedVersion: null,
      action: 'reject', errors: [], warnings: [], counts: {}, totals: emptyCounts(), orphans: 0,
      pack: null, items: null, removed: {},
    };
    const parsed = parsePackText(f.text);
    if (parsed.error) { e.errors.push({ path: '(file)', msg: parsed.error }); return e; }
    const v = validatePack(parsed.value, { papers: ctx.papers, exams: ctx.exams });
    Object.assign(e, { packId: v.packId, title: v.title, version: v.version, kind: v.kind, pack: v.pack, items: v.items });
    e.errors.push(...v.errors);
    e.warnings.push(...v.warnings);
    return e;
  });

  // The same pack twice in one batch.
  const firstFile = new Map();
  for (const e of entries) {
    if (e.errors.length || !e.packId) continue;
    if (firstFile.has(e.packId)) e.errors.push({ path: 'pack.id', msg: `pack "${e.packId}" is also in ${firstFile.get(e.packId)}; pick one file` });
    else firstFile.set(e.packId, e.fileName);
  }

  // Item ids claimed by other packs in this batch.
  const batchOwners = {};
  for (const s of CONTENT_STORES) batchOwners[s] = new Map();

  for (const e of entries) {
    if (e.errors.length) continue;
    const inst = ctx.packs.get(e.packId);
    e.installedVersion = inst ? inst.version : null;
    if (inst && inst.version > e.version) {
      e.errors.push({ path: 'pack.version', msg: `version ${inst.version} is already installed, which is newer than this file (version ${e.version})` });
      continue;
    }
    const sameVersion = !!inst && inst.version === e.version;
    const local = inst ? await loadPackItems(db, e.packId) : null;
    const collisions = [];
    const conflicts = [];
    for (const s of CONTENT_STORES) {
      const c = emptyCounts();
      const localMap = new Map((local ? local[s] : []).map((x) => [x.id, x]));
      for (const item of e.items[s]) {
        if (typeof item.id !== 'string') continue;
        const owner = ctx.owners[s].get(item.id);
        const other = owner && owner !== e.packId ? owner : batchOwners[s].get(item.id);
        if (other && other !== e.packId) { collisions.push(`${s} "${item.id}" (owned by ${other})`); continue; }
        const l = localMap.get(item.id);
        localMap.delete(item.id);
        if (!l) c.new++;
        else if (sameContent(l, item)) c.unchanged++;
        else if (sameVersion) conflicts.push(`${s} "${item.id}" differs`);
        else c.updated++;
      }
      if (localMap.size) {
        if (sameVersion) for (const id of localMap.keys()) conflicts.push(`${s} "${id}" is installed but missing from the file`);
        else { c.removed = localMap.size; e.removed[s] = [...localMap.keys()]; }
      }
      e.counts[s] = c;
      for (const k of Object.keys(e.totals)) e.totals[k] += c[k];
    }
    if (collisions.length) {
      e.errors.push({ path: '(ids)', msg: `ids must be unique across installed packs; ${collisions.length} already belong to another pack: ${collisions.slice(0, MAX_LISTED).join(', ')}${collisions.length > MAX_LISTED ? ', …' : ''}` });
    }
    if (conflicts.length) {
      e.errors.push({ path: 'pack.version', msg: `version ${e.version} is already installed with different content; bump pack.version to update it (${conflicts.slice(0, MAX_LISTED).join(', ')}${conflicts.length > MAX_LISTED ? ', …' : ''})` });
    }
    if (!e.errors.length) for (const s of CONTENT_STORES) for (const item of e.items[s]) batchOwners[s].set(item.id, e.packId);
  }

  // References resolve against what will exist after the import.
  const valid = entries.filter((e) => !e.errors.length);
  const known = { nodes: new Set(ctx.starter.keys()), nodeParents: new Map(ctx.nodeParents), atoms: new Set(), pyqs: new Set(), ca: new Set(), packs: new Set(ctx.packs.keys()) };
  for (const [id] of ctx.owners.nodes) known.nodes.add(id);
  for (const [id] of ctx.owners.atoms) known.atoms.add(id);
  for (const [id] of ctx.owners.pyqs) known.pyqs.add(id);
  for (const [id] of ctx.owners.ca) known.ca.add(id);
  for (const e of valid) {
    known.packs.add(e.packId);
    for (const n of e.items.nodes) { known.nodes.add(n.id); known.nodeParents.set(n.id, n.parent); }
    for (const a of e.items.atoms) known.atoms.add(a.id);
    for (const q of e.items.pyqs) known.pyqs.add(q.id);
    for (const x of e.items.ca) known.ca.add(x.id);
  }
  for (const e of valid) {
    const removed = e.removed;
    const k = removed.nodes || removed.atoms || removed.pyqs || removed.ca
      ? {
        ...known,
        nodes: without(known.nodes, removed.nodes),
        atoms: without(known.atoms, removed.atoms),
        pyqs: without(known.pyqs, removed.pyqs),
        ca: without(known.ca, removed.ca),
      }
      : known;
    const r = checkReferences(e, k);
    e.warnings.push(...r.warnings);
    e.errors.push(...r.errors);
    e.orphans = r.orphans;
  }

  for (const e of entries) {
    if (e.errors.length) { e.action = 'reject'; continue; }
    if (!e.installedVersion) e.action = 'install';
    else if (e.installedVersion < e.version) e.action = 'update';
    else e.action = e.totals.new > 0 ? 'repair' : 'unchanged';
  }
  return entries;
}

function without(set, ids) {
  if (!ids || !ids.length) return set;
  const s = new Set(set);
  for (const id of ids) s.delete(id);
  return s;
}

export const willWrite = (e) => e.action === 'install' || e.action === 'update' || e.action === 'repair';

// Summary sent to the page (the full item lists stay in the worker).
export function summarizeEntry(e) {
  return {
    fileName: e.fileName, packId: e.packId, title: e.title, version: e.version, kind: e.kind,
    installedVersion: e.installedVersion, action: e.action, errors: e.errors, warnings: e.warnings,
    counts: e.counts, totals: e.totals, orphans: e.orphans,
  };
}

// Writes each accepted pack in its own transaction: pack record, items, removals and one
// pack.installed event commit together or not at all.
export async function commitPackPlans(db, entries, { deviceId, now }) {
  const done = [];
  for (const e of entries) {
    if (!willWrite(e)) continue;
    const prev = await db.get('packs', e.packId);
    const ts = now;
    const counts = {};
    for (const s of CONTENT_STORES) if (e.items[s].length) counts[s] = e.items[s].length;
    const ev = makeEvent('pack.installed', {
      packId: e.packId, version: e.version, prevVersion: prev ? prev.version : null, kind: e.kind, title: e.title, counts,
    }, deviceId, ts);
    await db.tx([...CONTENT_STORES, 'packs', 'events'], 'readwrite', (s) => {
      s.packs.put({ ...e.pack, _v: e.version, _installedAt: prev ? prev._installedAt : ts, _updatedAt: ts, _file: e.fileName });
      for (const store of CONTENT_STORES) {
        // _i keeps the pack's authored order (syllabus order for topics).
        e.items[store].forEach((item, i) => s[store].put({ ...item, _pack: e.packId, _v: e.version, _i: i }));
        for (const id of e.removed[store] || []) s[store].delete(id);
      }
      s.events.put(ev);
    }, 'strict');
    done.push({ packId: e.packId, version: e.version, action: e.action, totals: e.totals });
  }
  return done;
}

// What an uninstall would remove, and how much learning history stays behind.
export async function uninstallPreview(db, packId, state) {
  const rec = await db.get('packs', packId);
  if (!rec) throw new Error(`Pack "${packId}" is not installed`);
  const counts = {};
  let history = 0;
  for (const s of CONTENT_STORES) {
    const keys = (await db.keyPairs(s, '_pack')).filter(([, p]) => p === packId).map(([id]) => id);
    if (keys.length) counts[s] = keys.length;
    if (s === 'atoms') for (const id of keys) if (state.atoms[id]) history++;
  }
  return { packId, title: rec.title, version: rec.version, counts, history };
}

// Removes the pack's content; events stay, and anything that pointed at the removed
// content is marked orphaned by the next integrity scan.
export async function uninstallPack(db, packId, { deviceId, now }) {
  const rec = await db.get('packs', packId);
  if (!rec) throw new Error(`Pack "${packId}" is not installed`);
  const ev = makeEvent('pack.uninstalled', { packId, version: rec.version, title: rec.title }, deviceId, now);
  await db.tx([...CONTENT_STORES, 'packs', 'events'], 'readwrite', (s) => {
    for (const store of CONTENT_STORES) deleteByIndex(s[store], '_pack', packId);
    s.packs.delete(packId);
    s.events.put(ev);
  }, 'strict');
  return { packId, title: rec.title };
}

// Deletes items left behind by an older version of the pack (backup imports never delete).
export async function removeStaleItems(db, packId) {
  const rec = await db.get('packs', packId);
  if (!rec) throw new Error(`Pack "${packId}" is not installed`);
  const doomed = {};
  let n = 0;
  for (const s of CONTENT_STORES) {
    doomed[s] = (await db.getAllByIndex(s, '_pack', packId)).filter((x) => x._v < rec.version).map((x) => x.id);
    n += doomed[s].length;
  }
  await db.tx(CONTENT_STORES, 'readwrite', (s) => {
    for (const store of CONTENT_STORES) for (const id of doomed[store]) s[store].delete(id);
  });
  return n;
}
