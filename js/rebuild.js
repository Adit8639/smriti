// Pure rebuild: state = fold(sorted events). No clock, no randomness, no storage, and the
// input is never mutated, so the same events always give the same state on every device.

import { compareEvents, EVENT_TYPES } from './events.js';
import { STATE_VERSION } from './version.js';
import { contentHash, isObj } from './util.js';

const KNOWN = new Set(EVENT_TYPES);

export function initialState() {
  return {
    v: STATE_VERSION,
    count: 0,
    last: null,          // {id, ts} of the last event applied
    byType: {},          // type -> count
    unknown: 0,          // events of types this version does not understand
    devices: {},         // deviceId -> {events, firstTs, lastTs, lastExportTs, name}
    packs: {},           // packId -> {installed, version, ts, deviceId}
    atoms: {},           // atomId -> {status: approved|discarded, hash, ts}
    settings: {},        // synced settings, last writer wins
    profileEdits: {},    // profileId -> {path: value}
  };
}

const str = (v) => typeof v === 'string' && v.length > 0;

// Applies one event to a state object in place.
function reduceInto(s, e) {
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
  switch (e.type) {
    case 'pack.installed':
      if (str(p.packId)) s.packs[p.packId] = { installed: true, version: p.version, ts: e.ts, deviceId: e.deviceId };
      break;
    case 'pack.uninstalled':
      if (str(p.packId)) s.packs[p.packId] = { installed: false, version: p.version, ts: e.ts, deviceId: e.deviceId };
      break;
    case 'atom.approved':
    case 'atom.discarded':
      if (str(p.atomId)) {
        s.atoms[p.atomId] = { status: e.type === 'atom.approved' ? 'approved' : 'discarded', hash: p.hash ?? null, ts: e.ts };
      }
      break;
    case 'atom.restored':
      if (str(p.atomId)) delete s.atoms[p.atomId];
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
      d.lastExportTs = Math.max(d.lastExportTs ?? 0, e.ts);
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
  for (const e of sorted) reduceInto(s, e);
  return s;
}

// Incremental path for a new event that sorts after everything already applied.
export function applyEvent(state, e) {
  return reduceInto(structuredClone(state), e);
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
  if (!a) return 'quarantined';
  if (a.status === 'discarded') return 'discarded';
  return a.hash === contentHash(atom) ? 'approved' : 'quarantined';
}
