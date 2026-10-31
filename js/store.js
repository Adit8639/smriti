// Page-side app state: device identity, profiles, the rebuilt state and derived caches,
// plus the event append API used by the screens.

import { openDB } from './db.js';
import { ulid } from './ulid.js';
import * as clock from './clock.js';
import { makeEvent } from './events.js';
import { applyInPlace, sortsAfterLast, initialState } from './rebuild.js';
import { STATE_VERSION } from './version.js';
import { effectiveProfile, profileContext, DEFAULT_PROFILE_ID } from './profiles.js';
import { call } from './data.js';

export const app = {
  db: null,
  device: null,        // {deviceId, name, createdAt}
  firstRunAt: null,
  isFirstRun: false,
  profiles: [],
  ctx: { papers: new Map(), exams: new Set(), starter: new Map() },
  state: initialState(),
  derived: { integrity: null, nodeCounts: {}, subtreeCounts: {}, summary: null },
  packNodes: [],
  synced: Promise.resolve(),
};

const listeners = new Set();
export const subscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
export const emit = (what) => { for (const fn of listeners) fn(what); };

export async function getSetting(key) {
  const r = await app.db.get('settings', key);
  return r ? r.value : undefined;
}
export const setSetting = (key, value) => app.db.put('settings', { key, value });

function defaultDeviceName() {
  const ua = navigator.userAgent;
  if (/Android/i.test(ua)) return 'phone';
  if (/iPhone|iPad/i.test(ua)) return 'iphone';
  return 'laptop';
}

export async function initStore() {
  app.db = await openDB();
  let device = await getSetting('device');
  if (!device) {
    app.isFirstRun = true;
    const t = Date.now();
    device = { deviceId: ulid(t), name: defaultDeviceName(), createdAt: t };
    await setSetting('device', device);
    await setSetting('firstRunAt', t);
  }
  app.device = device;
  app.firstRunAt = (await getSetting('firstRunAt')) ?? device.createdAt;
  const tc = await getSetting('testClock');
  clock.setOffset(tc ? tc.offsetMs : 0);
}

export async function loadProfiles() {
  app.profiles = (await app.db.getAll('profiles')).sort((a, b) => (a.name < b.name ? -1 : 1));
  app.ctx = profileContext(app.profiles);
}

// Pack topics in each pack's authored order (the store returns them sorted by id).
export const byAuthoredOrder = (a, b) => (a._pack < b._pack ? -1 : a._pack > b._pack ? 1 : (a._i ?? 1e9) - (b._i ?? 1e9) || (a.id < b.id ? -1 : 1));

export async function loadNodes() {
  app.packNodes = (await app.db.getAll('nodes')).sort(byAuthoredOrder);
}

// Events only ever grow, so a worker result with fewer events than the page already has is
// an older snapshot: keep the newer state and ask for a fresh rebuild.
let catchUp = null;
export function setDerived(d) {
  const older = d.state.count < app.state.count;
  if (!older) app.state = d.state;
  app.derived = { integrity: d.integrity, nodeCounts: d.nodeCounts || {}, subtreeCounts: d.subtreeCounts || {}, summary: d.summary };
  emit('derived');
  if (older && !catchUp) {
    catchUp = setTimeout(async () => {
      catchUp = null;
      setDerived(await call('refresh'));
    }, 300);
  }
}

// Shows the cached state at once; if the event log has moved on, the worker catches up in
// the background (applying only the newer events) and app.synced resolves when it has.
export async function loadDerived() {
  const [st, integ, counts, sub, summary] = await Promise.all(['state', 'integrity', 'nodeCounts', 'subtreeCounts', 'summary'].map((k) => app.db.get('cache', k)));
  const evCount = await app.db.count('events');
  const usable = st && summary && integ && counts && sub && st.value.v === STATE_VERSION;
  if (!usable) {
    setDerived(await call('refresh'));
    app.synced = Promise.resolve();
    return;
  }
  setDerived({ state: st.value, integrity: integ.value, nodeCounts: counts.value, subtreeCounts: sub.value, summary: summary.value });
  app.synced = st.value.count === evCount ? Promise.resolve() : call('refresh').then(setDerived);
}

// After the worker changed content: reload pack nodes, then publish the new caches.
export async function applyDerived(d) {
  await loadNodes();
  setDerived(d);
}

// All nodes by id: profile starter nodes, overridden by nodes from installed packs.
export function allNodes() {
  const m = new Map(app.ctx.starter);
  for (const n of app.packNodes) m.set(n.id, n);
  return m;
}

export function activeProfileId() {
  const id = app.state.settings.activeProfile;
  if (id && app.profiles.some((p) => p.id === id)) return id;
  if (app.profiles.some((p) => p.id === DEFAULT_PROFILE_ID)) return DEFAULT_PROFILE_ID;
  return app.profiles[0] ? app.profiles[0].id : null;
}

// Memoised: rebuilt only when the profile or its overrides change (it is read per card).
let profileMemo = { key: null, value: null };
export function activeProfile() {
  const id = activeProfileId();
  const base = app.profiles.find((p) => p.id === id);
  if (!base) return null;
  const edits = app.state.profileEdits[id];
  const key = `${id}@${base.version}|${edits ? JSON.stringify(edits) : ''}`;
  if (profileMemo.key !== key || profileMemo.base !== base) profileMemo = { key, base, value: effectiveProfile(base, edits) };
  return profileMemo.value;
}

export const workerCtx = () => ({ deviceId: app.device.deviceId, deviceName: app.device.name, now: clock.now() });

// Appends events durably, then applies them to the page's state in place: one small write
// per action, so reviewing never stalls the screen. Appends are serialised so rapid taps
// can never apply to a stale state. The worker persists the state cache in the background.
let chain = Promise.resolve();
let sinceFlush = 0;
export function appendEvents(list) {
  const run = async () => {
    const evs = list.map(([type, payload]) => makeEvent(type, payload, app.device.deviceId, clock.now()));
    const inOrder = sortsAfterLast(app.state, evs[0]);
    await app.db.tx('events', 'readwrite', (s) => { for (const e of evs) s.events.put(e); }, 'strict');
    if (inOrder) {
      for (const e of evs) applyInPlace(app.state, e);
      emit('state');
      sinceFlush += evs.length;
      if (sinceFlush >= 25) flushState();
    } else {
      // Only when the clock is behind the newest event (the test clock moved back, or a
      // merged backup came from a device whose clock ran ahead): the events land mid-log,
      // so the worker replays the whole log. The page then carries on as after an in-order
      // append, without a redraw: redrawing would reopen screens that log an event as they
      // open (the notes writer), which would log again, and again.
      const d = await call('refresh');
      if (d.state.count >= app.state.count) app.state = d.state;
      app.derived = { integrity: d.integrity, nodeCounts: d.nodeCounts || {}, subtreeCounts: d.subtreeCounts || {}, summary: d.summary };
      emit('state');
    }
    return evs;
  };
  const p = chain.then(run, run);
  chain = p.catch(() => {});
  return p;
}

export const appendEvent = (type, payload) => appendEvents([[type, payload]]).then((evs) => evs[0]);

// Asks the worker to write its (synced) state to the cache, e.g. when the app goes to the
// background, so the next start needs no catch-up.
export function flushState() {
  sinceFlush = 0;
  return call('state.flush').catch(() => {});
}
