// FSRS scheduling through the vendored ts-fsrs (UMD build, MIT). Cards are stored as
// compact plain objects with millisecond times so they rebuild identically on every device.
// ts-fsrs seeds its interval fuzz from the review time and card state, so results are
// deterministic for the same events.

import '../vendor/ts-fsrs/ts-fsrs.umd.js';

const F = globalThis.FSRS;

export const Rating = { Again: 1, Hard: 2, Good: 3, Easy: 4 };
export const RATING_NAMES = { 1: 'Again', 2: 'Hard', 3: 'Good', 4: 'Easy' };
export const State = { New: 0, Learning: 1, Review: 2, Relearning: 3 };
export const STATE_NAMES = ['New', 'Learning', 'Review', 'Relearning'];
export const DEFAULT_RETENTION = 0.9;
export const FSRS_VERSION = F.FSRSVersion;

const schedulers = new Map();
function scheduler(retention = DEFAULT_RETENTION) {
  const r = Math.min(0.97, Math.max(0.7, Number(retention) || DEFAULT_RETENTION));
  let f = schedulers.get(r);
  if (!f) {
    f = F.fsrs({ request_retention: r, enable_fuzz: true, enable_short_term: true });
    schedulers.set(r, f);
  }
  return f;
}

const pack = (c) => ({
  due: c.due.getTime(),
  s: c.stability,
  d: c.difficulty,
  el: c.elapsed_days,
  sc: c.scheduled_days,
  steps: c.learning_steps,
  reps: c.reps,
  lapses: c.lapses,
  state: c.state,
  last: c.last_review ? c.last_review.getTime() : null,
});

const unpack = (k) => ({
  due: new Date(k.due),
  stability: k.s,
  difficulty: k.d,
  elapsed_days: k.el,
  scheduled_days: k.sc,
  learning_steps: k.steps,
  reps: k.reps,
  lapses: k.lapses,
  state: k.state,
  last_review: k.last === null || k.last === undefined ? undefined : new Date(k.last),
});

export const newCard = (ts) => pack(F.createEmptyCard(new Date(ts)));

// ts-fsrs throws ("Invalid delta_t") for a time before the card's last review. That happens
// when a synced device's clock ran ahead (or the test clock moved back), so such times are
// treated as the moment of the last review. The event log replays in time order, so this
// only ever changes previews shown on screen, never a stored schedule.
const notBefore = (card, ts) => (card && card.last && ts < card.last ? card.last : ts);

export function review(card, ts, rating, retention) {
  return pack(scheduler(retention).next(unpack(card || newCard(ts)), new Date(notBefore(card, ts)), rating).card);
}

// The four possible next cards, keyed by rating.
export function preview(card, ts, retention) {
  const r = scheduler(retention).repeat(unpack(card || newCard(ts)), new Date(notBefore(card, ts)));
  return { 1: pack(r[1].card), 2: pack(r[2].card), 3: pack(r[3].card), 4: pack(r[4].card) };
}

export function retrievability(card, ts, retention) {
  if (!card || card.state === State.New) return 0;
  return scheduler(retention).get_retrievability(unpack(card), new Date(ts), false);
}

// "Didn't know": back to New, keeping the review and lapse counts.
export function forget(card, ts, retention) {
  if (!card) return newCard(ts);
  return pack(scheduler(retention).forget(unpack(card), new Date(ts), false).card);
}

export function formatInterval(ms) {
  if (ms < 60e3) return '<1m';
  const min = ms / 60e3;
  if (min < 60) return `${Math.round(min)}m`;
  const h = min / 60;
  if (h < 24) return `${Math.round(h)}h`;
  const d = h / 24;
  if (d < 30) return `${Math.round(d)}d`;
  const mo = d / 30.44;
  if (mo < 12) return `${mo < 10 ? mo.toFixed(1).replace(/\.0$/, '') : Math.round(mo)}mo`;
  const y = d / 365.25;
  return `${y < 10 ? y.toFixed(1).replace(/\.0$/, '') : Math.round(y)}y`;
}
