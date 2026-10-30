// Data worker: validation, dry runs, commits, backup export/merge, cache rebuilds, the
// review queue and search run here so the page never blocks on heavy work.
// It keeps its own copy of the rebuilt state, brought up to date from the event log
// before each command (new events are applied incrementally; out-of-order events, e.g.
// from a backup import, trigger a full rebuild). Messages: {id, cmd, args}.

import { openDB, CONTENT_STORES } from './db.js';
import { planPackImport, summarizeEntry, commitPackPlans, uninstallPreview, uninstallPack, removeStaleItems, willWrite } from './packs.js';
import { exportBackup, planBackupImport, commitBackupImport } from './backup.js';
import { refreshDerived } from './derived.js';
import { profileContext } from './profiles.js';
import { buildIndex, runSearch } from './search.js';
import { needsVerify, quarantineStatus, rebuild, applyInPlace } from './rebuild.js';
import { compareEvents } from './events.js';
import { buildQueue } from './queue.js';
import { STATE_VERSION } from './version.js';
import { pyqList, pyqsByIds, mockQuestions, projection, packKinds } from './labdata.js';
import { pyqProbe } from './pyq.js';
import { rng } from './rng.js';

const dbReady = openDB();
const pending = new Map();
let nextToken = 1;
let index = null;
let state = null;
let flushedCount = -1;
let atomsCache = null;
let orderCache = null;

const sig = (entries) => JSON.stringify(entries.map((e) => [e.fileName, e.action, e.totals, e.errors.length]));

// Brings the worker's state up to date with the event log. Concurrent callers share one
// run, so no event is ever applied twice.
let syncing = null;
function syncState(db) {
  if (!syncing) syncing = doSync(db).finally(() => { syncing = null; });
  return syncing;
}

async function doSync(db) {
  if (!state) {
    const c = await db.get('cache', 'state');
    if (c && c.value && c.value.v === STATE_VERSION) { state = c.value; flushedCount = state.count; }
  }
  const n = await db.count('events');
  if (state && state.count === n) return state;
  if (state && state.last && state.count < n) {
    const newer = await new Promise((resolve, reject) => {
      const r = db.idb.transaction('events').objectStore('events').index('ts').getAll(IDBKeyRange.lowerBound(state.last.ts));
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    const fresh = newer.filter((e) => compareEvents(e, state.last) > 0).sort(compareEvents);
    if (state.count + fresh.length === n) {
      for (const e of fresh) applyInPlace(state, e);
      return state;
    }
  }
  state = rebuild(await db.getAll('events'));
  return state;
}

async function flush(db, force = false) {
  if (!state || (!force && state.count === flushedCount)) return false;
  await db.put('cache', { key: 'state', value: state });
  flushedCount = state.count;
  return true;
}

function contentChanged() {
  index = null;
  atomsCache = null;
  orderCache = null;
}

async function refresh(db) {
  contentChanged();
  const st = await syncState(db);
  const d = await refreshDerived(db, st);
  flushedCount = st.count;
  return d;
}

async function allAtoms(db) {
  if (!atomsCache) atomsCache = await db.getAll('atoms');
  return atomsCache;
}

// Syllabus order (depth first, profile starter tree then pack topics) for new atoms.
async function nodeOrder(db) {
  if (orderCache) return orderCache;
  const { starter } = profileContext(await db.getAll('profiles'));
  const nodes = new Map(starter);
  const packNodes = (await db.getAll('nodes')).sort((a, b) => (a._pack < b._pack ? -1 : a._pack > b._pack ? 1 : (a._i ?? 1e9) - (b._i ?? 1e9) || (a.id < b.id ? -1 : 1)));
  for (const n of packNodes) nodes.set(n.id, n);
  const kids = new Map();
  const roots = [];
  for (const n of nodes.values()) {
    if (n.parent && nodes.has(n.parent)) {
      if (!kids.has(n.parent)) kids.set(n.parent, []);
      kids.get(n.parent).push(n.id);
    } else roots.push(n.id);
  }
  const order = new Map();
  const stack = roots.slice().reverse();
  while (stack.length) {
    const id = stack.pop();
    if (order.has(id)) continue;
    order.set(id, order.size);
    for (const k of (kids.get(id) || []).slice().reverse()) stack.push(k);
  }
  orderCache = order;
  return order;
}

const handlers = {
  async refresh(db) {
    return refresh(db);
  },

  async sync(db) {
    const st = await syncState(db);
    await flush(db);
    return { state: st };
  },

  async 'state.flush'(db) {
    await syncState(db);
    return flush(db);
  },

  async 'queue.build'(db, args) {
    const st = await syncState(db);
    const atoms = await allAtoms(db);
    const order = await nodeOrder(db);
    const t0 = performance.now();
    const q = buildQueue({ ...args, atoms, state: st, nodeOrder: order });
    q.ms = Math.round(performance.now() - t0);
    return q;
  },

  async 'packs.plan'(db, { files }) {
    const entries = await planPackImport(db, files);
    const token = nextToken++;
    pending.set(token, { kind: 'packs', files, sig: sig(entries) });
    return { token, entries: entries.map(summarizeEntry) };
  },

  async 'packs.commit'(db, { token, ctx }) {
    const p = pending.get(token);
    if (!p || p.kind !== 'packs') throw new Error('This preview has expired; choose the files again.');
    // Re-plan against the database as it is now; if anything moved, show the new preview.
    const entries = await planPackImport(db, p.files);
    if (sig(entries) !== p.sig) {
      pending.delete(token);
      const t = nextToken++;
      pending.set(t, { kind: 'packs', files: p.files, sig: sig(entries) });
      return { stale: true, token: t, entries: entries.map(summarizeEntry) };
    }
    pending.delete(token);
    const done = await commitPackPlans(db, entries.filter(willWrite), ctx);
    const derived = await refresh(db);
    return { done, derived };
  },

  async 'pending.drop'(db, { token }) {
    pending.delete(token);
    return true;
  },

  async 'packs.list'(db) {
    const packs = await db.getAll('packs');
    const per = {};
    for (const s of CONTENT_STORES) {
      for (const [, packId] of await db.keyPairs(s, '_pack')) {
        const c = per[packId] || (per[packId] = {});
        c[s] = (c[s] || 0) + 1;
      }
    }
    return packs.map((p) => ({ ...p, counts: per[p.id] || {} }));
  },

  async 'packs.uninstallPreview'(db, { packId }) {
    return uninstallPreview(db, packId, await syncState(db));
  },

  async 'packs.uninstall'(db, { packId, ctx }) {
    const r = await uninstallPack(db, packId, ctx);
    const derived = await refresh(db);
    return { ...r, derived };
  },

  async 'packs.cleanStale'(db, { packId }) {
    const removed = await removeStaleItems(db, packId);
    const derived = await refresh(db);
    return { removed, derived };
  },

  async 'backup.export'(db, { ctx }) {
    const r = await exportBackup(db, ctx);
    const derived = await refresh(db);
    return { ...r, derived };
  },

  async 'backup.plan'(db, { name, text }) {
    const plan = await planBackupImport(db, text);
    if (plan.errors.length) return { errors: plan.errors, warnings: plan.warnings };
    const token = nextToken++;
    pending.set(token, { kind: 'backup', name, text, changes: plan.changes });
    const { newEvents, writes, ...summary } = plan;
    return { token, ...summary };
  },

  async 'backup.commit'(db, { token }) {
    const p = pending.get(token);
    if (!p || p.kind !== 'backup') throw new Error('This preview has expired; choose the backup file again.');
    pending.delete(token);
    const plan = await planBackupImport(db, p.text);
    if (plan.errors.length) throw new Error(plan.errors[0].msg);
    const r = await commitBackupImport(db, plan);
    const derived = await refresh(db);
    return { ...r, derived };
  },

  // kinds: optional list such as ['atom'] or ['node'].
  async search(db, { q, kinds, limit }) {
    if (!index) {
      const profiles = await db.getAll('profiles');
      const { starter } = profileContext(profiles);
      const packNodes = await db.getAll('nodes');
      const nodes = new Map(starter);
      for (const n of packNodes) nodes.set(n.id, n);
      index = buildIndex([...nodes.values()], {
        atoms: await allAtoms(db),
        pyqs: await db.getAll('pyqs'),
        ca: await db.getAll('ca'),
      });
    }
    return runSearch(index, q, limit || 40, kinds);
  },

  async 'search.reset'() {
    index = null;
    orderCache = null;
    return true;
  },

  async 'quarantine.list'(db) {
    const st = await syncState(db);
    const atoms = (await allAtoms(db)).filter(needsVerify);
    const out = { quarantined: [], discarded: [], approved: 0 };
    for (const a of atoms) {
      const s = quarantineStatus(a, st);
      if (s === 'quarantined') out.quarantined.push(a);
      else if (s === 'discarded') out.discarded.push(a);
      else if (s === 'approved') out.approved++;
    }
    out.quarantined.sort((a, b) => (a.id < b.id ? -1 : 1));
    return out;
  },

  async 'lab.pyqs'(db) {
    return pyqList(db, await syncState(db));
  },

  async 'lab.pyqsByIds'(db, { ids }) {
    return pyqsByIds(db, ids || []);
  },

  async 'mock.build'(db, args) {
    const st = await syncState(db);
    const t0 = performance.now();
    const questions = await mockQuestions(db, st, args);
    return { questions, ms: Math.round(performance.now() - t0) };
  },

  async 'lab.projection'(db, args) {
    return projection(db, await syncState(db), args);
  },

  // Mock packs (kind "mock") with their question counts.
  async 'lab.mockPacks'(db) {
    const packs = (await db.getAll('packs')).filter((p) => p.kind === 'mock');
    const counts = new Map();
    for (const [, packId] of await db.keyPairs('pyqs', '_pack')) counts.set(packId, (counts.get(packId) || 0) + 1);
    return packs.map((p) => ({ id: p.id, title: p.title, version: p.version, questions: counts.get(p.id) || 0 }));
  },

  // Statements for a trap drill: false statements carrying the given trap tags, mixed with
  // true statements from the same probes and PYQs so "false" is never a safe default.
  async 'traps.drill'(db, { tags, n = 20, seed }) {
    const want = new Set(tags || []);
    const traps = [];
    const truths = [];
    for (const p of await db.getAll('probes')) {
      (p.statements || []).forEach((x, i) => {
        const item = { id: `stmt:${p.id}#${i}`, text: String(x.text).replace(/^Statement-(I|II):\s*/, ''), true: x.true, trap: x.trap || null, reason: x.reason || '', atoms: p.atoms || [], explanation: p.explanation || '' };
        if (x.true === false && want.has(x.trap)) traps.push(item);
        else if (x.true === true && p.statements.some((y) => want.has(y.trap))) truths.push(item);
      });
    }
    const kinds = await packKinds(db);
    for (const q of await db.getAll('pyqs')) {
      if (kinds.get(q._pack) === 'mock' || !Array.isArray(q.options)) continue;
      const pr = pyqProbe(q);
      if (!pr.statements) continue;
      pr.statements.forEach((x, i) => {
        const item = { id: `stmt:pyq:${q.id}#${i}`, text: x.text, true: x.true, trap: x.trap, reason: '', atoms: q.atoms || [], explanation: q.elimination || '' };
        if (x.true === false && want.has(x.trap)) traps.push(item);
        else if (x.true === true && pr.statements.some((y) => want.has(y.trap))) truths.push(item);
      });
    }
    const r = rng(seed || 'drill');
    const pickT = r.sample(traps, Math.min(traps.length, Math.ceil(n * 0.65)));
    const pickR = r.sample(truths, Math.min(truths.length, n - pickT.length));
    return { items: r.shuffle([...pickT, ...pickR]), available: { traps: traps.length, truths: truths.length } };
  },

  // CSAT questions from packs (PYQ or mock packs on the CSAT paper): comprehension passages
  // and other objective items.
  async 'csat.packItems'(db, { paperId }) {
    return (await db.getAll('pyqs')).filter((q) => q.paper === paperId && Array.isArray(q.options) && Number.isInteger(q.answer));
  },

  // Atoms whose topics fall under any of the given node ids (all atoms when none given).
  async 'atoms.under'(db, { nodeIds }) {
    const atoms = await allAtoms(db);
    if (!nodeIds || !nodeIds.length) return atoms;
    const { starter } = profileContext(await db.getAll('profiles'));
    const parent = new Map([...starter.values()].map((n) => [n.id, n.parent]));
    for (const n of await db.getAll('nodes')) parent.set(n.id, n.parent);
    const want = new Set(nodeIds);
    const under = (id) => {
      const seen = new Set();
      for (let cur = id; cur && !seen.has(cur); cur = parent.get(cur)) {
        if (want.has(cur)) return true;
        seen.add(cur);
      }
      return false;
    };
    return atoms.filter((a) => (a.nodes || []).some(under));
  },
};

self.onmessage = async (e) => {
  const { id, cmd, args } = e.data || {};
  try {
    const h = handlers[cmd];
    if (!h) throw new Error(`Unknown worker command "${cmd}"`);
    const db = await dbReady;
    const result = await h(db, args || {});
    self.postMessage({ id, ok: true, result });
  } catch (err) {
    self.postMessage({ id, ok: false, error: String((err && err.message) || err) });
  }
};
