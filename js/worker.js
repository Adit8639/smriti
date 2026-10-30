// Data worker: validation, dry runs, commits, backup export/merge, cache rebuilds and
// search run here so the page never blocks on heavy work. Messages: {id, cmd, args}.

import { openDB, CONTENT_STORES } from './db.js';
import { planPackImport, summarizeEntry, commitPackPlans, uninstallPreview, uninstallPack, removeStaleItems, willWrite } from './packs.js';
import { exportBackup, planBackupImport, commitBackupImport } from './backup.js';
import { refreshDerived } from './derived.js';
import { profileContext } from './profiles.js';
import { buildIndex, runSearch } from './search.js';
import { needsVerify, quarantineStatus, rebuild } from './rebuild.js';

const dbReady = openDB();
const pending = new Map();
let nextToken = 1;
let index = null;

const sig = (entries) => JSON.stringify(entries.map((e) => [e.fileName, e.action, e.totals, e.errors.length]));

async function currentState(db) {
  const c = await db.get('cache', 'state');
  return c ? c.value : rebuild(await db.getAll('events'));
}

async function refresh(db) {
  index = null;
  return refreshDerived(db);
}

const handlers = {
  async refresh(db) {
    return refresh(db);
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
    return uninstallPreview(db, packId, await currentState(db));
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

  async search(db, { q }) {
    if (!index) {
      const profiles = await db.getAll('profiles');
      const { starter } = profileContext(profiles);
      const packNodes = await db.getAll('nodes');
      const nodes = new Map(starter);
      for (const n of packNodes) nodes.set(n.id, n);
      index = buildIndex([...nodes.values()], {
        atoms: await db.getAll('atoms'),
        pyqs: await db.getAll('pyqs'),
        ca: await db.getAll('ca'),
      });
    }
    return runSearch(index, q);
  },

  async 'search.reset'() {
    index = null;
    return true;
  },

  async 'quarantine.list'(db) {
    const state = await currentState(db);
    const atoms = (await db.getAll('atoms')).filter(needsVerify);
    const out = { quarantined: [], discarded: [], approved: 0 };
    for (const a of atoms) {
      const st = quarantineStatus(a, state);
      if (st === 'quarantined') out.quarantined.push(a);
      else if (st === 'discarded') out.discarded.push(a);
      else if (st === 'approved') out.approved++;
    }
    out.quarantined.sort((a, b) => (a.id < b.id ? -1 : 1));
    return out;
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
