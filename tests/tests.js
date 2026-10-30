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
import { review as fsrsReview, preview as fsrsPreview, newCard, State } from '../js/fsrs.js';
import { suggestRating, evaluate, chooseProbe, formatWeights, targetMs, autoCard, contrastProbe, shuffled } from '../js/probes.js';
import { answerMatches, clozeTargets, makeCloze } from '../js/cloze.js';
import { buildQueue, interleave, examAnchor, anchoredDue, reviewCapFor, isArchived } from '../js/queue.js';
import { detectConfusions } from '../js/confusion.js';
import { ankiTsv } from '../js/anki.js';
import { suggestByKeywords, suggestFromPack, reflow } from '../js/sources.js';
import { pairKey } from '../js/rebuild.js';

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


// ------------------------------------------------------------------ Phase 2: scheduling and rating

const T1 = Date.UTC(2026, 10, 2, 4, 0, 0);
const ev = (type, payload, ts, dev = DEV_A) => makeEvent(type, payload, dev, ts);
const DAYMS = 86400000;

test('FSRS', 'cards are deterministic and follow the learning steps', () => {
  const run = () => {
    let c = null;
    const out = [];
    let t = T1;
    for (const r of [3, 3, 1, 3, 4]) { c = fsrsReview(c, t, r); out.push([c.state, c.due - t]); t = c.due + 3600e3; }
    return out;
  };
  eq(run(), run());
  const first = fsrsReview(null, T1, 3);
  eq(first.state, State.Learning);
  eq(first.due - T1, 10 * 60e3, 'Good on a new card waits 10 minutes');
  eq(fsrsReview(null, T1, 4).state, State.Review, 'Easy graduates at once');
  const p = fsrsPreview(newCard(T1), T1);
  assert(p[1].due < p[3].due && p[3].due < p[4].due, 'Again < Good < Easy');
});

test('Rating', 'suggested rating follows the contract', () => {
  const base = { correct: true, partial: false, ms: 5000, target: 8000, prevRating: 3, format: 'cloze' };
  eq(suggestRating({ ...base, correct: false, confidence: 'sure' }), 1, 'wrong → Again');
  eq(suggestRating({ ...base, confidence: 'guess' }), 2, 'Guess → Hard');
  eq(suggestRating({ ...base, confidence: '5050' }), 2, '50-50 → Hard');
  eq(suggestRating({ ...base, confidence: 'sure', ms: 9000 }), 2, 'slow → Hard');
  eq(suggestRating({ ...base, confidence: 'sure' }), 3, 'sure within target → Good');
  eq(suggestRating({ ...base, confidence: 'sure', ms: 3000 }), 4, 'under 40% after Good → Easy');
  eq(suggestRating({ ...base, confidence: 'sure', ms: 3000, prevRating: 2 }), 3, 'no Easy without a previous Good');
  eq(suggestRating({ ...base, confidence: 'sure', ms: 3000, prevRating: undefined }), 3, 'new atom: no Easy');
  eq(suggestRating({ ...base, confidence: 'sure', partial: true }), 2, 'lucky pass held at Hard');
  eq(suggestRating({ correct: true, format: 'explain', ratio: 1, prevRating: 3 }), 4);
  eq(suggestRating({ correct: true, format: 'explain', ratio: 0.8 }), 3);
  eq(suggestRating({ correct: true, format: 'explain', ratio: 0.6 }), 2);
});

test('Rating', 'speed targets: 8 s per card, 72 s per Prelims question', () => {
  const cse = PROFILES.find((p) => p.id === 'cse-2028');
  eq(targetMs({ format: 'cloze' }, cse), 8000);
  eq(targetMs({ format: 'statement' }, cse), 72000);
  eq(targetMs({ format: 'match', pairs: [1, 2, 3] }, cse), 24000);
  eq(targetMs({ format: 'explain' }, cse), null);
});

test('Answers', 'typed answers are matched forgivingly but numbers exactly', () => {
  assert(answerMatches('42', '42nd') && answerMatches('42ND', '42nd'), 'ordinals');
  assert(answerMatches('speaker of lok sabha', 'Speaker of the Lok Sabha'), 'articles ignored');
  assert(answerMatches('habeus corpus', 'habeas corpus'), 'one typo');
  assert(!answerMatches('1977', '1976') && !answerMatches('44th', '42nd'), 'numbers exact');
  assert(!answerMatches('', 'x') && !answerMatches('orally', 'in writing'));
});

test('Answers', 'every format is checked correctly', () => {
  const c = content();
  const byFmt = (f) => c.probes.find((p) => p.format === f);
  eq(evaluate(byFmt('cloze'), { typed: '42nd' }).correct, true);
  eq(evaluate(byFmt('cloze'), { self: false }).correct, false);
  const st = byFmt('statement');
  eq(evaluate(st, { marks: st.statements.map((x) => x.true), choice: st.answer }), { correct: true, partial: false });
  eq(evaluate(st, { marks: st.statements.map(() => true), choice: st.answer }).partial, true, 'right option, wrong mark');
  const m = byFmt('match');
  eq(evaluate(m, { pairing: m.pairs.map((_, i) => i) }).correct, true);
  eq(evaluate(m, { pairing: [1, 0, 2] }).correct, false);
  const o = byFmt('order');
  eq(evaluate(o, { order: o.items.map((_, i) => i) }).correct, true);
  eq(evaluate(o, { order: [1, 0, 2, 3] }).correct, false);
  const x = byFmt('explain');
  eq(evaluate(x, { ticked: x.keyPoints.map(() => true) }).ratio, 1);
  eq(evaluate(x, { ticked: [true] }).correct, false);
  for (const f of ['tf', 'notCorrect', 'odd', 'assertionReason', 'identify']) {
    const p = byFmt(f);
    const right = f === 'tf' ? { marks: p.statements.map((s) => s.true) } : { choice: p.answer };
    eq(evaluate(p, right).correct, true, f);
  }
});

test('Chooser', 'least recently used format, weighted by the format mix', () => {
  const cse = PROFILES.find((p) => p.id === 'cse-2028');
  const c = content();
  const atom = c.atoms.find((a) => a.id === 'demo-polity.0016');
  const probes = c.probes.filter((p) => p.atoms.includes(atom.id));
  const w = formatWeights(cse, atom);
  const first = chooseProbe({ atom, probes, rec: null, probeUse: {}, weights: w, now: T1 });
  eq(first.probe.format, 'statement', 'never used: the exam-heavy format first');
  const rec = { formats: { statement: T1 } };
  const next = chooseProbe({ atom, probes, rec, probeUse: { [first.probe.id]: T1 }, weights: w, now: T1 + DAYMS });
  eq(next.probe.format, 'cloze', 'then the least recently used one');
  eq(autoCard(c.atoms.find((a) => a.id === 'demo-polity.0001')).format, 'cloze');
  eq(autoCard({ id: 'x.0001', text: 'Capital of India?', answer: 'New Delhi' }).format, 'qa');
});

test('Cloze', 'gap suggestions find Articles, amendments, years and names', () => {
  const t = clozeTargets('The 42nd Amendment Act, 1976 added Article 51A on the advice of the Swaran Singh Committee.').map((x) => x.text);
  for (const want of ['42nd', '51A', '1976', 'Swaran Singh Committee']) assert(t.includes(want), `${want} in ${t.join(' | ')}`);
  eq(makeCloze('Added in 1976.', '1976'), 'Added in ___.');
});

// ------------------------------------------------------------------ Phase 2: queue

function synthetic(nAtoms, nNodes, reviewed, now) {
  const atoms = [];
  const s = rebuild([]);
  for (let i = 0; i < nAtoms; i++) {
    const id = `syn.${String(i).padStart(4, '0')}`;
    atoms.push({ id, type: 'fact', text: `Fact ${i} is ___.`, answer: String(i), nodes: [`cse.syn.n${i % nNodes}`], source: { pack: 'syn', page: 1 }, origin: 'source', verify: false, _pack: 'syn', _v: 1 });
    if (i < reviewed) {
      s.atoms[id] = { card: { ...newCard(now - 30 * DAYMS), state: State.Review, s: 5 + (i % 20), d: 5, due: now - (i % 10) * DAYMS + (i % 3) * 3600e3, reps: 3, lapses: 0, last: now - 20 * DAYMS }, reviews: 3, firstTs: now - 30 * DAYMS, lastTs: now - 20 * DAYMS, lastRating: 3 };
    }
  }
  return { atoms, s };
}

test('Queue', 'a 5,000-atom queue builds in under 1 s, interleaved and capped', () => {
  const now = Date.UTC(2026, 10, 2, 6);
  const dayStart = now - 6 * 3600e3;
  const { atoms, s } = synthetic(5000, 120, 3000, now);
  const t0 = performance.now();
  const q = buildQueue({ atoms, state: s, now, dayStart, dayEnd: dayStart + DAYMS, profile: PROFILES.find((p) => p.id === 'cse-2028'), limits: { newPerDay: 30, reviewCap: 200 }, nodeOrder: new Map() });
  const ms = performance.now() - t0;
  assert(ms < 1000, `took ${Math.round(ms)} ms`);
  eq(q.counts.cap, 200);
  assert(q.items.length <= 200, 'respects the cap');
  assert(q.counts.overflow > 0 && q.counts.new === 0 && q.counts.paused, 'overflow shown honestly; new atoms paused');
  let run = 1;
  for (let i = 1; i < q.items.length; i++) { run = q.items[i].node === q.items[i - 1].node ? run + 1 : 1; assert(run <= 3, `run of ${run} at ${i}`); }
});

test('Queue', 'a new atom after every five reviews, never four in a row from one topic', () => {
  const reviews = Array.from({ length: 20 }, (_, i) => ({ atomId: `r${i}`, node: i < 10 ? 'A' : 'B' }));
  const news = Array.from({ length: 4 }, (_, i) => ({ atomId: `n${i}`, node: 'C' }));
  const out = interleave(reviews, news);
  eq(out.length, 24);
  eq(out.slice(0, 6).map((x) => x.atomId[0]).join(''), 'rrrrrn');
  let run = 1;
  for (let i = 1; i < out.length; i++) { run = out[i].node === out[i - 1].node ? run + 1 : 1; assert(run <= 3, 'run ≤ 3'); }
});

test('Queue', 'exam anchoring: one review in the 45-day window, Mains-only paused', () => {
  const cse = PROFILES.find((p) => p.id === 'cse-2028');
  const exam = new Date(2028, 4, 28).getTime();
  const inWindow = exam - 20 * DAYMS;
  const a = examAnchor(cse, inWindow);
  assert(a.inWindow && a.pauseMains, 'window is on');
  assert(!examAnchor(cse, exam - 60 * DAYMS).inWindow, 'not before the window');
  const card = { due: exam + 90 * DAYMS };
  const atom = { id: 'x.0001', stage: ['prelims'] };
  const d = anchoredDue(card, { lastTs: a.windowStart - 10 * DAYMS }, atom, a);
  assert(d >= a.windowStart && d < exam, 'pulled into the window');
  eq(anchoredDue(card, { lastTs: a.windowStart + DAYMS }, atom, a), card.due, 'already reviewed in the window');
  eq(anchoredDue(card, {}, { id: 'y', stage: ['mains'] }, a), card.due, 'Mains-only not anchored');
  const q = buildQueue({ atoms: [{ id: 'm.0001', nodes: ['n'], stage: ['mains'], origin: 'source', verify: false, text: 'x ___', answer: 'y' }], state: rebuild([]), now: inWindow, dayStart: inWindow, dayEnd: inWindow + DAYMS, profile: cse, limits: { newPerDay: 30, reviewCap: 200 }, nodeOrder: new Map() });
  eq([q.items.length, q.counts.mainsPaused], [0, 1]);
});

test('Queue', 'review cap follows the weekday budget', () => {
  eq([reviewCapFor(180), reviewCapFor(90), reviewCapFor(0), reviewCapFor(600), reviewCapFor(180, 120)], [200, 100, 50, 400, 120]);
  assert(isArchived({ eventDate: '2024-01-01', shelfLifeDays: 540 }, Date.UTC(2026, 0, 1)) && !isArchived({ eventDate: '2025-09-09', shelfLifeDays: 540 }, Date.UTC(2026, 9, 30)));
});

test('Queue', 'quarantined atoms stay out; self-made and missed-recall atoms come first', () => {
  const now = T1;
  const atoms = [
    { id: 'q.0001', nodes: ['n'], origin: 'model', verify: true, text: 'a ___', answer: 'b' },
    { id: 'p.0001', nodes: ['n'], origin: 'source', verify: false, text: 'c ___', answer: 'd' },
    { id: 'self.X', nodes: ['n'], origin: 'self', verify: false, text: 'e ___', answer: 'f' },
  ];
  const s = rebuild([ev('atom.created', { atom: atoms[2] }, now - 1000)]);
  const q = buildQueue({ atoms, state: s, now, dayStart: now - 3600e3, dayEnd: now + 20 * 3600e3, profile: null, limits: { newPerDay: 30, reviewCap: 200 }, nodeOrder: new Map() });
  eq(q.items.map((x) => x.atomId), ['self.X', 'p.0001']);
  eq(q.counts.quarantined, 1);
});

// ------------------------------------------------------------------ Phase 2: leeches, confusions, causes

test('Leech', 'six lapses suspend the atom; a rebuild brings it back', () => {
  const id = 'demo-polity.0005';
  const evs = [];
  let t = T1;
  let s = rebuild([]);
  const rate = (r) => { const e = ev('review.done', { atomId: id, mode: 'review', correct: r > 1, rating: r }, t); evs.push(e); s = applyEvent(s, e); t = s.atoms[id].card.due + 60e3; };
  rate(4);
  for (let i = 0; i < 6; i++) { rate(1); rate(3); rate(3); }
  const rec = s.atoms[id];
  assert(rec.card.lapses >= 6 && rec.suspended, `lapses ${rec.card.lapses}, suspended ${rec.suspended}`);
  const rebuiltEv = ev('atom.rebuilt', { atomId: id, kind: 'mnemonic', text: '17 = untouchability' }, t);
  s = applyEvent(s, rebuiltEv);
  assert(!s.atoms[id].suspended && s.atoms[id].mnemonic && s.atoms[id].forcedDue === t, 'rebuilt, back today');
  eq(stableStringify(rebuild(evs.concat(rebuiltEv))), stableStringify(s), 'rebuild matches incremental');
});

test('Leech', 'the threshold is a synced setting (for testing the flow)', () => {
  const id = 'x.0001';
  let s = rebuild([ev('settings.set', { key: 'leechThreshold', value: 2 }, T1)]);
  let t = T1 + 1000;
  const rate = (r) => { s = applyEvent(s, ev('review.done', { atomId: id, mode: 'review', correct: r > 1, rating: r }, t)); t = s.atoms[id].card.due + 60e3; };
  rate(4); rate(1); rate(3); rate(3); rate(1);
  assert(s.atoms[id].suspended, 'suspended after 2 lapses');
});

test('Confusion', 'two hits in 30 days open a contrast; a right answer resolves it', () => {
  const k = pairKey('a.0001', 'b.0001');
  let s = rebuild([ev('confusion.hit', { a: 'b.0001', b: 'a.0001', via: 'pair' }, T1)]);
  eq(s.confusions[k].contrast, null, 'one hit: no contrast yet');
  s = applyEvent(s, ev('confusion.hit', { a: 'a.0001', b: 'b.0001', via: 'pair' }, T1 + 3 * DAYMS));
  eq(s.confusions[k].contrast.status, 'open');
  const q = buildQueue({ atoms: [{ id: 'a.0001', nodes: ['n'], origin: 'source', verify: false, text: 'x ___', answer: 'y' }, { id: 'b.0001', nodes: ['n'], origin: 'source', verify: false, text: 'z ___', answer: 'w' }], state: s, now: T1 + 3 * DAYMS, dayStart: T1 + 3 * DAYMS - 3600e3, dayEnd: T1 + 4 * DAYMS, profile: null, limits: { newPerDay: 0, reviewCap: 200 }, nodeOrder: new Map() });
  eq(q.items[0].type, 'contrast', 'scheduled the same day, first');
  s = applyEvent(s, ev('contrast.done', { pair: k, correct: true }, T1 + 3 * DAYMS + 1000));
  eq(s.confusions[k].contrast.status, 'resolved');
  const far = rebuild([ev('confusion.hit', { a: 'a', b: 'b' }, T1), ev('confusion.hit', { a: 'a', b: 'b' }, T1 + 40 * DAYMS)]);
  eq(far.confusions[pairKey('a', 'b')].contrast, null, 'hits 40 days apart do not count');
});

test('Confusion', 'a wrong pairing or option is traced to the other atom', () => {
  const c = content();
  const byId = new Map(c.atoms.map((a) => [a.id, { ...a, _pack: 'demo-polity', _v: 1 }]));
  const match = c.probes.find((p) => p.id === 'demo-polity.p007');
  const hits = detectConfusions(match, { pairing: [1, 0, 2] }, byId.get(match.atoms[0]), byId);
  eq(hits.map((x) => pairKey(x.a, x.b)), [pairKey(match.atoms[0], match.atoms[1])], 'one swap, one pair');
  const contrast = contrastProbe(byId.get('demo-polity.0015'), byId.get('demo-polity.0016'));
  eq(detectConfusions(contrast, { pairing: [1, 0] }, byId.get('demo-polity.0015'), byId).length, 1);
  const identify = { format: 'identify', atoms: ['demo-polity.0026'], options: ['Finance Commission', 'Subordinate Legislation', 'x', 'y'], answer: 0 };
  const opt = detectConfusions(identify, { choice: 1 }, byId.get('demo-polity.0026'), byId);
  eq(opt.map((x) => x.b), ['demo-polity.0017'], 'the chosen option is another atom’s answer');
  eq(detectConfusions(match, { pairing: [0, 1, 2] }, byId.get(match.atoms[0]), byId), [], 'right answer: nothing');
});

test('Causes', "Didn't know resets to new; traps go to the Trap Log", () => {
  let t = T1;
  let s = rebuild([]);
  const r1 = ev('review.done', { atomId: 'x.0001', mode: 'review', correct: false, rating: 1 }, t);
  s = applyEvent(s, r1);
  eq(s.atoms['x.0001'].pendingCause, r1.id);
  s = applyEvent(s, ev('review.cause', { reviewId: r1.id, atomId: 'x.0001', cause: 'didnt-know' }, t + 1000));
  eq([s.atoms['x.0001'].card.state, s.atoms['x.0001'].pendingCause, s.causes['didnt-know']], [State.New, undefined, 1]);
  s = applyEvent(s, ev('review.cause', { atomId: 'y', cause: 'trap', trap: 'scope-creep' }, t + 2000));
  eq([s.traps['scope-creep'], s.trapLog.length], [1, 1]);
  const pre = applyEvent(rebuild([]), ev('review.done', { atomId: 'z', mode: 'pretest', correct: false, confidence: 'guess' }, t));
  eq([pre.atoms.z.card, pre.atoms.z.pendingCause, pre.calib.guess.n], [undefined, undefined, 1], 'pre-test: no FSRS, no cause, counted for calibration');
});

test('Self atoms', 'quick add creates a self atom that is due at once; edits apply', () => {
  const atom = { id: 'self.01TEST', type: 'fact', text: 'Capital ___', answer: 'Delhi', nodes: ['n'], source: { title: 'Me' } };
  let s = rebuild([ev('atom.created', { atom }, T1)]);
  eq([s.self['self.01TEST'].origin, s.atoms['self.01TEST'].forcedDue], ['self', T1]);
  s = applyEvent(s, ev('atom.edited', { atomId: 'self.01TEST', fields: { answer: 'New Delhi', origin: 'model' } }, T1 + 1));
  eq([s.self['self.01TEST'].answer, s.self['self.01TEST'].origin], ['New Delhi', 'self'], 'origin cannot be edited');
  eq(rebuild([ev('atom.created', { atom: { ...atom, id: 'bad.0001' } }, T1)]).self, {}, 'only self.* ids');
});

test('Anki', 'tab-separated export with headers, four columns and syllabus tags', () => {
  const c = content();
  const tsv = ankiTsv([{ ...c.atoms[0], _pack: 'demo-polity' }, { ...c.atoms[1], _pack: '@self', text: 'Tab\there <b>', answer: 'x' }], { sourceLabel: () => 'Demo Source, p. 3' });
  const lines = tsv.trim().split('\n');
  eq(lines.slice(0, 3), ['#separator:tab', '#html:true', '#tags column:3']);
  const row = lines[5].split('\t');
  eq(row.length, 4);
  assert(row[0].includes('[…]') && row[1].includes('<b>42nd</b>') && row[2].includes('smriti::cse::gs2::polity::preamble') && row[3] === 'Demo Source, p. 3', row.join(' | '));
  const row2 = lines[6].split('\t');
  eq(row2.length, 4, 'tabs inside text are escaped');
  assert(row2[0].includes('&lt;b&gt;'), 'HTML escaped');
});

// ------------------------------------------------------------------ Phase 3: learn loop, notes, sources

test('Learn Loop', 'recall below 70% keeps the topic Learning and schedules the misses', () => {
  const node = 'cse.gs2.polity.fr';
  let s = rebuild([ev('learn.started', { loopId: 'L1', nodeId: node }, T1)]);
  eq([s.nodes[node].status, s.loops.L1.step, s.activeLoop[node]], ['learning', 'pretest', 'L1']);
  s = applyEvent(s, ev('learn.step', { loopId: 'L1', step: 'read', pretest: { n: 3, correct: 1 } }, T1 + 1000));
  s = applyEvent(s, ev('learn.recall', { loopId: 'L1', nodeId: node, ticked: ['a'], missed: ['b', 'c'], total: 3, pct: 33 }, T1 + 2000));
  eq([s.loops.L1.step, s.atoms.b.forcedDue, s.nodes[node].recallPct], ['probes', T1 + 2000, 33]);
  s = applyEvent(s, ev('learn.completed', { loopId: 'L1', nodeId: node }, T1 + 3000));
  eq([s.nodes[node].status, s.activeLoop[node], s.loops.L1.done], ['learning', undefined, true]);
  let s2 = rebuild([ev('learn.started', { loopId: 'L2', nodeId: node }, T1), ev('learn.recall', { loopId: 'L2', nodeId: node, pct: 80, missed: [] }, T1 + 1), ev('learn.completed', { loopId: 'L2', nodeId: node }, T1 + 2)]);
  eq(s2.nodes[node].status, 'learned');
});

test('Notes', 'revisions, levels and per-source counts', () => {
  const s = rebuild([
    ev('source.added', { sourceId: 'src-1', title: 'Book', pages: 40 }, T1),
    ev('note.saved', { nodeId: 'n', level: 1, text: 'a b c', words: 3, sourceIds: ['src-1'] }, T1 + 1),
    ev('note.saved', { nodeId: 'n', level: 2, text: 'a b', words: 2, sourceIds: ['src-1'] }, T1 + 2),
    ev('note.dropped', { nodeId: 'n', level: 2, dropped: ['x'] }, T1 + 3),
  ]);
  eq([s.notes.n.revisions, s.notes.n.latest.level, s.notes.n.levels[2].dropped, s.sourceRevisions['src-1']], [2, 2, 1, 2]);
});

test('Sources', 'page text reflows into paragraphs', () => {
  eq(reflow('Chapter 5: Parliamentary\ndevices\nA starred question in Parliament is answered orally, and\nsupplementary questions may follow.\n\nThe consti-\ntution is supreme.\n• bullet one\n• bullet two'),
    ['Chapter 5: Parliamentary devices', 'A starred question in Parliament is answered orally, and supplementary questions may follow.', 'The constitution is supreme.', '• bullet one', '• bullet two']);
});

test('Sources', 'topic suggestions from pack pages and from keywords', () => {
  const c = content();
  const r = suggestFromPack(c.atoms.map((a) => ({ ...a })), 0);
  const devices = r.find((x) => x.nodeId === 'cse.gs2.polity.parliament.devices');
  eq([devices.from, devices.to], [21, 21]);
  const texts = ['Nothing here.', 'The Speaker presides over a joint sitting. Money Bill rules: a Money Bill starts in the Lok Sabha.', 'Joint sitting under Article 108 again: joint sitting, money bill.'];
  const nodes = [{ id: 'leg', title: 'Law-making', keywords: ['money bill', 'joint sitting', 'article 108'] }, { id: 'other', title: 'Rivers', keywords: ['ganga', 'yamuna'] }];
  const sg = suggestByKeywords(texts, nodes, 5);
  eq(sg.map((x) => [x.nodeId, x.from, x.to]), [['leg', 2, 3]]);
  const st = rebuild([ev('source.added', { sourceId: 'S', title: 'B', pages: 3 }, T1), ev('source.mapped', { sourceId: 'S', nodeId: 'leg', from: 2, to: 3 }, T1 + 1), ev('source.linked', { sourceId: 'S', packId: 'p', offset: 4 }, T1 + 2)]);
  eq([st.sources.S.maps.leg, st.packSources.p], [{ from: 2, to: 3 }, { sourceId: 'S', offset: 4 }]);
});

test('Determinism', 'review-heavy logs rebuild identically in any order', () => {
  const evs = [];
  let t = T1;
  for (let i = 0; i < 60; i++) {
    evs.push(ev('review.done', { atomId: `a.${i % 7}`, mode: i % 5 ? 'review' : 'learn', correct: i % 3 !== 0, rating: (i % 4) + 1, confidence: ['sure', '5050', 'guess'][i % 3], ms: 4000 + i * 10, format: 'cloze' }, t, i % 2 ? DEV_A : DEV_B));
    if (i % 9 === 0) evs.push(ev('confusion.hit', { a: `a.${i % 7}`, b: `a.${(i + 1) % 7}` }, t + 5));
    t += 3600e3 * (1 + (i % 5));
  }
  const a = rebuild(evs);
  for (let k = 0; k < 5; k++) eq(stableStringify(rebuild(evs.slice().sort(() => Math.random() - 0.5))), stableStringify(a));
  let inc = rebuild([]);
  for (const e of evs.slice().sort((x, y) => x.ts - y.ts || (x.id < y.id ? -1 : 1))) inc = applyEvent(inc, e);
  eq(stableStringify(inc), stableStringify(a), 'incremental = full');
});

test('End to end', 'self-made atoms are rebuilt from events on another device', async () => {
  const dbX = await freshDB('smriti-selftest-x');
  const dbY = await freshDB('smriti-selftest-y');
  await commitPackPlans(dbX, await planPackImport(dbX, await demoFiles()), { deviceId: DEV_A, now: T1 });
  const atom = { id: 'self.01SELFTEST', type: 'fact', text: 'My ___', answer: 'fact', nodes: ['cse.gs2.polity.fr'], source: { title: 'Me' }, origin: 'self', verify: false };
  await dbX.put('events', makeEvent('atom.created', { atom }, DEV_A, T1 + 1000));
  const dx = await refreshDerived(dbX);
  eq([dx.summary.counts.self, (await dbX.get('atoms', atom.id))._pack], [1, '@self']);
  const b = await exportBackup(dbX, { deviceId: DEV_A, deviceName: 'laptop', now: T1 + 2000 });
  const plan = await planBackupImport(dbY, b.text);
  assert(plan.writes.atoms.every((a) => a._pack !== '@self'), 'self atoms travel as events, not items');
  await commitBackupImport(dbY, plan);
  await refreshDerived(dbY);
  eq((await dbY.get('atoms', atom.id)).answer, 'fact');
  dbX.close(); dbY.close();
  await deleteDB('smriti-selftest-x');
  await deleteDB('smriti-selftest-y');
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
