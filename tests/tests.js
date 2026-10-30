// SMRITI in-browser self-tests: validator, merge, rebuild, ULID, profiles, integrity, and
// end-to-end IndexedDB round trips on throwaway databases (your real data is not touched).

import { validatePack, checkReferences, parsePackText } from '../js/schema.js';
import { rebuild, applyEvent, quarantineStatus } from '../js/rebuild.js';
import { makeEvent, checkEvent } from '../js/events.js';
import { ulid, ULID_RE, decodeTime } from '../js/ulid.js';
import { planMerge, parseBackup, exportBackup, planBackupImport, commitBackupImport } from '../js/backup.js';
import { planPackImport, commitPackPlans, uninstallPack, willWrite } from '../js/packs.js';
import { refreshDerived } from '../js/derived.js';
import { openDB, deleteDB, CONTENT_STORES } from '../js/db.js';
import { validateProfile, effectiveProfile, profileContext, phaseOn, checkEdit } from '../js/profiles.js';
import { scanIntegrity, countByNode, countBySubtree } from '../js/integrity.js';
import { contentHash, stableStringify, isIsoDate } from '../js/util.js';
import { APP_VERSION } from '../js/version.js';
import { demoFiles, demoPacks, profiles as loadProfiles, schemaExample, clone } from './fixtures.js';

const tests = [];
const test = (group, name, fn) => tests.push({ group, name, fn });

function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
function eq(actual, expected, msg) {
  const a = stableStringify(actual);
  const b = stableStringify(expected);
  if (a !== b) throw new Error(`${msg ? `${msg}: ` : ''}expected ${b.slice(0, 300)}, got ${a.slice(0, 300)}`);
}
const hasError = (r, path, re) => r.errors.some((e) => e.path === path && (!re || re.test(e.msg)));
const errorPaths = (r) => r.errors.map((e) => `${e.path}: ${e.msg}`).join(' | ');

let CTX = null;      // {papers, exams, starter}
let PROFILES = null;
let DEMO = null;     // {file: json}

async function setup() {
  PROFILES = await loadProfiles();
  CTX = profileContext(PROFILES);
  DEMO = await demoPacks();
}
const content = () => clone(DEMO['demo-polity.json']);
const syllabus = () => clone(DEMO['demo-polity-syllabus.json']);
const v = (raw) => validatePack(raw, { papers: CTX.papers, exams: CTX.exams });

// ------------------------------------------------------------------ validator

test('Validator', 'demo packs validate with no errors', () => {
  for (const [name, raw] of Object.entries(DEMO)) {
    const r = v(raw);
    assert(!r.errors.length, `${name}: ${errorPaths(r)}`);
  }
});

test('Validator', 'demo content matches the spec: 30 atoms, 15 probes in every format, 5 PYQs, 3 CA, 1 answer', () => {
  const c = content();
  eq([c.atoms.length, c.probes.length, c.pyqs.length, c.ca.length, c.answers.length], [30, 15, 5, 3, 1]);
  eq([...new Set(c.probes.map((p) => p.format))].sort(), ['assertionReason', 'cloze', 'explain', 'identify', 'match', 'notCorrect', 'odd', 'order', 'statement', 'tf']);
  assert(c.atoms.every((a) => a.source && (a.source.pyq || a.source.page || a.origin === 'model')), 'every atom has a source page');
});

test('Validator', 'the schema example from the build kit validates', () => {
  const r = v(clone(schemaExample));
  assert(!r.errors.length, errorPaths(r));
});

test('Validator', 'a deleted required field gives a precise error', () => {
  const c = content();
  delete c.atoms[0].answer;
  const r = v(c);
  assert(hasError(r, 'atoms[0].answer', /required/), errorPaths(r));
});

test('Validator', 'missing pack.title and pack block are errors', () => {
  const c = content();
  delete c.pack.title;
  assert(hasError(v(c), 'pack.title', /required/));
  const d = content();
  delete d.pack;
  assert(hasError(v(d), 'pack', /required/));
});

test('Validator', 'statement sets need 2–4 statements', () => {
  const c = content();
  const p = c.probes.find((x) => x.format === 'statement');
  const i = c.probes.indexOf(p);
  p.statements = [p.statements[0]];
  assert(hasError(v(c), `probes[${i}].statements`, /2–4/), errorPaths(v(c)));
  p.statements = Array(5).fill(p.statements[0]);
  assert(hasError(v(c), `probes[${i}].statements`, /2–4/));
});

test('Validator', 'match needs 3–4 pairs', () => {
  const c = content();
  const i = c.probes.findIndex((x) => x.format === 'match');
  c.probes[i].pairs = c.probes[i].pairs.slice(0, 2);
  assert(hasError(v(c), `probes[${i}].pairs`, /3–4/), errorPaths(v(c)));
});

test('Validator', 'unknown trap tag is an error', () => {
  const c = content();
  const i = c.probes.findIndex((x) => x.format === 'statement');
  const j = c.probes[i].statements.findIndex((s) => !s.true);
  c.probes[i].statements[j].trap = 'trick';
  assert(hasError(v(c), `probes[${i}].statements[${j}].trap`, /unknown trap tag/));
});

test('Validator', 'impossible dates are rejected', () => {
  assert(!isIsoDate('2026-02-30') && !isIsoDate('2026-13-01') && isIsoDate('2028-02-29'));
  const c = content();
  c.ca[0].date = '2025-02-30';
  assert(hasError(v(c), 'ca[0].date', /real date/));
});

test('Validator', 'duplicate ids within a pack are errors', () => {
  const c = content();
  c.atoms[5].id = c.atoms[4].id;
  assert(hasError(v(c), 'atoms[5].id', /duplicate/));
});

test('Validator', 'atom ids must be <packId>.<4 digits>', () => {
  const c = content();
  c.atoms[0].id = 'demo-polity.1';
  assert(hasError(v(c), 'atoms[0].id', /4 digits/));
});

test('Validator', 'MCQ needs exactly 4 options and an index answer', () => {
  const c = content();
  c.pyqs[0].options.pop();
  assert(hasError(v(c), 'pyqs[0].options', /exactly 4/));
  const d = content();
  d.probes[2].answer = 'a';
  assert(hasError(v(d), 'probes[2].answer', /index/));
});

test('Validator', 'CA items need at least one static anchor', () => {
  const c = content();
  c.ca[1].anchors = [];
  assert(hasError(v(c), 'ca[1].anchors', /at least 1/));
});

test('Validator', 'unknown paper id is an error', () => {
  const c = content();
  c.pyqs[0].paper = 'cse.pre.gs9';
  assert(hasError(v(c), 'pyqs[0].paper', /unknown paper/));
});

test('Validator', 'atoms over 35 words warn but do not reject', () => {
  const c = content();
  c.atoms[0].text = `${'word '.repeat(40)}___`;
  const r = v(c);
  assert(!r.errors.length && r.warnings.some((w) => w.path === 'atoms[0].text'), errorPaths(r));
});

test('Validator', 'misspelt fields warn; "_" fields are reserved', () => {
  const c = content();
  c.atoms[0].anwser = 'x';
  c.atoms[1]._v = 9;
  const r = v(c);
  assert(r.warnings.some((w) => /anwser/.test(w.msg)), 'warns on anwser');
  assert(hasError(r, 'atoms[1]._v', /reserved/));
});

test('Validator', 'report counts that do not match warn about truncation', () => {
  const c = content();
  c.atoms.pop();
  assert(v(c).warnings.some((w) => w.path === 'pack.report.counts.atoms' && /truncated/.test(w.msg)));
});

test('Validator', 'broken JSON reports line and column', () => {
  const r = parsePackText('{\n  "pack": {\n    "id": "x",,\n  }\n}');
  assert(r.error && /line 3/.test(r.error), r.error);
});

test('Validator', 'a backup file is recognised and refused as a pack', () => {
  assert(hasError(v({ format: 'smriti-backup', stores: {} }), '(file)', /backup/));
});

test('Validator', 'unresolved references warn (orphans) and parent loops are errors', () => {
  const c = v(content());
  const known = { nodes: new Set(), nodeParents: new Map(), atoms: new Set(c.items.atoms.map((a) => a.id)), pyqs: new Set(c.items.pyqs.map((q) => q.id)), ca: new Set(c.items.ca.map((x) => x.id)), packs: new Set(['demo-polity']) };
  const r = checkReferences(c, known);
  assert(!r.errors.length && r.warnings.length && r.orphans > 0, 'content without its syllabus has orphan warnings');
  const s = v(syllabus());
  const parents = new Map([['cse.gs2.polity', 'cse.gs2.polity.fr']]);
  for (const n of s.items.nodes) parents.set(n.id, n.parent);
  const loop = checkReferences(s, { ...known, nodes: new Set([...parents.keys()]), nodeParents: parents });
  assert(loop.errors.some((e) => /loops/.test(e.msg)), 'detects a parent cycle');
});

// ------------------------------------------------------------------ ULID and events

test('ULID & events', '10,000 ULIDs are unique, valid, sorted and decode their time', () => {
  const t = Date.UTC(2026, 9, 30, 12, 0, 0);
  const ids = [];
  for (let i = 0; i < 10000; i++) ids.push(ulid(t + Math.floor(i / 100)));
  assert(new Set(ids).size === ids.length, 'unique');
  assert(ids.every((id) => ULID_RE.test(id)), 'format');
  assert(ids.every((id, i) => i === 0 || ids[i - 1] < id), 'monotonic');
  assert(decodeTime(ids[0]) === t, 'decodes time');
});

test('ULID & events', 'events are checked for shape', () => {
  const e = makeEvent('settings.set', { key: 'k', value: 1 }, 'DEV', 1000);
  assert(checkEvent(e) === null);
  assert(checkEvent({ ...e, id: 'nope' }) !== null && checkEvent({ ...e, ts: 'x' }) !== null && checkEvent({ ...e, payload: 3 }) !== null);
});

// ------------------------------------------------------------------ rebuild

const DEV_A = '01JA0000000000000000000AAA';
const DEV_B = '01JB0000000000000000000BBB';
function sampleEvents() {
  const t = Date.UTC(2026, 9, 30);
  return [
    makeEvent('pack.installed', { packId: 'p', version: 1 }, DEV_A, t),
    makeEvent('settings.set', { key: 'activeProfile', value: 'cse-2028' }, DEV_A, t + 1),
    makeEvent('atom.approved', { atomId: 'p.0001', hash: 'h1' }, DEV_B, t + 2),
    makeEvent('settings.set', { key: 'activeProfile', value: 'capf-ac-2027' }, DEV_B, t + 3),
    makeEvent('profile.set', { profileId: 'cse-2028', path: 'dates.prelims.date', value: '2028-05-21' }, DEV_A, t + 4),
    makeEvent('future.thing', { x: 1 }, DEV_B, t + 5),
    makeEvent('backup.exported', { deviceName: 'phone' }, DEV_B, t + 6),
    makeEvent('pack.uninstalled', { packId: 'p', version: 1 }, DEV_A, t + 7),
    makeEvent('pack.installed', { packId: 'p', version: 2 }, DEV_B, t + 8),
  ];
}

test('Rebuild', 'same events in any order give the same state', () => {
  const ev = sampleEvents();
  const a = rebuild(ev);
  for (let k = 0; k < 20; k++) {
    const shuffled = ev.slice().sort(() => Math.random() - 0.5);
    eq(rebuild(shuffled), a, 'shuffled');
  }
});

test('Rebuild', 'incremental apply equals a full rebuild', () => {
  const ev = sampleEvents();
  let s = rebuild([]);
  for (const e of ev) s = applyEvent(s, e);
  eq(s, rebuild(ev));
});

test('Rebuild', 'is pure: inputs are not mutated', () => {
  const ev = sampleEvents();
  const before = stableStringify(ev);
  const s0 = rebuild(ev.slice(0, 3));
  const s0s = stableStringify(s0);
  rebuild(ev);
  applyEvent(s0, ev[3]);
  assert(stableStringify(ev) === before && stableStringify(s0) === s0s);
});

test('Rebuild', 'settings are last-writer-wins; profile edits apply; unknown types are kept', () => {
  const s = rebuild(sampleEvents());
  eq(s.settings.activeProfile, 'capf-ac-2027');
  eq(s.profileEdits['cse-2028'], { 'dates.prelims.date': '2028-05-21' });
  eq([s.unknown, s.count], [1, 9]);
  eq(s.devices[DEV_B].name, 'phone');
});

test('Rebuild', 'pack lifecycle: install → uninstall → reinstall', () => {
  const s = rebuild(sampleEvents());
  eq(s.packs.p.installed, true);
  eq(s.packs.p.version, 2);
  const s2 = rebuild(sampleEvents().slice(0, 8));
  eq(s2.packs.p.installed, false);
});

test('Rebuild', 'quarantine: approval holds only for the exact content approved', () => {
  const atom = { id: 'p.0001', type: 'fact', text: 'x ___', answer: 'y', nodes: ['n'], source: { pack: 'p', page: 1 }, origin: 'model', verify: true, _pack: 'p', _v: 1 };
  const plain = { ...atom, origin: 'source', verify: false };
  const t = Date.UTC(2026, 9, 30);
  eq(quarantineStatus(plain, rebuild([])), 'clear');
  eq(quarantineStatus(atom, rebuild([])), 'quarantined');
  const ok = rebuild([makeEvent('atom.approved', { atomId: atom.id, hash: contentHash(atom) }, DEV_A, t)]);
  eq(quarantineStatus(atom, ok), 'approved');
  eq(quarantineStatus({ ...atom, _v: 2 }, ok), 'approved', 'metadata changes do not matter');
  eq(quarantineStatus({ ...atom, answer: 'z' }, ok), 'quarantined', 'content change re-quarantines');
  const gone = rebuild([makeEvent('atom.discarded', { atomId: atom.id, hash: 'x' }, DEV_A, t)]);
  eq(quarantineStatus(atom, gone), 'discarded');
});

// ------------------------------------------------------------------ merge (pure)

const item = (id, pack, ver, extra = {}) => ({ id, _pack: pack, _v: ver, text: `t-${id}`, ...extra });
const emptySet = () => ({ events: [], packs: [], profiles: [], sources: [], nodes: [], atoms: [], probes: [], pyqs: [], ca: [], answers: [], notes: [] });
function applyPlan(local, plan) {
  const out = clone(local);
  out.events = out.events.concat(plan.newEvents);
  for (const [store, list] of Object.entries(plan.writes)) {
    for (const x of list) {
      const i = out[store].findIndex((y) => y.id === x.id);
      if (i >= 0) out[store][i] = x; else out[store].push(x);
    }
  }
  return out;
}
function deviceSet(dev, t0, packVersion, atoms) {
  const s = emptySet();
  s.events = [makeEvent('pack.installed', { packId: 'p', version: packVersion }, dev, t0), makeEvent('atom.approved', { atomId: atoms[0], hash: 'h' }, dev, t0 + 10)];
  s.packs = [{ id: 'p', version: packVersion, _v: packVersion, title: 'P' }];
  s.atoms = atoms.map((a) => item(a, 'p', packVersion));
  return s;
}

test('Merge', 'events union by id; importing twice changes nothing', () => {
  const t = Date.UTC(2026, 9, 30);
  const A = deviceSet(DEV_A, t, 1, ['p.0001', 'p.0002']);
  const B = deviceSet(DEV_B, t + 100, 1, ['p.0001', 'p.0002']);
  const p1 = planMerge(A, B);
  eq([p1.events.new, p1.events.existing], [2, 0]);
  const A2 = applyPlan(A, p1);
  const p2 = planMerge(A2, B);
  eq([p2.events.new, p2.changes], [0, 0], 'second import');
});

test('Merge', 'cross-import in both directions gives identical events and state', () => {
  const t = Date.UTC(2026, 9, 30);
  const A = deviceSet(DEV_A, t, 1, ['p.0001', 'p.0002']);
  const B = deviceSet(DEV_B, t + 5, 1, ['p.0001', 'p.0002']);
  const A2 = applyPlan(A, planMerge(A, B));
  const B2 = applyPlan(B, planMerge(B, A2));
  const ids = (s) => s.events.map((e) => e.id).sort();
  eq(ids(A2), ids(B2));
  eq(rebuild(A2.events), rebuild(B2.events));
});

test('Merge', 'content keeps the higher pack version and never deletes', () => {
  const t = Date.UTC(2026, 9, 30);
  const A = deviceSet(DEV_A, t, 1, ['p.0001', 'p.0002', 'p.0003']);
  A.notes = [item('local-only', 'q', 1)];
  const B = deviceSet(DEV_B, t + 5, 2, ['p.0001', 'p.0002']);
  B.atoms[0].text = 'changed in v2';
  const plan = planMerge(A, B);
  eq(plan.counts.packs.updated, 1);
  eq(plan.counts.atoms.updated, 2, 'both v2 atoms update');
  const A2 = applyPlan(A, plan);
  assert(A2.atoms.find((a) => a.id === 'p.0003'), 'local item missing from the backup is kept');
  assert(A2.notes.length === 1, 'never deletes');
  eq(A2.atoms.find((a) => a.id === 'p.0001').text, 'changed in v2');
  // and the reverse: older content in a backup does not overwrite newer local content
  const back = planMerge(A2, A);
  eq([back.counts.atoms.updated, back.counts.packs.updated], [0, 0]);
  assert(back.writes.atoms.length === 0, 'stale v1 items are skipped');
});

test('Merge', 'a pack uninstalled here is not resurrected by an older backup', () => {
  const t = Date.UTC(2026, 9, 30);
  const B = deviceSet(DEV_B, t, 1, ['p.0001']);
  const A = emptySet();
  A.events = B.events.concat(makeEvent('pack.uninstalled', { packId: 'p', version: 1 }, DEV_A, t + 50));
  const plan = planMerge(A, B);
  eq([plan.counts.packs.skipped, plan.writes.atoms.length, plan.writes.packs.length], [1, 0, 0]);
  assert(plan.reasons.some((r) => /uninstalled/.test(r)), 'explains why');
});

test('Merge', 'backup files are validated', () => {
  assert(parseBackup('not json').errors.length === 1);
  assert(parseBackup(JSON.stringify({ format: 'smriti-backup', formatVersion: 99, stores: {} })).errors[0].msg.includes('newer'));
  const bad = { format: 'smriti-backup', formatVersion: 1, stores: { events: [{ id: 'x' }] } };
  assert(parseBackup(JSON.stringify(bad)).errors[0].path === 'stores.events[0]');
  assert(/content pack/.test(parseBackup(JSON.stringify(schemaExample)).errors[0].msg));
});

// ------------------------------------------------------------------ profiles

test('Profiles', 'bundled profiles validate', () => {
  for (const p of PROFILES) eq(validateProfile(p), [], p.id);
  const cse = PROFILES.find((p) => p.id === 'cse-2028');
  const gs1 = cse.papers.find((x) => x.id === 'cse.pre.gs1');
  eq([gs1.questions, gs1.marks, gs1.durationMin, Object.values(gs1.formatMix).reduce((a, b) => a + b, 0)], [100, 200, 120, 100]);
  assert(cse.dates.prelims.tentative && cse.dates.mains.tentative, 'CSE 2028 dates are tentative');
  assert(cse.syllabus.some((n) => n.id === 'cse.opt1') && cse.syllabus.some((n) => n.id === 'cse.opt2'), 'Anthropology papers present');
});

test('Profiles', 'overrides apply, reset, and reject bad paths', () => {
  const cse = PROFILES.find((p) => p.id === 'cse-2028');
  const e = effectiveProfile(cse, { 'dates.prelims.date': '2028-05-21', 'phases.foundation.until': '2028-01-15', 'papers.0.marks': 1 });
  eq([e.dates.prelims.date, e.phases[0].until, e.papers[0].marks], ['2028-05-21', '2028-01-15', 200]);
  assert(checkEdit(cse, 'papers.0.marks', 1) !== null && checkEdit(cse, 'dates.prelims.date', '2028-02-30') !== null);
  eq(effectiveProfile(cse, {}).dates.prelims.date, cse.dates.prelims.date);
});

test('Profiles', 'phase of the year', () => {
  const cse = PROFILES.find((p) => p.id === 'cse-2028');
  eq([phaseOn(cse, '2026-10-30').id, phaseOn(cse, '2028-02-01').id, phaseOn(cse, '2028-05-28').id, phaseOn(cse, '2028-05-29').id], ['foundation', 'prelims', 'prelims', 'mains']);
});

// ------------------------------------------------------------------ integrity

test('Integrity', 'removing the syllabus marks content orphaned; counts follow nodes', () => {
  const s = v(syllabus());
  const c = v(content());
  const all = { packs: [{ id: 'demo-polity-syllabus', version: 1 }, { id: 'demo-polity', version: 1 }], nodes: s.items.nodes, atoms: c.items.atoms, probes: c.items.probes, pyqs: c.items.pyqs, ca: c.items.ca, answers: c.items.answers, notes: c.items.notes };
  const ok = scanIntegrity(all, CTX.starter, rebuild([]));
  eq(ok.orphans, [], 'no orphans with both packs');
  const counts = countByNode(all);
  eq(counts['cse.gs2.polity.parliament.devices'].atoms, 3);
  const parentOf = new Map([...CTX.starter.values(), ...all.nodes].map((n) => [n.id, n.parent]));
  const sub = countBySubtree(all, parentOf);
  eq([sub['cse.gs2'].atoms, sub['cse.gs2.polity'].atoms, sub['cse.gs2'].ca, sub['cse.gs2'].pyqs], [30, 30, 3, 5], 'subtree counts each item once');
  eq(sub['cse.gs2.polity.parliament'].atoms, 11, 'parliament subtree: 4 own + 3 devices + 4 legislation, the shared atom once');
  const broken = scanIntegrity({ ...all, nodes: [], packs: [all.packs[1]] }, CTX.starter, rebuild([]));
  assert(broken.orphans.filter((o) => o.store === 'atoms').length === 30, 'all 30 atoms orphaned');
});

// ------------------------------------------------------------------ IndexedDB end to end

const DB_A = 'smriti-selftest-a';
const DB_B = 'smriti-selftest-b';
let dbA = null;
let dbB = null;
const T0 = Date.UTC(2026, 9, 30, 9, 0, 0);

async function freshDB(name) {
  await deleteDB(name);
  const db = await openDB(name);
  for (const p of PROFILES) await db.put('profiles', p);
  return db;
}

test('End to end', 'install the demo packs into a scratch database', async () => {
  dbA = await freshDB(DB_A);
  const plan = await planPackImport(dbA, await demoFiles());
  eq(plan.map((e) => e.action), ['install', 'install'], plan.map((e) => errorPaths(e)).join(' '));
  eq(plan.map((e) => e.totals.new), [12, 55]);
  await commitPackPlans(dbA, plan, { deviceId: DEV_A, now: T0 });
  const d = await refreshDerived(dbA);
  eq([d.summary.counts.atoms, d.summary.counts.events, d.summary.quarantine, d.summary.orphans], [30, 2, 2, 0]);
});

test('End to end', 'importing the demo pack again reports 0 new, 0 updated and writes nothing', async () => {
  const plan = await planPackImport(dbA, await demoFiles());
  eq(plan.map((e) => [e.action, e.totals.new, e.totals.updated]), [['unchanged', 0, 0], ['unchanged', 0, 0]]);
  assert(!plan.some(willWrite));
  eq(await dbA.count('events'), 2);
});

test('End to end', 'a pack with a deleted required field is rejected and nothing is imported', async () => {
  const raw = content();
  raw.pack.id = 'broken-pack';
  for (const k of ['atoms', 'probes', 'pyqs', 'ca', 'answers', 'notes']) delete raw[k];
  raw.atoms = [{ id: 'broken-pack.0001', type: 'fact', text: 'x ___', nodes: ['cse.gs2.polity'], source: { pack: 'broken-pack', page: 1 }, origin: 'source', verify: false }];
  delete raw.pack.report.counts;
  const before = await dbA.count('atoms');
  const plan = await planPackImport(dbA, [{ name: 'broken.json', text: JSON.stringify(raw) }]);
  eq(plan[0].action, 'reject');
  assert(plan[0].errors.some((e) => e.path === 'atoms[0].answer'), errorPaths(plan[0]));
  await commitPackPlans(dbA, plan, { deviceId: DEV_A, now: T0 });
  eq([await dbA.count('atoms'), await dbA.get('packs', 'broken-pack')], [before, undefined]);
});

let backupA = null;
test('End to end', 'export from A, import into B: identical event counts', async () => {
  backupA = await exportBackup(dbA, { deviceId: DEV_A, deviceName: 'laptop', now: T0 + 1000 });
  assert(/^smriti-backup-laptop-\d{4}-\d{2}-\d{2}\.json$/.test(backupA.fileName), backupA.fileName);
  dbB = await freshDB(DB_B);
  const plan = await planBackupImport(dbB, backupA.text);
  eq(plan.errors, []);
  eq(plan.events.new, 3);
  await commitBackupImport(dbB, plan);
  const d = await refreshDerived(dbB);
  eq([await dbA.count('events'), d.summary.counts.events, d.summary.counts.atoms], [3, 3, 30]);
});

test('End to end', 'importing the same backup twice changes nothing', async () => {
  const plan = await planBackupImport(dbB, backupA.text);
  eq([plan.changes, plan.events.new], [0, 0]);
});

test('End to end', 'the reverse direction: B → A gives identical events and state', async () => {
  const atoms = await dbB.getAll('atoms');
  const q = atoms.find((a) => a.verify);
  await dbB.put('events', makeEvent('atom.approved', { atomId: q.id, hash: contentHash(q) }, DEV_B, T0 + 2000));
  const backupB = await exportBackup(dbB, { deviceId: DEV_B, deviceName: 'phone', now: T0 + 3000 });
  const plan = await planBackupImport(dbA, backupB.text);
  eq(plan.events.new, 2);
  await commitBackupImport(dbA, plan);
  const ea = await dbA.getAll('events');
  const eb = await dbB.getAll('events');
  eq(ea.map((e) => e.id).sort(), eb.map((e) => e.id).sort());
  eq(rebuild(ea), rebuild(eb));
  const da = await refreshDerived(dbA);
  eq(da.summary.quarantine, 1);
});

test('End to end', 'uninstall removes content, keeps events, marks orphans; a backup does not bring it back', async () => {
  const before = await dbA.count('events');
  await uninstallPack(dbA, 'demo-polity', { deviceId: DEV_A, now: T0 + 4000 });
  const d = await refreshDerived(dbA);
  eq([d.summary.counts.atoms, d.summary.counts.events, d.integrity.orphanStates.length], [0, before + 1, 1]);
  for (const s of CONTENT_STORES) if (s !== 'nodes') eq(await dbA.count(s), 0, s);
  const backupB = await exportBackup(dbB, { deviceId: DEV_B, deviceName: 'phone', now: T0 + 5000 });
  const plan = await planBackupImport(dbA, backupB.text);
  await commitBackupImport(dbA, plan);
  eq(await dbA.count('atoms'), 0, 'not resurrected');
  assert(plan.reasons.some((r) => /uninstalled/.test(r)));
});

test('End to end', 'clean up scratch databases', async () => {
  dbA.close();
  dbB.close();
  await deleteDB(DB_A);
  await deleteDB(DB_B);
});

// ------------------------------------------------------------------ app shell

test('App shell', 'sw.js VERSION matches the app version', async () => {
  const text = await (await fetch(new URL('../sw.js', import.meta.url), { cache: 'no-store' })).text();
  const m = /const VERSION = '([^']+)'/.exec(text);
  eq(m && m[1], APP_VERSION);
});

test('App shell', 'every precached file is reachable', async () => {
  const swUrl = new URL('../sw.js', import.meta.url);
  const text = await (await fetch(swUrl, { cache: 'no-store' })).text();
  const block = text.split('/* ASSETS:START */')[1].split('/* ASSETS:END */')[0];
  const urls = [...block.matchAll(/'([^']+)'/g)].map((m) => m[1]);
  assert(urls.length > 20, 'asset list found');
  const missing = [];
  for (const u of urls) {
    const r = await fetch(new URL(u, swUrl));
    if (!r.ok) missing.push(`${u} (${r.status})`);
  }
  eq(missing, []);
});

// ------------------------------------------------------------------ runner

async function run() {
  const out = document.getElementById('results');
  const sum = document.getElementById('summary');
  out.textContent = '';
  sum.textContent = 'Running…';
  sum.className = 'summary';
  const t0 = performance.now();
  const results = [];
  try {
    await setup();
  } catch (e) {
    sum.textContent = `Setup failed: ${e.message}`;
    sum.className = 'summary fail';
    window.__SMRITI_TESTS__ = { done: true, passed: 0, failed: 1, results: [{ group: 'Setup', name: 'load fixtures', ok: false, error: e.message }] };
    return;
  }
  let group = null;
  let list = null;
  for (const t of tests) {
    if (t.group !== group) {
      group = t.group;
      out.append(Object.assign(document.createElement('h2'), { textContent: group }));
      list = document.createElement('ul');
      out.append(list);
    }
    const li = document.createElement('li');
    let ok = true;
    let error = null;
    const s = performance.now();
    try { await t.fn(); } catch (e) { ok = false; error = e.message || String(e); console.error(t.name, e); }
    const ms = Math.round(performance.now() - s);
    li.className = ok ? 'pass' : 'fail';
    li.textContent = `${ok ? '✓' : '✗'} ${t.name} (${ms} ms)`;
    if (error) li.append(Object.assign(document.createElement('pre'), { textContent: error }));
    list.append(li);
    results.push({ group: t.group, name: t.name, ok, error, ms });
  }
  const failed = results.filter((r) => !r.ok).length;
  sum.textContent = `${results.length - failed} passed, ${failed} failed in ${((performance.now() - t0) / 1000).toFixed(1)} s`;
  sum.className = `summary ${failed ? 'fail' : 'pass'}`;
  window.__SMRITI_TESTS__ = { done: true, passed: results.length - failed, failed, results };
}

document.getElementById('rerun').addEventListener('click', run);
run();
