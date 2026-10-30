// Daily study limits and queue building shared by Today, Review and the Learn Loop.

import { app, activeProfile } from './store.js';
import { call } from './data.js';
import * as clock from './clock.js';
import { reviewCapFor, DEFAULT_NEW } from './queue.js';

const WEEK = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

export function dayBounds(ms = clock.now()) {
  const d = new Date(ms);
  return {
    dayStart: new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(),
    dayEnd: new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime(),
    weekday: WEEK[d.getDay()],
  };
}

export function minutesToday(ms = clock.now()) {
  const b = app.state.settings.budget || {};
  const v = b[dayBounds(ms).weekday];
  return Number.isInteger(v) ? v : 180;
}

export function limits(ms = clock.now()) {
  const st = app.state.settings;
  const newPerDay = Number.isInteger(st.newPerDay) && st.newPerDay >= 0 ? st.newPerDay : DEFAULT_NEW;
  return { newPerDay, reviewCap: reviewCapFor(minutesToday(ms), st.reviewCap) };
}

export async function buildQueueNow() {
  await app.synced;
  const now = clock.now();
  const { dayStart, dayEnd } = dayBounds(now);
  return call('queue.build', { now, dayStart, dayEnd, profile: activeProfile(), limits: limits(now) });
}

// Answer-producing time vs total time for today's sessions.
export function activeToday(ms = clock.now()) {
  const { dayStart } = dayBounds(ms);
  let active = 0;
  let total = 0;
  for (const s of Object.values(app.state.sessions)) {
    if (s.start < dayStart) continue;
    active += s.active;
    total += Math.max(0, s.end - s.start);
  }
  return { active, total, ratio: total > 0 ? Math.min(1, active / total) : null };
}
