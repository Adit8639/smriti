// Pure rebuild: state = fold(sorted events). No clock, no randomness, no storage, and the
// input is never mutated, so the same events always give the same state on every device.
// The page and the data worker also apply new events in place with applyInPlace().

import { compareEvents, EVENT_TYPES } from './events.js';
import { STATE_VERSION } from './version.js';
import { contentHash, isObj } from './util.js';
import { review as fsrsReview, forget as fsrsForget } from './fsrs.js';

const KNOWN = new Set(EVENT_TYPES);
const DAY = 86400000;
export const DEFAULT_LEECH = 6;
export const CONFIDENCES = ['sure', '5050', 'guess'];
export const CAUSES = ['didnt-know', 'forgot', 'confused', 'misread', 'overthought', 'silly', 'trap'];
const TRAPS = ['number-swap', 'year-swap', 'institution-swap', 'scope-creep', 'cause-effect', 'chronology', 'near-name', 'location-swap', 'partial-truth'];

export function initialState() {
  return {
    v: STATE_VERSION,
    count: 0,
    last: null,          // {id, ts} of the last event applied
    byType: {},          // type -> count
    unknown: 0,          // events of types this version does not understand
    devices: {},         // deviceId -> {events, firstTs, lastTs, lastExportTs, name}
    packs: {},           // packId -> {installed, version, ts, deviceId}
    atoms: {},           // atomId -> learning record (quarantine, FSRS card, usage, leech…)
    settings: {},        // synced settings, last writer wins
    profileEdits: {},    // profileId -> {path: value}
    self: {},            // atomId -> atom created on a device (quick add, reader, splits)
    probeUse: {},        // probeId -> last time shown
    recent: [],          // timestamps of FSRS reviews in the last 48 h (daily cap)
    calib: {},           // confidence -> {n, correct}
    slips: {},           // silly / overthought counts (calibration)
    causes: {},          // error cause -> count
    traps: {},           // trap tag -> count
    trapLog: [],         // last 50 trap misses {atomId, tag, cause, ts}
    confusions: {},      // "a|b" -> {a, b, n, hits[], contrast}
    nodes: {},           // nodeId -> {status, loops, completed, recallPct, lastRecallTs, lastLoopTs}
    loops: {},           // loopId -> learn loop progress
    activeLoop: {},      // nodeId -> loopId in progress
    notes: {},           // nodeId -> {revisions, levels {1..4}, latest}
    sources: {},         // sourceId -> {title, pages, bytes, maps {nodeId: {from, to}}, pack}
    packSources: {},     // packId -> {sourceId, offset}
    sourceRevisions: {}, // sourceId -> note revisions written while it was mapped
    sessions: {},        // sessionId -> {kind, start, end, active, reviews, correct}
    objective: [],       // last 1000 objective answers {t, c, ok, src, f, a?, q?, s?, m?} (calibration)
    pyqStats: {},        // pyqId -> {n, right, lastTs, lastOk, pendingCause?}
    mocks: {},           // mockId -> {title, source, paper, n, key[], fmt[], subj[], status, result…}
    csat: { byType: {}, recent: [] }, // CSAT Gym answers
  };
}

export const OBJECTIVE_KEEP = 1000;
const MOCK_NEEDS = (key, answers) => key.map((k, i) => {
  const a = answers[i];
  if (!a || !Number.isInteger(a.choice)) return null;
  return a.choice !== k || a.confidence === 'guess' ? i : null;
}).filter((x) => x !== null);

function pushObjective(s, entry) {
  s.objective.push(entry);
  if (s.objective.length > OBJECTIVE_KEEP) s.objective.splice(0, s.objective.length - OBJECTIVE_KEEP);
}

const str = (v) => typeof v === 'string' && v.length > 0;
const clampMs = (ms) => (Number.isFinite(ms) && ms > 0 ? Math.min(ms, 15 * 60e3) : 0);
export const pairKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);

function atomRec(s, id) {
  return s.atoms[id] || (s.atoms[id] = {});
}

function nodeRec(s, id) {
  return s.nodes[id] || (s.nodes[id] = { status: 'new', loops: 0, completed: 0, recallPct: null, lastRecallTs: null, lastLoopTs: null });
}

function openContrast(s, a, b, ts, via) {
  if (!str(a) || !str(b) || a === b) return;
  const key = pairKey(a, b);
  const c = s.confusions[key] || (s.confusions[key] = { a: key.split('|')[0], b: key.split('|')[1], n: 0, hits: [], contrast: null });
  if (!c.contrast || c.contrast.status === 'resolved') c.contrast = { status: 'open', createdTs: ts, attempts: 0, lastTs: null, via };
}

function sessionTouch(s, p, ts, ms, counted, correct) {
  if (!str(p.sessionId)) return;
  const ss = s.sessions[p.sessionId];
  if (!ss) return;
  ss.active += clampMs(ms);
  if (ts > ss.end) ss.end = ts;
  if (counted) { ss.reviews++; if (correct) ss.correct++; }
}

function onReview(s, e, p) {
  const pyqId = str(p.probeId) && p.probeId.startsWith('pyq:') ? p.probeId.slice(4) : null;
  if (pyqId) {
    const q = s.pyqStats[pyqId] || (s.pyqStats[pyqId] = { n: 0, right: 0, lastTs: null, lastOk: null });
    q.n++;
    if (p.correct) q.right++;
    q.lastTs = e.ts;
    q.lastOk = !!p.correct;
    if (!p.correct && !str(p.atomId) && p.mode !== 'pretest') q.pendingCause = e.id;
    else delete q.pendingCause;
  }
  if (CONFIDENCES.includes(p.confidence) && p.mode !== 'pretest') {
    pushObjective(s, { t: e.ts, c: p.confidence, ok: !!p.correct, src: pyqId ? 'pyq' : p.mode || 'review', f: p.format || null, a: str(p.atomId) ? p.atomId : null, q: pyqId });
  }
  if (!str(p.atomId)) {
    // A PYQ with no linked atom (pre-test): counts for calibration and the session only.
    if (CONFIDENCES.includes(p.confidence)) {
      const c = s.calib[p.confidence] || (s.calib[p.confidence] = { n: 0, correct: 0 });
      c.n++;
      if (p.correct) c.correct++;
    }
    sessionTouch(s, p, e.ts, p.ms, true, p.correct);
    return;
  }
  const a = atomRec(s, p.atomId);
  const t = e.ts;
  const mode = p.mode || 'review';
  if (str(p.format)) (a.formats || (a.formats = {}))[p.format] = t;
  if (str(p.probeId)) s.probeUse[p.probeId] = t;
  if (CONFIDENCES.includes(p.confidence)) {
    const c = s.calib[p.confidence] || (s.calib[p.confidence] = { n: 0, correct: 0 });
    c.n++;
    if (p.correct) c.correct++;
  }
  sessionTouch(s, p, t, p.ms, true, p.correct);
  if (mode === 'pretest') { a.pretests = (a.pretests || 0) + 1; return; }
  if (mode === 'practice') {
    a.practice = (a.practice || 0) + 1;
    if (!p.correct) a.pendingCause = e.id;
    return;
  }
  const rating = [1, 2, 3, 4].includes(p.rating) ? p.rating : (p.correct ? 3 : 1);
  a.card = fsrsReview(a.card, t, rating, s.settings.retention);
  a.reviews = (a.reviews || 0) + 1;
  if (!a.firstTs) {
    a.firstTs = t;
    // Introduced on purpose (quick add, missed recall) rather than from today's new quota.
    a.introForced = !!(a.forcedDue && a.forcedDue <= t);
  }
  a.lastTs = t;
  a.lastRating = rating;
  if (!p.correct) { a.misses = (a.misses || 0) + 1; a.pendingCause = e.id; }
  if (a.forcedDue && a.forcedDue <= t) delete a.forcedDue;
  s.recent.push(t);
  while (s.recent.length && s.recent[0] < t - 2 * DAY) s.recent.shift();
  const th = Number.isInteger(s.settings.leechThreshold) && s.settings.leechThreshold > 0 ? s.settings.leechThreshold : DEFAULT_LEECH;
  if (!a.retired && !a.suspended && a.card.lapses - (a.lapseBase || 0) >= th) {
    a.suspended = true;
    a.suspendedTs = t;
  }
}

function countCause(s, e, p, ref) {
  s.causes[p.cause] = (s.causes[p.cause] || 0) + 1;
  if (p.cause === 'misread' || p.cause === 'trap') {
    const tag = TRAPS.includes(p.trap) ? p.trap : 'untagged';
    s.traps[tag] = (s.traps[tag] || 0) + 1;
    s.trapLog.push({ ...ref, tag, cause: p.cause, ts: e.ts });
    if (s.trapLog.length > 50) s.trapLog.shift();
  } else if (p.cause === 'silly' || p.cause === 'overthought') {
    s.slips[p.cause] = (s.slips[p.cause] || 0) + 1;
  }
}

function onCause(s, e, p) {
  if (!CAUSES.includes(p.cause)) return;
  if (!str(p.atomId)) {
    // A PYQ with no linked atom: the cause still counts towards the error mix and traps.
    if (!str(p.pyqId)) return;
    const q = s.pyqStats[p.pyqId];
    if (q && (!p.reviewId || q.pendingCause === p.reviewId)) delete q.pendingCause;
    countCause(s, e, p, { atomId: null, pyqId: p.pyqId });
    return;
  }
  const a = atomRec(s, p.atomId);
  if (!p.reviewId || a.pendingCause === p.reviewId) delete a.pendingCause;
  if (str(p.pyqId) && s.pyqStats[p.pyqId] && (!p.reviewId || s.pyqStats[p.pyqId].pendingCause === p.reviewId)) delete s.pyqStats[p.pyqId].pendingCause;
  (a.causes || (a.causes = {}))[p.cause] = (a.causes[p.cause] || 0) + 1;
  if (p.cause === 'didnt-know') {
    if (a.card) a.card = fsrsForget(a.card, e.ts, s.settings.retention);
    a.forcedDue = e.ts;
  }
  countCause(s, e, p, { atomId: p.atomId });
}

function onMockStarted(s, e, p) {
  if (!str(p.mockId) || !Array.isArray(p.questions) || s.mocks[p.mockId]) return;
  const qs = p.questions;
  s.mocks[p.mockId] = {
    title: p.title || 'Mock', source: p.source || 'generated', paper: p.paper || null, n: qs.length,
    startedTs: e.ts, durationMs: Number(p.durationMs) || 0, marks: isObj(p.marks) ? p.marks : { right: 2, wrong: 2 / 3 },
    key: qs.map((q) => (isObj(q) && Number.isInteger(q.answer) ? q.answer : -1)),
    fmt: qs.map((q) => (isObj(q) && str(q.format) ? q.format : null)),
    subj: qs.map((q) => (isObj(q) && str(q.subject) ? q.subject : null)),
    status: 'started', deviceId: e.deviceId, eventId: e.id,
  };
}

function onMockSubmitted(s, e, p) {
  const m = str(p.mockId) && s.mocks[p.mockId];
  if (!m || m.status !== 'started' || !Array.isArray(p.answers)) return;
  const answers = m.key.map((_, i) => {
    const a = isObj(p.answers[i]) ? p.answers[i] : {};
    return { choice: Number.isInteger(a.choice) ? a.choice : null, confidence: CONFIDENCES.includes(a.confidence) ? a.confidence : null, ms: clampMs(a.ms), marked: !!a.marked };
  });
  let right = 0;
  let wrong = 0;
  answers.forEach((a, i) => {
    if (a.choice === null) return;
    const ok = a.choice === m.key[i];
    if (ok) right++; else wrong++;
    if (a.confidence) pushObjective(s, { t: e.ts, c: a.confidence, ok, src: 'mock', f: m.fmt[i], s: m.subj[i], m: p.mockId });
  });
  m.status = 'submitted';
  m.submittedTs = e.ts;
  m.elapsedMs = clampMs(p.elapsedMs) || Math.max(0, e.ts - m.startedTs);
  m.choice = answers.map((a) => a.choice);
  m.conf = answers.map((a) => a.confidence);
  m.ms = answers.map((a) => a.ms);
  m.right = right;
  m.wrong = wrong;
  m.skipped = m.n - right - wrong;
  m.score = Math.round((right * m.marks.right - wrong * m.marks.wrong) * 100) / 100;
  m.max = Math.round(m.n * m.marks.right * 100) / 100;
  m.needs = MOCK_NEEDS(m.key, answers);
  m.tags = {};
  m.unlocked = m.needs.length === 0;
  if (m.unlocked) m.unlockedTs = e.ts;
}

function onMockCause(s, e, p) {
  const m = str(p.mockId) && s.mocks[p.mockId];
  if (!m || m.status !== 'submitted' || !Number.isInteger(p.i) || !m.needs.includes(p.i) || !CAUSES.includes(p.cause)) return;
  const first = !m.tags[p.i];
  m.tags[p.i] = p.cause;
  if (first) countCause(s, e, p, { atomId: Array.isArray(p.atomIds) && str(p.atomIds[0]) ? p.atomIds[0] : null, mockId: p.mockId, i: p.i });
  // Gaps found in a mock go straight into today's reviews.
  if ((p.cause === 'didnt-know' || p.cause === 'forgot' || p.cause === 'confused') && Array.isArray(p.atomIds)) {
    for (const id of p.atomIds) if (str(id)) atomRec(s, id).forcedDue = e.ts;
  }
  if (p.cause === 'confused' && Array.isArray(p.atomIds) && str(p.atomIds[0]) && str(p.other)) onConfusion(s, e, { a: p.atomIds[0], b: p.other });
  if (!m.unlocked && m.needs.every((i) => m.tags[i])) { m.unlocked = true; m.unlockedTs = e.ts; }
}

function onCsat(s, e, p) {
  if (!str(p.type)) return;
  const t = s.csat.byType[p.type] || (s.csat.byType[p.type] = { n: 0, right: 0, ms: 0 });
  t.n++;
  if (p.correct) t.right++;
  t.ms += clampMs(p.ms);
  s.csat.recent.push({ t: e.ts, type: p.type, level: Number(p.level) || 1, ok: !!p.correct, ms: clampMs(p.ms), c: CONFIDENCES.includes(p.confidence) ? p.confidence : null, skip: p.choice === null || p.choice === undefined, q: str(p.qid) ? p.qid.slice(0, 160) : null });
  if (s.csat.recent.length > 500) s.csat.recent.shift();
  sessionTouch(s, p, e.ts, p.ms, true, p.correct);
}

function onConfusion(s, e, p) {
  if (!str(p.a) || !str(p.b) || p.a === p.b) return;
  const key = pairKey(p.a, p.b);
  const c = s.confusions[key] || (s.confusions[key] = { a: key.split('|')[0], b: key.split('|')[1], n: 0, hits: [], contrast: null });
  c.n++;
  c.hits.push(e.ts);
  if (c.hits.length > 10) c.hits.shift();
  // Two hits within 30 days open a contrast card, scheduled the same day.
  const since = c.contrast && c.contrast.status === 'resolved' ? c.contrast.resolvedTs : -Infinity;
  const recent = c.hits.filter((t) => t > since && t > e.ts - 30 * DAY).length;
  if ((!c.contrast || c.contrast.status === 'resolved') && recent >= 2) {
    c.contrast = { status: 'open', createdTs: e.ts, attempts: 0, lastTs: null, via: 'hits' };
  } else if (c.contrast && c.contrast.status === 'open' && !(typeof p.probeId === 'string' && p.probeId.startsWith('contrast:'))) {
    // A fresh mix-up outside the contrast drill puts the open contrast back on today's list.
    c.contrast.lastTs = null;
  }
}

// Applies one event to a state object in place.
export function applyInPlace(s, e) {
  s.count++;
  s.last = { id: e.id, ts: e.ts };
  s.byType[e.type] = (s.byType[e.type] || 0) + 1;
  let d = s.devices[e.deviceId];
  if (!d) d = s.devices[e.deviceId] = { events: 0, firstTs: e.ts, lastTs: e.ts, lastExportTs: null, name: null };
  d.events++;
  if (e.ts < d.firstTs) d.firstTs = e.ts;
  if (e.ts > d.lastTs) d.lastTs = e.ts;
  if (!KNOWN.has(e.type)) { s.unknown++; return s; }

  const p = isObj(e.payload) ? e.payload : {};
  const ts = e.ts;
  switch (e.type) {
    case 'pack.installed':
      if (str(p.packId)) s.packs[p.packId] = { installed: true, version: p.version, ts, deviceId: e.deviceId };
      break;
    case 'pack.uninstalled':
      if (str(p.packId)) s.packs[p.packId] = { installed: false, version: p.version, ts, deviceId: e.deviceId };
      break;
    case 'atom.approved':
    case 'atom.discarded':
      if (str(p.atomId)) {
        const a = atomRec(s, p.atomId);
        a.status = e.type === 'atom.approved' ? 'approved' : 'discarded';
        a.hash = p.hash ?? null;
        a.statusTs = ts;
      }
      break;
    case 'atom.restored':
      if (str(p.atomId) && s.atoms[p.atomId]) {
        const a = s.atoms[p.atomId];
        delete a.status;
        delete a.hash;
        delete a.statusTs;
      }
      break;
    case 'atom.created':
      if (isObj(p.atom) && str(p.atom.id) && p.atom.id.startsWith('self.') && str(p.atom.text) && Array.isArray(p.atom.nodes)) {
        s.self[p.atom.id] = { ...p.atom, origin: 'self', verify: false, createdTs: ts };
        atomRec(s, p.atom.id).forcedDue = ts;
      }
      break;
    case 'atom.edited':
      if (str(p.atomId) && s.self[p.atomId] && isObj(p.fields)) {
        const allowed = ['text', 'answer', 'nodes', 'source', 'type', 'note', 'mnemonic'];
        for (const k of allowed) if (p.fields[k] !== undefined) s.self[p.atomId][k] = p.fields[k];
        s.self[p.atomId].editedTs = ts;
      }
      break;
    case 'atoms.scheduled':
      if (Array.isArray(p.atomIds)) for (const id of p.atomIds) if (str(id)) atomRec(s, id).forcedDue = ts;
      break;
    case 'atom.rebuilt':
      if (str(p.atomId)) {
        const a = atomRec(s, p.atomId);
        a.rebuilds = (a.rebuilds || 0) + 1;
        a.lapseBase = a.card ? a.card.lapses : 0;
        delete a.suspended;
        delete a.suspendedTs;
        if (p.kind === 'mnemonic' && str(p.text)) a.mnemonic = p.text;
        if (p.kind === 'split') { a.retired = 'split'; a.splitInto = Array.isArray(p.into) ? p.into : []; }
        else a.forcedDue = ts;
        if (p.kind === 'contrast' && str(p.with)) openContrast(s, p.atomId, p.with, ts, 'rebuild');
      }
      break;
    case 'review.done':
      onReview(s, e, p);
      break;
    case 'review.cause':
      onCause(s, e, p);
      break;
    case 'confusion.hit':
      onConfusion(s, e, p);
      break;
    case 'mock.started':
      onMockStarted(s, e, p);
      break;
    case 'mock.submitted':
      onMockSubmitted(s, e, p);
      break;
    case 'mock.cause':
      onMockCause(s, e, p);
      break;
    case 'mock.discarded':
      if (str(p.mockId) && s.mocks[p.mockId] && s.mocks[p.mockId].status === 'started') s.mocks[p.mockId].status = 'discarded';
      break;
    case 'csat.answered':
      onCsat(s, e, p);
      break;
    case 'contrast.done': {
      const c = str(p.pair) ? s.confusions[p.pair] : null;
      if (c && c.contrast) {
        c.contrast.attempts++;
        c.contrast.lastTs = ts;
        if (p.correct) { c.contrast.status = 'resolved'; c.contrast.resolvedTs = ts; }
      }
      if (CONFIDENCES.includes(p.confidence)) {
        const k = s.calib[p.confidence] || (s.calib[p.confidence] = { n: 0, correct: 0 });
        k.n++;
        if (p.correct) k.correct++;
        pushObjective(s, { t: ts, c: p.confidence, ok: !!p.correct, src: 'contrast', f: 'contrast', a: null });
      }
      sessionTouch(s, p, ts, p.ms, true, p.correct);
      break;
    }
    case 'session.started':
      if (str(p.sessionId) && !s.sessions[p.sessionId]) s.sessions[p.sessionId] = { kind: p.kind || 'review', nodeId: p.nodeId || null, start: ts, end: ts, active: 0, reviews: 0, correct: 0 };
      break;
    case 'session.active':
      sessionTouch(s, p, ts, p.ms, false, false);
      break;
    case 'session.ended':
      if (str(p.sessionId) && s.sessions[p.sessionId]) { const ss = s.sessions[p.sessionId]; if (ts > ss.end) ss.end = ts; ss.ended = true; }
      break;
    case 'learn.started':
      if (str(p.loopId) && str(p.nodeId)) {
        s.loops[p.loopId] = { nodeId: p.nodeId, step: 'pretest', startedTs: ts, updatedTs: ts, sessionId: p.sessionId || null };
        const n = nodeRec(s, p.nodeId);
        n.loops++;
        if (n.status !== 'learned') n.status = 'learning';
        s.activeLoop[p.nodeId] = p.loopId;
      }
      break;
    case 'learn.step':
      if (str(p.loopId) && s.loops[p.loopId] && str(p.step)) {
        const l = s.loops[p.loopId];
        l.step = p.step;
        l.updatedTs = ts;
        if (isObj(p.pretest)) l.pretest = p.pretest;
        if (Number.isFinite(p.readMs)) l.readMs = p.readMs;
        if (isObj(p.probes)) l.probes = p.probes;
      }
      break;
    case 'learn.recall':
      if (str(p.nodeId)) {
        const n = nodeRec(s, p.nodeId);
        if (Number.isFinite(p.pct)) n.recallPct = p.pct;
        n.lastRecallTs = ts;
        if (Array.isArray(p.missed)) for (const id of p.missed) if (str(id)) atomRec(s, id).forcedDue = ts;
        const l = str(p.loopId) && s.loops[p.loopId];
        if (l) { l.recallPct = Number.isFinite(p.pct) ? p.pct : null; l.step = 'probes'; l.updatedTs = ts; }
      }
      break;
    case 'learn.output':
      if (str(p.loopId) && s.loops[p.loopId]) { s.loops[p.loopId].output = { ts, ms: p.ms || 0 }; s.loops[p.loopId].updatedTs = ts; }
      break;
    case 'learn.completed':
      if (str(p.loopId) && s.loops[p.loopId]) {
        const l = s.loops[p.loopId];
        l.done = true;
        l.completedTs = ts;
        l.step = 'done';
        const n = nodeRec(s, l.nodeId);
        const pct = Number.isFinite(l.recallPct) ? l.recallPct : n.recallPct;
        n.completed++;
        n.lastLoopTs = ts;
        n.status = Number.isFinite(pct) && pct >= 70 ? 'learned' : 'learning';
        if (s.activeLoop[l.nodeId] === p.loopId) delete s.activeLoop[l.nodeId];
      }
      break;
    case 'learn.discarded':
      if (str(p.loopId) && s.loops[p.loopId]) {
        const l = s.loops[p.loopId];
        l.discarded = true;
        l.step = 'discarded';
        if (s.activeLoop[l.nodeId] === p.loopId) delete s.activeLoop[l.nodeId];
      }
      break;
    case 'note.saved':
      if (str(p.nodeId) && [1, 2, 3, 4].includes(p.level)) {
        const n = s.notes[p.nodeId] || (s.notes[p.nodeId] = { revisions: 0, levels: {}, latest: null });
        n.revisions++;
        n.levels[p.level] = { eventId: e.id, ts, words: Number(p.words) || 0, dropped: null };
        n.latest = { level: p.level, eventId: e.id, ts };
        if (Array.isArray(p.sourceIds)) for (const id of p.sourceIds) if (str(id)) s.sourceRevisions[id] = (s.sourceRevisions[id] || 0) + 1;
      }
      break;
    case 'note.dropped':
      if (str(p.nodeId) && s.notes[p.nodeId] && s.notes[p.nodeId].levels[p.level]) {
        s.notes[p.nodeId].levels[p.level].dropped = Array.isArray(p.dropped) ? p.dropped.length : 0;
      }
      break;
    case 'source.added':
      if (str(p.sourceId)) {
        const old = s.sources[p.sourceId];
        s.sources[p.sourceId] = { title: p.title || (old && old.title) || 'Untitled', pages: p.pages || 0, bytes: p.bytes || 0, fileName: p.fileName || '', addedTs: old ? old.addedTs : ts, maps: old ? old.maps : {}, pack: old ? old.pack : null };
      }
      break;
    case 'source.renamed':
      if (str(p.sourceId) && s.sources[p.sourceId] && str(p.title)) s.sources[p.sourceId].title = p.title;
      break;
    case 'source.mapped':
      if (str(p.sourceId) && s.sources[p.sourceId] && str(p.nodeId)) {
        const maps = s.sources[p.sourceId].maps;
        if (p.from === null || p.from === undefined) delete maps[p.nodeId];
        else maps[p.nodeId] = { from: p.from, to: Number.isInteger(p.to) ? p.to : p.from };
      }
      break;
    case 'source.linked':
      if (str(p.sourceId) && s.sources[p.sourceId]) {
        const off = Number.isInteger(p.offset) ? p.offset : 0;
        if (str(p.packId)) {
          s.sources[p.sourceId].pack = { packId: p.packId, offset: off };
          s.packSources[p.packId] = { sourceId: p.sourceId, offset: off };
        } else {
          const old = s.sources[p.sourceId].pack;
          if (old && s.packSources[old.packId] && s.packSources[old.packId].sourceId === p.sourceId) delete s.packSources[old.packId];
          s.sources[p.sourceId].pack = null;
        }
      }
      break;
    case 'settings.set':
      if (str(p.key)) s.settings[p.key] = p.value;
      break;
    case 'profile.set':
      if (str(p.profileId) && str(p.path)) {
        const ed = s.profileEdits[p.profileId] || (s.profileEdits[p.profileId] = {});
        if (p.value === null || p.value === undefined) delete ed[p.path];
        else ed[p.path] = p.value;
      }
      break;
    case 'backup.exported':
      d.lastExportTs = Math.max(d.lastExportTs ?? 0, ts);
      if (str(p.deviceName)) d.name = p.deviceName;
      break;
    default:
      break;
  }
  return s;
}

export function rebuild(events) {
  const sorted = events.slice().sort(compareEvents);
  const s = initialState();
  for (const e of sorted) applyInPlace(s, e);
  return s;
}

// Pure single-event step (used by tests); the app uses applyInPlace on its own copy.
export function applyEvent(state, e) {
  return applyInPlace(structuredClone(state), e);
}

export const sortsAfterLast = (state, e) => !state.last || compareEvents(e, state.last) > 0;

// ---- selectors over content + state ----

export const needsVerify = (atom) => atom.origin === 'model' || atom.verify === true;

// 'clear' (never needed review), 'quarantined', 'approved' or 'discarded'.
// An approval only holds for the exact content approved: if a pack update changes the
// atom, it goes back into Quarantine.
export function quarantineStatus(atom, state) {
  if (!needsVerify(atom)) return 'clear';
  const a = state.atoms[atom.id];
  if (!a || !a.status) return 'quarantined';
  if (a.status === 'discarded') return 'discarded';
  return a.hash === contentHash(atom) ? 'approved' : 'quarantined';
}

export const leechThreshold = (state) => (Number.isInteger(state.settings.leechThreshold) && state.settings.leechThreshold > 0 ? state.settings.leechThreshold : DEFAULT_LEECH);
