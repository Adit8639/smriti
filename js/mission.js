// Mission Planner: node priority, the phase calendar's weights, the daily mission built
// from today's time budget, block progress and the streak. All pure.
//
// P(n) = W(n) × (1 − R̄(n)) × (1 + 0.2·c(n)) × φ(n)
//   W: recency-weighted PYQ count (last five PYQ years × 1, older × 0.5) + CA heat, plus a
//      small floor so topics without PYQs still rank by forgetting;
//   R̄: mean FSRS-predicted recall of the topic's atoms on exam day (0 when unlearned);
//   c: open confusion pairs touching the topic (capped at 5);
//   φ: the phase factor (a paused stage scores 0).

import { retrievability } from './fsrs.js';
import { addDays, daysBetween } from './util.js';

export const W_FLOOR = 0.25;
export const CA_HEAT_PER_ITEM = 0.5;

// Stage of a topic from its atoms: 'prelims', 'mains' or 'both'.
export function stageOf(atoms) {
  let pre = false;
  let mains = false;
  for (const a of atoms) {
    const st = Array.isArray(a.stage) && a.stage.length ? a.stage : ['prelims', 'mains'];
    if (st.includes('prelims')) pre = true;
    if (st.includes('mains')) mains = true;
  }
  return pre && mains ? 'both' : mains ? 'mains' : 'prelims';
}

// Phase weights and paused stages (profile phases may set weights {prelims, mains} and
// pause [stage]); sensible defaults by phase id.
export function phaseRules(phase) {
  const id = phase ? phase.id : null;
  const defaults = {
    foundation: { weights: { prelims: 0.5, mains: 0.5 }, pause: [] },
    prelims: { weights: { prelims: 0.85, mains: 0.15 }, pause: ['mains'] },
    mains: { weights: { prelims: 0.1, mains: 0.9 }, pause: ['prelims'] },
  };
  const d = defaults[id] || { weights: { prelims: 0.5, mains: 0.5 }, pause: [] };
  return {
    id, name: phase ? phase.name : null,
    weights: { ...d.weights, ...((phase && phase.weights) || {}) },
    pause: Array.isArray(phase && phase.pause) ? phase.pause : d.pause,
  };
}

export function phiFor(stage, rules) {
  if (stage !== 'both' && rules.pause.includes(stage)) return 0;
  if (stage === 'both') return 1;
  return Math.min(1, rules.weights[stage] * 2);
}

// topics: [{id, atoms: [atom], pyqW, caHeat}] — atoms already filtered to usable ones.
// state: rebuilt state; examMs: the exam day; rules: phaseRules(...).
export function nodePriorities({ topics, state, examMs, rules, retention }) {
  const conf = new Map();
  const atomNode = new Map();
  for (const t of topics) for (const a of t.atoms) atomNode.set(a.id, t.id);
  for (const c of Object.values(state.confusions)) {
    if (!c.contrast || c.contrast.status !== 'open') continue;
    for (const id of new Set([atomNode.get(c.a), atomNode.get(c.b)])) if (id) conf.set(id, (conf.get(id) || 0) + 1);
  }
  return topics.map((t) => {
    let r = 0;
    for (const a of t.atoms) {
      const card = state.atoms[a.id] && state.atoms[a.id].card;
      r += card ? retrievability(card, examMs, retention) : 0;
    }
    const R = t.atoms.length ? r / t.atoms.length : 0;
    const W = (t.pyqW || 0) + (t.caHeat || 0) + W_FLOOR;
    const c = Math.min(5, conf.get(t.id) || 0);
    const stage = stageOf(t.atoms);
    const phi = phiFor(stage, rules);
    const P = W * (1 - R) * (1 + 0.2 * c) * phi;
    return { nodeId: t.id, P: Math.round(P * 1000) / 1000, W: Math.round(W * 100) / 100, R: Math.round(R * 1000) / 1000, c, phi, stage, atoms: t.atoms.length, pyqW: t.pyqW || 0, caHeat: t.caHeat || 0 };
  }).sort((a, b) => b.P - a.P || b.W - a.W || (a.nodeId < b.nodeId ? -1 : 1));
}

// Share of Prelims atoms whose predicted recall on exam day is at least 0.8.
export function examForecast({ atoms, state, examMs, retention, threshold = 0.8 }) {
  let n = 0;
  let ok = 0;
  for (const a of atoms) {
    const st = Array.isArray(a.stage) && a.stage.length ? a.stage : ['prelims'];
    if (!st.includes('prelims')) continue;
    n++;
    const card = state.atoms[a.id] && state.atoms[a.id].card;
    if (card && retrievability(card, examMs, retention) >= threshold) ok++;
  }
  return { n, ok, pct: n ? ok / n : null };
}

// ---------------------------------------------------------------- the daily mission
// The three-hour day of the build kit: 20 reviews, 60 Learn Loop, 30 elimination, 30
// writing, 20 CA bridge, 10 close. Other budgets scale it; 15–20 minutes is the minimum
// viable day: reviews plus 10 PYQ statements.
export const BLOCK_KINDS = {
  reviews: { name: 'Warm-up recall', stage: 'both' },
  learn: { name: 'Learn Loop', stage: 'both' },
  pyq: { name: 'Elimination Lab', stage: 'prelims' },
  writing: { name: 'Writing', stage: 'mains' },
  ca: { name: 'CA Bridge', stage: 'both' },
  close: { name: 'Close', stage: 'both' },
  statements: { name: 'PYQ statements', stage: 'prelims' },
};
const TEMPLATE = [['reviews', 20], ['learn', 60], ['pyq', 30], ['writing', 30], ['ca', 20], ['close', 10]];
export const MIN_DAY_MINUTES = 20;

export function buildMission({ minutes, date, rules, topNode = null, hasCa = true, reviewCap = 200, dueCount = 0 }) {
  const m = Number.isFinite(minutes) ? minutes : 180;
  if (m <= MIN_DAY_MINUTES) {
    return {
      date, minutes: m, minimum: true,
      blocks: [
        { id: 'reviews', kind: 'reviews', minutes: Math.max(8, m - 7), target: { reviews: Math.min(reviewCap, Math.max(10, Math.min(dueCount, 60))) } },
        { id: 'statements', kind: 'statements', minutes: Math.min(7, m), target: { statements: 10 } },
      ],
    };
  }
  const weight = (kind) => {
    const st = BLOCK_KINDS[kind].stage;
    if (st === 'both') return 1;
    if (rules.pause.includes(st)) return 0;
    return Math.min(1.6, rules.weights[st] * 2);
  };
  let blocks = TEMPLATE.filter(([k]) => (k !== 'ca' || hasCa) && (k !== 'learn' || topNode)).map(([kind, base]) => ({ kind, raw: base * weight(kind) })).filter((b) => b.raw > 0);
  // Short days drop the long blocks first (writing, then the Learn Loop) rather than
  // squeezing everything into slivers.
  if (m < 60) blocks = blocks.filter((b) => b.kind !== 'writing');
  if (m < 45) blocks = blocks.filter((b) => b.kind !== 'learn' && b.kind !== 'ca');
  const total = blocks.reduce((a, b) => a + b.raw, 0);
  const odd = Number(String(date).slice(8, 10)) % 2 === 1;
  const out = blocks.map((b) => {
    const mins = Math.max(b.kind === 'close' ? 5 : 10, Math.round((m * b.raw) / total / 5) * 5);
    const block = { id: b.kind, kind: b.kind, minutes: mins, target: {} };
    if (b.kind === 'reviews') block.target.reviews = Math.min(reviewCap, Math.max(10, Math.min(dueCount || reviewCap, Math.round(mins * 6))));
    if (b.kind === 'learn') block.target.nodeId = topNode;
    if (b.kind === 'pyq') block.target.pyqs = Math.max(5, Math.round(mins / 2));
    if (b.kind === 'writing') block.target = odd ? { answer: 1 } : { sprints: Math.max(2, Math.round(mins / 10)) };
    if (b.kind === 'ca') block.target.ca = 10;
    return block;
  });
  return { date, minutes: m, minimum: false, blocks: out };
}

// Activity of one day: the per-day counters from the state, plus CA facts reviewed.
export function dayActivity(state, isoDay, dayStart, dayEnd, caAtomIds = new Set()) {
  const d = state.days[isoDay] || { rev: 0, stmt: 0, active: 0, loops: 0, writes: 0 };
  let ca = 0;
  let sprints = 0;
  let answers = 0;
  if (dayStart !== undefined) {
    for (const x of state.objective) if (x.t >= dayStart && x.t < dayEnd && x.a && caAtomIds.has(x.a)) ca++;
    for (const [id, rec] of Object.entries(state.atoms)) if (caAtomIds.has(id) && rec.lastTs >= dayStart && rec.lastTs < dayEnd && !state.objective.some((x) => x.a === id && x.t >= dayStart)) ca++;
    for (const a of Object.values(state.mains.attempts)) {
      if (a.ts < dayStart || a.ts >= dayEnd) continue;
      if (a.kind === 'sprint') sprints++; else answers++;
    }
  }
  return { reviews: d.rev, statements: d.stmt, pyqs: d.stmt, ca, loops: d.loops, sprints, answers, writes: d.writes, active: d.active };
}

// Whether a block is done given the day's activity.
export function blockDone(block, act, { queueEmpty = false, closed = false } = {}) {
  const t = block.target || {};
  switch (block.kind) {
    case 'reviews': return act.reviews >= (t.reviews || 1) || (queueEmpty && act.reviews > 0) || queueEmpty;
    case 'learn': return act.loops > 0;
    case 'pyq': return act.pyqs >= (t.pyqs || 1);
    case 'statements': return act.statements >= (t.statements || 10);
    case 'writing': return t.answer ? act.answers >= 1 : act.sprints >= (t.sprints || 1) || act.answers >= 1;
    case 'ca': return act.ca >= (t.ca || 1);
    case 'close': return closed;
    default: return false;
  }
}

// A day keeps the streak when the minimum mission was done (reviews plus 10 statements),
// or the full mission, or at least 15 minutes of answer-producing work.
export const dayCounts = (act) => (act.statements >= 10 && act.reviews > 0) || act.active >= 15 * 60000;

// Streak in days ending today (today counts once done; until then the streak runs to
// yesterday). One missed day in any 7-day stretch is forgiven; two misses in a row, or a
// second miss within seven days of a forgiven one, end the streak. Forgiven days do not
// add to the count.
export function streak(countsFor, todayIso, maxDays = 800) {
  let n = 0;
  let d = countsFor(todayIso) ? todayIso : addDays(todayIso, -1);
  let forgiven = null;
  for (let i = 0; i < maxDays; i++) {
    if (countsFor(d)) {
      n++;
    } else {
      if (!countsFor(addDays(d, -1))) break;
      if (forgiven && daysBetween(d, forgiven) < 7) break;
      forgiven = d;
    }
    d = addDays(d, -1);
  }
  return n;
}
