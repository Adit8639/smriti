// Exam profiles are data (see /profiles). This module validates them, applies the user's
// synced overrides (profile.set events) and answers date questions.

import { isIsoDate, isObj, addDays, daysBetween } from './util.js';
import { validateNodeList } from './schema.js';

export const DEFAULT_PROFILE_ID = 'cse-2028';

export function validateProfile(p) {
  const errs = [];
  const e = (path, msg) => errs.push({ path, msg });
  if (!isObj(p)) return [{ path: '(root)', msg: 'a profile must be a JSON object' }];
  for (const k of ['id', 'exam', 'name', 'nodePrefix']) if (typeof p[k] !== 'string' || !p[k]) e(k, 'required text');
  if (!Number.isInteger(p.version) || p.version < 1) e('version', 'must be a whole number ≥ 1');
  if (!isObj(p.dates) || !Object.keys(p.dates).length) e('dates', 'needs at least one exam date');
  else {
    for (const [k, d] of Object.entries(p.dates)) {
      if (!isObj(d)) { e(`dates.${k}`, 'must be an object'); continue; }
      if (!isIsoDate(d.date)) e(`dates.${k}.date`, 'must be YYYY-MM-DD');
      if (typeof d.tentative !== 'boolean') e(`dates.${k}.tentative`, 'must be true or false');
      if (typeof d.label !== 'string') e(`dates.${k}.label`, 'required text');
    }
  }
  if (!Array.isArray(p.phases) || !p.phases.length) e('phases', 'needs at least one phase');
  else p.phases.forEach((ph, i) => {
    if (!isObj(ph) || typeof ph.id !== 'string' || typeof ph.name !== 'string') e(`phases[${i}]`, 'needs id and name');
    else if (!isIsoDate(ph.until) && !(typeof ph.until === 'string' && ph.until[0] === '@' && p.dates && p.dates[ph.until.slice(1)])) {
      e(`phases[${i}].until`, 'must be YYYY-MM-DD or @<date key>');
    }
  });
  if (!Array.isArray(p.papers) || !p.papers.length) e('papers', 'needs at least one paper');
  else p.papers.forEach((pp, i) => {
    if (!isObj(pp) || typeof pp.id !== 'string' || typeof pp.name !== 'string') e(`papers[${i}]`, 'needs id and name');
    else if (pp.type !== 'mcq' && pp.type !== 'descriptive') e(`papers[${i}].type`, 'must be mcq or descriptive');
  });
  if (!Array.isArray(p.syllabus)) e('syllabus', 'must be an array of nodes');
  else {
    const papers = new Set((p.papers || []).map((x) => x && x.id));
    for (const x of validateNodeList(p.syllabus, 'syllabus', papers)) errs.push(x);
  }
  return errs;
}

// Paths look like "dates.prelims.date" or "phases.foundation.until"; inside arrays the
// segment matches an element's id.
function setPath(obj, path, value) {
  const parts = path.split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const k = parts[i];
    const next = Array.isArray(cur) ? cur.find((x) => x && x.id === k) : cur[k];
    if (next === undefined || next === null || typeof next !== 'object') return false;
    cur = next;
  }
  const last = parts[parts.length - 1];
  if (Array.isArray(cur)) return false;
  cur[last] = value;
  return true;
}

// Which override paths the Settings screen may write, and what values they accept.
export function checkEdit(profile, path, value) {
  let m = /^dates\.([a-zA-Z0-9_-]+)\.(date|tentative)$/.exec(path);
  if (m) {
    if (!profile.dates[m[1]]) return 'unknown date';
    if (m[2] === 'date') return isIsoDate(value) ? null : 'must be a valid date';
    return typeof value === 'boolean' ? null : 'must be true or false';
  }
  m = /^phases\.([a-zA-Z0-9_-]+)\.until$/.exec(path);
  if (m) {
    if (!profile.phases.some((p) => p.id === m[1])) return 'unknown phase';
    return isIsoDate(value) || (typeof value === 'string' && value[0] === '@' && profile.dates[value.slice(1)]) ? null : 'must be a valid date';
  }
  return 'this field cannot be edited';
}

export function effectiveProfile(base, edits) {
  const p = structuredClone(base);
  p._edited = [];
  for (const [path, value] of Object.entries(edits || {})) {
    if (checkEdit(base, path, value) === null && setPath(p, path, value)) p._edited.push(path);
  }
  return p;
}

export const resolveDate = (profile, ref) => (typeof ref === 'string' && ref[0] === '@' ? profile.dates[ref.slice(1)]?.date : ref);

// [{id, name, start, end}]; the first phase starts open-ended ("now").
export function resolvePhases(profile) {
  const out = [];
  let start = null;
  for (const ph of profile.phases) {
    const end = resolveDate(profile, ph.until);
    out.push({ id: ph.id, name: ph.name, start, end });
    start = end ? addDays(end, 1) : null;
  }
  return out;
}

export function phaseOn(profile, isoDay) {
  for (const ph of resolvePhases(profile)) {
    if ((!ph.start || isoDay >= ph.start) && ph.end && isoDay <= ph.end) return ph;
  }
  return null;
}

// Exam dates sorted by date, with days remaining from isoDay.
export function examCountdown(profile, isoDay) {
  return Object.entries(profile.dates)
    .map(([key, d]) => ({ key, ...d, days: daysBetween(isoDay, d.date) }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));
}

// Seconds per question for an MCQ paper (e.g. 120 min / 100 Q = 72 s).
export const secondsPerQuestion = (paper) =>
  paper.type === 'mcq' && paper.questions ? Math.round((paper.durationMin * 60) / paper.questions) : null;

// Context shared by validation and the library: every paper id, exam id and starter node.
export function profileContext(profiles) {
  const papers = new Map();
  const exams = new Set();
  const starter = new Map();
  for (const p of profiles) {
    exams.add(p.exam);
    for (const pp of p.papers || []) if (!papers.has(pp.id)) papers.set(pp.id, { ...pp, exam: p.exam });
    for (const n of p.syllabus || []) if (!starter.has(n.id)) starter.set(n.id, { ...n, _profile: p.id, _exam: p.exam });
  }
  return { papers, exams, starter };
}

// Loads /profiles/*.json into the profiles store, keeping whichever copy has the higher version.
export async function seedProfiles(db, baseUrl) {
  const res = await fetch(new URL('profiles/index.json', baseUrl));
  if (!res.ok) throw new Error(`profiles/index.json: HTTP ${res.status}`);
  const files = await res.json();
  const problems = [];
  for (const f of files) {
    const r = await fetch(new URL(`profiles/${f}`, baseUrl));
    if (!r.ok) { problems.push(`${f}: HTTP ${r.status}`); continue; }
    const p = await r.json();
    const errs = validateProfile(p);
    if (errs.length) { problems.push(`${f}: ${errs.slice(0, 3).map((x) => `${x.path} ${x.msg}`).join('; ')}`); continue; }
    const cur = await db.get('profiles', p.id);
    if (!cur || cur.version < p.version) await db.put('profiles', p);
  }
  return problems;
}
