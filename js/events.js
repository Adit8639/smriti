// The event log is the only source of truth for learning data. Every action appends
// {id (ULID), deviceId, ts, type, payload}; caches are rebuilt from it (see rebuild.js).

import { ulid, ULID_RE } from './ulid.js';
import { isObj } from './util.js';

export const EVENT_TYPE_RE = /^[a-z][a-zA-Z]*(\.[a-z][a-zA-Z]*)+$/;

// Event types this version understands. Unknown types (from a newer app on another device)
// are kept, synced and counted, but ignored by the rebuild.
export const EVENT_TYPES = [
  'pack.installed',    // {packId, version, prevVersion, kind, title, counts}
  'pack.uninstalled',  // {packId, version, title}
  'atom.approved',     // {atomId, hash} released from Quarantine
  'atom.discarded',    // {atomId, hash} rejected in Quarantine
  'atom.restored',     // {atomId} back into Quarantine
  'atom.created',      // {atom} made on a device: quick add, Reader, split (origin "self"), PDF intake (origin "rule")
  'atom.edited',       // {atomId, fields} change to a self-made atom
  'atom.rebuilt',      // {atomId, kind: mnemonic|split|contrast, text?, into?, with?} leech rebuilt
  'atoms.scheduled',   // {atomIds, reason} due today (missed recall, dropped in notes)
  'review.done',       // {atomId, probeId, format, mode, correct, confidence, ms, target, suggested, rating, sessionId, response}
  'review.cause',      // {reviewId, atomId | pyqId, cause, other?, trap?} error cause of a miss
  'confusion.hit',     // {a, b, via, reviewId?} one atom mistaken for another
  'contrast.done',     // {pair, correct, confidence, ms, sessionId}
  'session.started',   // {sessionId, kind, nodeId?}
  'session.active',    // {sessionId, ms} answer-producing time outside reviews (writing, recall)
  'session.ended',     // {sessionId}
  'learn.started',     // {loopId, nodeId, sessionId}
  'learn.step',        // {loopId, step, pretest?, readMs?, probes?}
  'learn.recall',      // {loopId, nodeId, text, ticked, missed, total, pct}
  'learn.output',      // {loopId, nodeId, question, skeleton, ms}
  'learn.completed',   // {loopId, nodeId}
  'learn.discarded',   // {loopId}
  'note.saved',        // {nodeId, level, text, words, sourceIds}
  'note.dropped',      // {nodeId, level, noteId, dropped}
  'source.added',      // {sourceId, title, pages, bytes, fileName}
  'source.renamed',    // {sourceId, title}
  'source.mapped',     // {sourceId, nodeId, from, to} (from null removes)
  'source.linked',     // {sourceId, packId, offset} pack pages ↔ PDF pages
  'mock.started',      // {mockId, title, source, paper, durationMs, marks, questions[]} snapshot of the paper
  'mock.submitted',    // {mockId, answers: [{choice, confidence, ms, marked}], elapsedMs, auto}
  'mock.cause',        // {mockId, i, cause, trap?, other?, atomIds} autopsy tag for one question
  'mock.discarded',    // {mockId} abandoned before submitting
  'csat.answered',     // {qid, type, level, choice, correct, confidence, ms, sessionId, source}
  'mains.sprint',      // {attemptId, sprintId, q, intro, headings: [{h, va}], wayForward, dims, ms, limitMs}
  'mains.answer',      // {attemptId, q, marks, limitMs, writeMs, words, photoIds, rubric, total, dims, valueAdds, modelId}
  'mains.shadow',      // {attemptId, answerId, rebuilt, matched, missed, extra, score, showMs, ms}
  'mains.drill',       // {kind: 'directive', item, choice, answer, correct, ms}
  'mains.case',        // {attemptId, q, stakeholders, values, options: [{text, pros, cons}], choice, justification, ms}
  'mains.essay',       // {attemptId, theme, brainstorm, outline, introDraft, conclusionDraft, ms}
  'mains.precis',      // {attemptId, passage, ref, target, words, text, ideas: {total, kept}, ms}
  'mains.counter',     // {attemptId, claim, counter, rebuttal, ms}
  'ca.anchored',       // {caId, nodeId, remove?} a static anchor added to (or taken off) a CA item
  'ca.monthDone',      // {month: 'YYYY-MM', done} reconciliation of a CA month
  'intake.triaged',    // {batchId, candId, action: keep|discard|edit, revealed, ms, atomId?, sourceId, page}
  'mission.planned',   // {date, minutes, minimum, blocks: [{id, kind, minutes, target}]} the day's plan (first wins)
  'mission.skip',      // {date, block, reason: tired|no-time|not-useful}
  'mission.swap',      // {date, block, to} a block done another way
  'mission.closed',    // {date} the close block: error triage and tomorrow's preview done
  'weekly.done',       // {week: 'YYYY-MM-DD' (its Monday), notes, changes}
  'data.repaired',     // {actions: [...], counts} one-tap repair from Data health
  'settings.set',      // {key, value} synced settings (active profile, budget, study limits)
  'profile.set',       // {profileId, path, value} profile override; value null removes it
  'backup.exported',   // {deviceName, fileName, events}
];

export function makeEvent(type, payload, deviceId, ts) {
  if (!EVENT_TYPE_RE.test(type)) throw new Error(`Bad event type "${type}"`);
  return { id: ulid(ts), deviceId, ts: Math.round(ts), type, payload: payload ?? {} };
}

// Returns an error message, or null when the event is well-formed.
export function checkEvent(e) {
  if (!isObj(e)) return 'is not an object';
  if (typeof e.id !== 'string' || !ULID_RE.test(e.id)) return `id ${JSON.stringify(e.id)} is not a ULID`;
  if (typeof e.deviceId !== 'string' || !e.deviceId) return 'deviceId is missing';
  if (!Number.isInteger(e.ts) || e.ts < 0) return `ts ${JSON.stringify(e.ts)} is not a millisecond timestamp`;
  if (typeof e.type !== 'string' || !EVENT_TYPE_RE.test(e.type)) return `type ${JSON.stringify(e.type)} is not valid`;
  if (!isObj(e.payload)) return 'payload must be an object';
  return null;
}

// Total order used by every rebuild: time, then id. Both devices therefore replay the same
// merged log in the same order and reach the same state.
export function compareEvents(a, b) {
  if (a.ts !== b.ts) return a.ts - b.ts;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}
