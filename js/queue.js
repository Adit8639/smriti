// Queue builder (runs in the data worker). Due atoms, learning steps and today's new atoms,
// interleaved: never more than 3 in a row from one topic, a new atom after every 5 reviews.
// A daily cap keeps the day honest: overflow is reported, never hidden, and new atoms
// pause while due reviews overflow. Exam anchoring guarantees one review of every
// Prelims atom in the 45 days before the first paper and pauses Mains-only atoms.

import { quarantineStatus } from './rebuild.js';
import { retrievability, State } from './fsrs.js';
import { fnv1a } from './util.js';

const DAY = 86400000;
export const LEARN_AHEAD = 20 * 60e3;
export const WINDOW_DAYS = 45;
export const DEFAULT_NEW = 30;

export const isMainsOnly = (atom) => Array.isArray(atom.stage) && atom.stage.length > 0 && atom.stage.every((x) => x === 'mains');
export const isPrelims = (atom) => !Array.isArray(atom.stage) || atom.stage.length === 0 || atom.stage.includes('prelims');

const localMs = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).getTime();
};

// Exam window from the profile's first paper date.
export function examAnchor(profile, dayStart) {
  if (!profile || !profile.dates) return null;
  const dates = Object.values(profile.dates).map((d) => d.date).filter(Boolean).sort();
  if (!dates.length) return null;
  const examMs = localMs(dates[0]);
  const windowStart = examMs - WINDOW_DAYS * DAY;
  return { examMs, windowStart, inWindow: dayStart >= windowStart && dayStart <= examMs, pauseMains: dayStart >= windowStart && dayStart < examMs + DAY };
}

// Inside the window, a Prelims atom not yet reviewed there becomes due on a spread day.
export function anchoredDue(card, rec, atom, anchor) {
  if (!anchor || !isPrelims(atom)) return card.due;
  if (rec && rec.lastTs && rec.lastTs >= anchor.windowStart) return card.due;
  const spread = (parseInt(fnv1a(atom.id), 16) % (WINDOW_DAYS - 5)) * DAY;
  return Math.min(card.due, anchor.windowStart + spread);
}

// Review cap for a day from the weekday budget: 200 on a 3-hour day, scaled, 50–400.
export function reviewCapFor(minutes, setting) {
  if (Number.isInteger(setting) && setting > 0) return setting;
  const m = Number.isFinite(minutes) ? minutes : 180;
  return Math.max(50, Math.min(400, Math.round((200 * m) / 180)));
}

// Current-affairs facts count for Prelims until their event date + shelf life, then archive
// (they stay searchable). The shelf life is the atom's own, else its CA item's, else 540 days.
export const DEFAULT_SHELF_DAYS = 540;
export function shelfLife(atom, caShelf) {
  return atom.shelfLifeDays || (caShelf && caShelf.get(atom.id)) || DEFAULT_SHELF_DAYS;
}
export function archiveDay(atom, caShelf) {
  if (!atom.eventDate || !/^\d{4}-\d{2}-\d{2}$/.test(atom.eventDate)) return null;
  return localMs(atom.eventDate) + shelfLife(atom, caShelf) * DAY;
}
export function isArchived(atom, dayStart, caShelf = null) {
  const end = archiveDay(atom, caShelf);
  return end !== null && dayStart > end;
}

// First index whose topic does not extend a run of 3 from one topic.
function pickIndex(list, out) {
  const tail = out.slice(-3);
  if (tail.length === 3 && tail.every((x) => x.node === tail[0].node)) {
    for (let i = 0; i < Math.min(list.length, 60); i++) if (list[i].node !== tail[0].node) return i;
  }
  return 0;
}

const extendsRun = (out, item) => {
  const tail = out.slice(-3);
  return tail.length === 3 && tail.every((x) => x.node === item.node);
};

export function interleave(reviews, news) {
  const r = reviews.slice();
  const n = news.slice();
  const out = [];
  let since = 0;
  while (r.length || n.length) {
    let takeNew = n.length && (since >= 5 || !r.length);
    let list = takeNew ? n : r;
    let i = pickIndex(list, out);
    // When one list can only extend a run of the same topic, the other list may break it.
    const other = takeNew ? r : n;
    if (extendsRun(out, list[i]) && other.length) {
      const j = pickIndex(other, out);
      if (!extendsRun(out, other[j])) { takeNew = !takeNew; list = other; i = j; }
    }
    out.push(list.splice(i, 1)[0]);
    since = takeNew ? 0 : since + 1;
  }
  return out;
}

// atoms: every atom (packs and self-made). state: rebuilt state. now/dayStart/dayEnd: ms.
// limits: {newPerDay, reviewCap}. nodeOrder: Map nodeId -> tree position.
export function buildQueue({ atoms, state, now, dayStart, dayEnd, profile, limits, nodeOrder, caShelf = null }) {
  const anchor = examAnchor(profile, dayStart);
  const forced = [];
  const learning = [];
  const due = [];
  const newCands = [];
  const leeches = [];
  const pending = [];
  const atomById = new Map();
  let archived = 0;
  let mainsPaused = 0;
  let quarantined = 0;
  let nextDue = null;
  const retention = state.settings.retention;

  for (const atom of atoms) {
    atomById.set(atom.id, atom);
    const rec = state.atoms[atom.id];
    const q = quarantineStatus(atom, state);
    if (q === 'quarantined' || q === 'discarded') { if (q === 'quarantined') quarantined++; continue; }
    if (rec && rec.pendingCause) pending.push({ atomId: atom.id, reviewId: rec.pendingCause });
    if (rec && rec.retired) continue;
    if (rec && rec.suspended) { leeches.push(atom.id); continue; }
    if (isArchived(atom, dayStart, caShelf)) { archived++; continue; }
    if (anchor && anchor.pauseMains && isMainsOnly(atom)) { mainsPaused++; continue; }
    const node = (atom.nodes && atom.nodes[0]) || '';
    const card = rec && rec.card;
    const isForced = rec && rec.forcedDue && rec.forcedDue <= now && !(rec.lastTs && rec.lastTs >= rec.forcedDue);
    if (isForced) { forced.push({ type: 'atom', atomId: atom.id, kind: 'forced', node, sort: rec.forcedDue }); continue; }
    if (!card) { newCands.push({ type: 'atom', atomId: atom.id, kind: 'new', node, self: atom.origin === 'self' }); continue; }
    if (card.state === State.New) { newCands.push({ type: 'atom', atomId: atom.id, kind: 'new', node }); continue; }
    if (card.state === State.Learning || card.state === State.Relearning) {
      if (card.due <= now + LEARN_AHEAD) learning.push({ type: 'atom', atomId: atom.id, kind: 'learning', node, sort: card.due });
      else if (nextDue === null || card.due < nextDue) nextDue = card.due;
      continue;
    }
    const eff = anchoredDue(card, rec, atom, anchor);
    if (eff < dayEnd) due.push({ type: 'atom', atomId: atom.id, kind: 'due', node, sort: retrievability(card, now, retention) });
    else if (nextDue === null || eff < nextDue) nextDue = eff;
  }

  forced.sort((a, b) => a.sort - b.sort);
  learning.sort((a, b) => a.sort - b.sort);
  due.sort((a, b) => a.sort - b.sort || (a.atomId < b.atomId ? -1 : 1));

  // Open contrast cards are scheduled today, once per day until answered right.
  const contrasts = [];
  for (const [pair, c] of Object.entries(state.confusions)) {
    if (!c.contrast || c.contrast.status !== 'open') continue;
    if (c.contrast.lastTs && c.contrast.lastTs >= dayStart) continue;
    if (!atomById.has(c.a) || !atomById.has(c.b)) continue;
    contrasts.push({ type: 'contrast', pair, a: c.a, b: c.b, kind: 'contrast', node: (atomById.get(c.a).nodes || [''])[0] });
  }

  const reviewsToday = state.recent.filter((t) => t >= dayStart).length;
  let newToday = 0;
  for (const [, rec] of Object.entries(state.atoms)) if (rec.firstTs >= dayStart && !rec.introForced) newToday++;
  const cap = limits.reviewCap;
  const capacity = Math.max(0, cap - reviewsToday);
  const fixed = forced.length + learning.length + contrasts.length;
  const room = Math.max(0, capacity - fixed);
  const dueIn = due.slice(0, room);
  const overflow = due.length - dueIn.length;

  // New atoms: self-made first, then topics already in a Learn Loop, then syllabus order,
  // taken round-robin across topics.
  const newLimit = Math.max(0, (limits.newPerDay ?? DEFAULT_NEW) - newToday);
  const newRoom = overflow > 0 ? 0 : Math.min(newLimit, Math.max(0, room - dueIn.length));
  const rank = (it) => {
    const st = state.nodes[it.node];
    const studied = st && (st.status === 'learned' || st.status === 'learning') ? 0 : 1;
    return [it.self ? 0 : 1, studied, nodeOrder && nodeOrder.has(it.node) ? nodeOrder.get(it.node) : 1e9];
  };
  const groups = new Map();
  for (const it of newCands.slice().sort((x, y) => {
    const a = rank(x);
    const b = rank(y);
    return a[0] - b[0] || a[1] - b[1] || a[2] - b[2] || (x.atomId < y.atomId ? -1 : 1);
  })) {
    if (!groups.has(it.node)) groups.set(it.node, []);
    groups.get(it.node).push(it);
  }
  const news = [];
  const lists = [...groups.values()];
  for (let round = 0; news.length < newRoom && lists.some((l) => l.length); round++) {
    for (const l of lists) {
      if (news.length >= newRoom) break;
      if (l.length) news.push(l.shift());
    }
  }

  const reviews = [...contrasts, ...forced, ...learning, ...dueIn];
  const items = interleave(reviews, news);
  return {
    items,
    counts: {
      forced: forced.length, learning: learning.length, due: dueIn.length, dueTotal: due.length, overflow,
      new: news.length, newAvailable: newCands.length, newToday, newLimit: limits.newPerDay ?? DEFAULT_NEW,
      reviewsToday, cap, capacity, paused: overflow > 0 && newLimit > 0, contrasts: contrasts.length,
      mainsPaused, archived, quarantined, total: items.length,
    },
    leeches,
    pending,
    nextDue,
    anchor,
  };
}
