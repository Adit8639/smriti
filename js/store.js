// Page-side app state: device identity, profiles, the rebuilt state and derived caches,
// plus the event append API used by the screens.

import { openDB } from './db.js';
import { ulid } from './ulid.js';
import * as clock from './clock.js';
import { makeEvent } from './events.js';
import { applyEvent, sortsAfterLast, initialState } from './rebuild.js';
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

export async function loadNodes() {
  app.packNodes = await app.db.getAll('nodes');
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

// Uses the cached state when it matches the event log; otherwise asks the worker to rebuild.
export async function loadDerived() {
  const [st, integ, counts, sub, summary] = await Promise.all(['state', 'integrity', 'nodeCounts', 'subtreeCounts', 'summary'].map((k) => app.db.get('cache', k)));
  const evCount = await app.db.count('events');
  if (!st || !summary || !integ || !counts || !sub || st.value.v !== STATE_VERSION || st.value.count !== evCount) {
    setDerived(await call('refresh'));
  } else {
    setDerived({ state: st.value, integrity: integ.value, nodeCounts: counts.value, subtreeCounts: sub.value, summary: summary.value });
  }
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

export function activeProfile() {
  const id = activeProfileId();
  const base = app.profiles.find((p) => p.id === id);
  return base ? effectiveProfile(base, app.state.profileEdits[id]) : null;
}

export const workerCtx = () => ({ deviceId: app.device.deviceId, deviceName: app.device.name, now: clock.now() });

// Appends one event and updates the cached state in the same transaction. Appends are
// serialised so rapid taps can never apply to a stale state.
let chain = Promise.resolve();
export function appendEvent(type, payload) {
  const run = async () => {
    const ev = makeEvent(type, payload, app.device.deviceId, clock.now());
    if (!sortsAfterLast(app.state, ev)) {
      // Only after the test clock moved back: the event lands mid-log, so the worker
      // replays the whole log instead of the page.
      await app.db.put('events', ev, 'strict');
      setDerived(await call('refresh'));
      return ev;
    }
    const next = applyEvent(app.state, ev);
    await app.db.tx(['events', 'cache'], 'readwrite', (s) => {
      s.events.put(ev);
      s.cache.put({ key: 'state', value: next });
    }, 'strict');
    app.state = next;
    emit('state');
    return ev;
  };
  const p = chain.then(run, run);
  chain = p.catch(() => {});
  return p;
}
