// Backup export and merge-import. Import never deletes and never overwrites newer data:
// events are unioned by id, content is upserted only when the incoming pack version is
// higher, then caches are rebuilt. Importing the same file twice changes nothing.

import { STORES, CONTENT_STORES } from './db.js';
import { BACKUP_FORMAT, BACKUP_FORMAT_VERSION, APP_VERSION, SCHEMA_VERSION } from './version.js';
import { checkEvent, makeEvent } from './events.js';
import { rebuild } from './rebuild.js';
import { validatePack, COLLECTIONS } from './schema.js';
import { validateProfile, profileContext } from './profiles.js';
import { isObj, sameContent, stableStringify, stripMeta, describeJsonError, localDate, slug, formatDate } from './util.js';

// Device-local or derived stores: exported for completeness, never merged. Sources hold
// this device's PDF or page text; their titles and topic links travel as events.
export const NOT_MERGED = ['settings', 'cache', 'sources'];
const MERGED = ['events', 'packs', 'profiles', ...CONTENT_STORES];
// Self-made atoms are materialised from atom.created events, so the events carry them.
const SELF_PACK = '@self';
const MAX_ERRORS = 50;

function snapshot(db) {
  return db.tx(STORES, 'readonly', (s) => {
    const out = {};
    for (const name of STORES) {
      const r = s[name].getAll();
      r.onsuccess = () => { out[name] = r.result; };
    }
    return out;
  });
}

// Logs backup.exported first, so the file carries the record of its own export.
export async function exportBackup(db, { deviceId, deviceName, now }) {
  const fileName = `smriti-backup-${slug(deviceName)}-${localDate(now)}.json`;
  const before = await db.count('events');
  const ev = makeEvent('backup.exported', { deviceName, fileName, events: before + 1 }, deviceId, now);
  await db.put('events', ev, 'strict');
  const stores = await snapshot(db);
  // PDFs and page text stay on the device; the backup records only what each source is.
  stores.sources = stores.sources.map((x) => ({ id: x.id, title: x.title, pages: x.pages, bytes: x.bytes, mode: x.mode }));
  const counts = {};
  for (const s of STORES) counts[s] = stores[s].length;
  const backup = {
    format: BACKUP_FORMAT,
    formatVersion: BACKUP_FORMAT_VERSION,
    appVersion: APP_VERSION,
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date(now).toISOString(),
    deviceId,
    deviceName,
    counts,
    stores,
  };
  return { fileName, text: JSON.stringify(backup), counts };
}

export function parseBackup(text) {
  const errors = [];
  const warnings = [];
  const fail = (path, msg) => ({ errors: [{ path, msg }], warnings });
  let raw;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return fail('(file)', `Not valid JSON — ${describeJsonError(e, text)}`);
  }
  if (!isObj(raw)) return fail('(file)', 'a backup must be one JSON object');
  if (raw.format !== BACKUP_FORMAT) {
    if (isObj(raw.pack)) return fail('(file)', 'this is a content pack, not a backup; use Packs → Import packs');
    return fail('format', 'not a SMRITI backup file');
  }
  if (!Number.isInteger(raw.formatVersion)) return fail('formatVersion', 'missing');
  if (raw.formatVersion > BACKUP_FORMAT_VERSION) return fail('formatVersion', `made by a newer SMRITI (backup format ${raw.formatVersion}); update this app first by reloading while online`);
  if (!isObj(raw.stores)) return fail('stores', 'missing');

  for (const s of Object.keys(raw.stores)) if (!STORES.includes(s)) warnings.push({ path: `stores.${s}`, msg: 'unknown store, ignored' });
  const st = {};
  for (const s of STORES) {
    const v = raw.stores[s];
    if (v === undefined) { st[s] = []; continue; }
    if (!Array.isArray(v)) { errors.push({ path: `stores.${s}`, msg: 'must be a list' }); st[s] = []; continue; }
    st[s] = v;
  }
  const push = (path, msg) => { if (errors.length < MAX_ERRORS) errors.push({ path, msg }); else if (errors.length === MAX_ERRORS) errors.push({ path: '…', msg: 'more errors not shown' }); };

  st.events.forEach((e, i) => { const m = checkEvent(e); if (m) push(`stores.events[${i}]`, m); });
  for (const s of CONTENT_STORES) {
    st[s].forEach((x, i) => {
      if (!isObj(x) || typeof x.id !== 'string' || !x.id) push(`stores.${s}[${i}]`, 'needs a text id');
      else if (typeof x._pack !== 'string' || !Number.isInteger(x._v)) push(`stores.${s}[${i}]`, 'missing its pack (_pack/_v); the file may be damaged');
    });
  }
  st.packs.forEach((p, i) => {
    if (!isObj(p) || typeof p.id !== 'string' || !Number.isInteger(p.version)) push(`stores.packs[${i}]`, 'needs id and version');
  });
  st.profiles.forEach((p, i) => {
    if (!isObj(p) || typeof p.id !== 'string' || !Number.isInteger(p.version)) push(`stores.profiles[${i}]`, 'needs id and version');
  });
  st.sources.forEach((x, i) => {
    if (!isObj(x) || typeof x.id !== 'string') push(`stores.sources[${i}]`, 'needs a text id');
  });
  return { errors, warnings, backup: errors.length ? null : { ...raw, stores: st } };
}

// Re-validates each incoming pack against the schema; a pack that fails is left out.
export function screenIncomingPacks(stores, profiles) {
  const { papers, exams } = profileContext(profiles);
  const rejected = new Map();
  for (const P of stores.packs) {
    const raw = { pack: stripMeta(P) };
    for (const c of COLLECTIONS) raw[c] = stores[c].filter((x) => x._pack === P.id).map(stripMeta);
    const v = validatePack(raw, { papers, exams });
    if (v.errors.length) rejected.set(P.id, `${v.errors[0].path}: ${v.errors[0].msg}${v.errors.length > 1 ? ` (+${v.errors.length - 1} more)` : ''}`);
  }
  if (!rejected.size) return { stores, rejected };
  const out = { ...stores, packs: stores.packs.filter((p) => !rejected.has(p.id)) };
  for (const c of CONTENT_STORES) out[c] = stores[c].filter((x) => !rejected.has(x._pack));
  return { stores: out, rejected };
}

// Pure merge planner. local and incoming: {events, packs, profiles, sources, nodes, atoms, …}
export function planMerge(local, incoming) {
  const reasons = new Map();
  const why = (msg) => reasons.set(msg, (reasons.get(msg) || 0) + 1);

  // Events: union by id.
  const seen = new Map(local.events.map((e) => [e.id, e]));
  const newEvents = [];
  const byDevice = {};
  let existing = 0;
  let conflicts = 0;
  for (const e of incoming.events) {
    const l = seen.get(e.id);
    if (!l) {
      newEvents.push(e);
      seen.set(e.id, e);
      byDevice[e.deviceId] = (byDevice[e.deviceId] || 0) + 1;
    } else {
      existing++;
      if (stableStringify(l) !== stableStringify(e)) conflicts++;
    }
  }
  if (conflicts) why(`${conflicts} event(s) share an id with a different local event; the local copy was kept`);
  const merged = rebuild(local.events.concat(newEvents));

  const writes = { packs: [], profiles: [] };
  for (const s of CONTENT_STORES) writes[s] = [];
  const counts = {};
  const blank = () => ({ new: 0, updated: 0, unchanged: 0, skipped: 0 });

  // Packs: decide per pack, then items follow their pack.
  const localPacks = new Map(local.packs.map((p) => [p.id, p]));
  const decision = new Map();
  counts.packs = blank();
  for (const P of incoming.packs) {
    const L = localPacks.get(P.id);
    const life = merged.packs[P.id];
    let d;
    if (!L) d = life && life.installed === false ? 'uninstalled' : 'new';
    else if (L.version < P.version) d = 'update';
    else if (L.version === P.version) d = 'same';
    else d = 'older';
    decision.set(P.id, { d, version: d === 'same' || d === 'older' ? L.version : P.version });
    if (d === 'new') { writes.packs.push(P); counts.packs.new++; }
    else if (d === 'update') { writes.packs.push(P); counts.packs.updated++; }
    else if (d === 'same') counts.packs.unchanged++;
    else {
      counts.packs.skipped++;
      if (d === 'uninstalled') {
        const dev = merged.devices[life.deviceId];
        why(`pack "${P.id}" was uninstalled${dev && dev.name ? ` on ${dev.name}` : ''} on ${formatDate(localDate(life.ts))}, so it was not reinstalled`);
      } else why(`pack "${P.id}" v${P.version} is older than the installed v${L.version}`);
    }
  }

  for (const s of CONTENT_STORES) {
    const c = (counts[s] = blank());
    const localMap = new Map(local[s].map((x) => [x.id, x]));
    for (const I of incoming[s]) {
      if (I._pack === SELF_PACK) continue;
      const l = localMap.get(I.id);
      const dec = decision.get(I._pack);
      if (!dec) {
        const L = localPacks.get(I._pack);
        if (!l && L && I._v === L.version) { writes[s].push(I); c.new++; }
        else if (l && sameContent(l, I)) c.unchanged++;
        else { c.skipped++; why(`${s} without their pack record were skipped`); }
        continue;
      }
      if (dec.d === 'uninstalled' || dec.d === 'older') {
        if (l && sameContent(l, I)) c.unchanged++; else c.skipped++;
        continue;
      }
      if (I._v < dec.version) { c.skipped++; why(`${s} from an older version of their pack were skipped`); continue; }
      if (!l) { writes[s].push(I); c.new++; }
      else if (l._pack !== I._pack) { c.skipped++; why(`${s} whose id belongs to a different local pack were skipped`); }
      else if (I._v > l._v) { writes[s].push(I); c.updated++; }
      else if (sameContent(l, I)) c.unchanged++;
      else { c.skipped++; why(`${s} with the same version but different content kept the local copy`); }
    }
  }

  // Profiles: higher version wins.
  counts.profiles = blank();
  const localProfiles = new Map(local.profiles.map((p) => [p.id, p]));
  for (const p of incoming.profiles) {
    const l = localProfiles.get(p.id);
    if (validateProfile(p).length) { counts.profiles.skipped++; why(`profile "${p.id}" failed validation`); continue; }
    if (!l) { writes.profiles.push(p); counts.profiles.new++; }
    else if (p.version > l.version) { writes.profiles.push(p); counts.profiles.updated++; }
    else counts.profiles.unchanged++;
  }

  const changes = newEvents.length + Object.values(writes).reduce((n, w) => n + w.length, 0);
  return {
    events: { new: newEvents.length, existing, conflicts, byDevice, totalAfter: local.events.length + newEvents.length },
    newEvents,
    writes,
    counts,
    reasons: [...reasons].map(([msg, n]) => (n > 1 && !/^\d/.test(msg) ? `${msg} (${n})` : msg)),
    changes,
    devices: merged.devices,
  };
}

export async function planBackupImport(db, text) {
  const parsed = parseBackup(text);
  if (parsed.errors.length) return { errors: parsed.errors, warnings: parsed.warnings };
  const b = parsed.backup;
  const local = {};
  for (const s of MERGED) local[s] = await db.getAll(s);
  const screened = screenIncomingPacks(b.stores, local.profiles.concat(b.stores.profiles));
  const plan = planMerge(local, screened.stores);
  for (const [id, msg] of screened.rejected) plan.reasons.unshift(`pack "${id}" in the backup failed validation and was skipped — ${msg}`);
  plan.warnings = parsed.warnings;
  plan.errors = [];
  plan.from = { deviceId: b.deviceId, deviceName: b.deviceName, exportedAt: b.exportedAt, appVersion: b.appVersion };
  plan.ignored = NOT_MERGED.filter((s) => b.stores[s].length);
  return plan;
}

export async function commitBackupImport(db, plan) {
  const stores = ['events', 'packs', 'profiles', ...CONTENT_STORES];
  await db.tx(stores, 'readwrite', (s) => {
    for (const e of plan.newEvents) s.events.put(e);
    for (const name of stores) {
      if (name === 'events') continue;
      for (const x of plan.writes[name] || []) s[name].put(x);
    }
  }, 'strict');
  return { newEvents: plan.newEvents.length, changes: plan.changes };
}
