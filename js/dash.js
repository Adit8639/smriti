// Planner and dashboard data, computed in the data worker: topic priorities P(n), the
// exam-day forecast, the syllabus heatmap and twelve-week trends from the event log.

import { quarantineStatus } from './rebuild.js';
import { pyqCounts, recencyWeights } from './weights.js';
import { nodeMaps, packKinds } from './labdata.js';
import { nodePriorities, examForecast, CA_HEAT_PER_ITEM } from './mission.js';
import { retrievability } from './fsrs.js';
import { archiveDay } from './queue.js';
import { inProfileScope } from './tree.js';

const DAY = 86400000;
const WEEK = 7 * DAY;
const localMs = (iso) => { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d).getTime(); };

function usable(a, state) {
  const q = quarantineStatus(a, state);
  const rec = state.atoms[a.id];
  return (q === 'clear' || q === 'approved') && !(rec && (rec.retired || rec.suspended));
}

// Exam days from the profile: the first paper (Prelims) and, when present, Mains.
export function examDays(profile) {
  const dates = Object.entries((profile && profile.dates) || {}).map(([k, d]) => ({ key: k, ms: localMs(d.date) })).sort((a, b) => a.ms - b.ms);
  const first = dates[0] ? dates[0].ms : Date.now() + 365 * DAY;
  const mains = (dates.find((d) => /mains/i.test(d.key)) || dates[dates.length - 1] || { ms: first }).ms;
  return { first, mains };
}

async function topicsFor(db, state, { profile, today }) {
  const { nodes, subjectOf } = await nodeMaps(db);
  const kinds = await packKinds(db);
  const atoms = (await db.getAll('atoms')).filter((a) => usable(a, state));
  const pyqs = (await db.getAll('pyqs')).filter((q) => kinds.get(q._pack) !== 'mock');
  const { weights } = recencyWeights(pyqCounts({ pyqs, nodes }));
  const heat = new Map();
  const dayMs = localMs(today);
  for (const x of await db.getAll('ca')) {
    const end = localMs(x.date) + (x.shelfLifeDays || 540) * DAY;
    if (end < dayMs) continue;
    const anchors = new Set([...(x.anchors || []), ...Object.keys(state.caAnchors[x.id] || {})]);
    for (const n of anchors) if (nodes.has(n)) heat.set(n, (heat.get(n) || 0) + CA_HEAT_PER_ITEM);
  }
  const byNode = new Map();
  for (const a of atoms) for (const n of a.nodes || []) {
    if (!nodes.has(n)) continue;
    if (profile && !inProfileScope(nodes.get(n), profile)) continue;
    if (!byNode.has(n)) byNode.set(n, []);
    byNode.get(n).push(a);
  }
  const topics = [...byNode.entries()].map(([id, list]) => ({ id, atoms: list, pyqW: weights.get(id) || 0, caHeat: heat.get(id) || 0 }));
  return { topics, nodes, subjectOf, atoms };
}

// Topic priorities for the mission. args: {profile, today, rules}
export async function priorities(db, state, args) {
  const { topics, nodes } = await topicsFor(db, state, args);
  const ex = examDays(args.profile);
  const retention = state.settings.retention;
  const list = nodePriorities({ topics, state, examMs: ex.first, rules: args.rules, retention });
  // Mains-only topics are judged on Mains day.
  for (const p of list) if (p.stage === 'mains') {
    const t = topics.find((x) => x.id === p.nodeId);
    let r = 0;
    for (const a of t.atoms) { const card = state.atoms[a.id] && state.atoms[a.id].card; r += card ? retrievability(card, ex.mains, retention) : 0; }
    p.R = Math.round((r / t.atoms.length) * 1000) / 1000;
    p.P = Math.round(p.W * (1 - p.R) * (1 + 0.2 * p.c) * p.phi * 1000) / 1000;
  }
  list.sort((a, b) => b.P - a.P || b.W - a.W || (a.nodeId < b.nodeId ? -1 : 1));
  return list.slice(0, 60).map((p) => ({ ...p, title: (nodes.get(p.nodeId) || {}).title || p.nodeId, status: (state.nodes[p.nodeId] || {}).status || 'new' }));
}

// Everything the dashboard draws. args: {profile, today, rules, now}
export async function dashData(db, state, args) {
  const { topics, nodes, subjectOf, atoms } = await topicsFor(db, state, args);
  const ex = examDays(args.profile);
  const retention = state.settings.retention;
  const pri = nodePriorities({ topics, state, examMs: ex.first, rules: args.rules, retention });
  // Heatmap: subjects as rows, topics as cells (heaviest first), coloured by predicted recall.
  const rows = new Map();
  for (const p of pri) {
    const s = subjectOf(p.nodeId) || p.nodeId;
    if (!rows.has(s)) rows.set(s, { id: s, title: (nodes.get(s) || {}).title || s, cells: [] });
    rows.get(s).cells.push({ id: p.nodeId, title: (nodes.get(p.nodeId) || {}).title || p.nodeId, W: p.W, R: p.R, atoms: p.atoms, learned: (state.nodes[p.nodeId] || {}).status === 'learned' });
  }
  const heatmap = [...rows.values()].map((r) => ({ ...r, cells: r.cells.sort((a, b) => b.W - a.W || a.R - b.R), weight: r.cells.reduce((a, c) => a + c.W, 0) })).sort((a, b) => b.weight - a.weight);
  const forecast = examForecast({ atoms, state, examMs: ex.first, retention });
  const weakest = pri.filter((p) => p.R < 0.8).sort((a, b) => b.W * (1 - b.R) - a.W * (1 - a.R)).slice(0, 5).map((p) => ({ ...p, title: (nodes.get(p.nodeId) || {}).title || p.nodeId }));

  // Twelve weeks of events for the trends.
  const now = args.now;
  const from = now - 12 * WEEK;
  const recent = await new Promise((resolve, reject) => {
    const r = db.idb.transaction('events').objectStore('events').index('ts').getAll(IDBKeyRange.lowerBound(from));
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  const weekOf = (ts) => Math.min(11, Math.max(0, Math.floor((ts - from) / WEEK)));
  const weeks = Array.from({ length: 12 }, (_, i) => ({ start: from + i * WEEK, ms: [], reviews: 0, causes: { gap: 0, confused: 0, reading: 0, slip: 0 }, active: 0, total: 0 }));
  const GROUP = { 'didnt-know': 'gap', forgot: 'gap', confused: 'confused', misread: 'reading', trap: 'reading', silly: 'slip', overthought: 'slip' };
  for (const e of recent) {
    const w = weeks[weekOf(e.ts)];
    const p = e.payload || {};
    if (e.type === 'review.done' && (p.mode === 'review' || p.mode === 'learn' || !p.mode)) {
      w.reviews++;
      if (p.correct && p.ms > 0 && p.ms < 15 * 60000) w.ms.push(p.ms);
    } else if ((e.type === 'review.cause' || e.type === 'mock.cause') && GROUP[p.cause]) {
      w.causes[GROUP[p.cause]]++;
    }
  }
  for (const s of Object.values(state.sessions)) {
    if (s.start < from) continue;
    const w = weeks[weekOf(s.start)];
    w.active += s.active;
    w.total += Math.max(0, s.end - s.start);
  }
  const trend = weeks.map((w) => {
    const ms = w.ms.sort((a, b) => a - b);
    return { start: w.start, reviews: w.reviews, median: ms.length ? Math.round(ms[Math.floor(ms.length / 2)] / 100) / 10 : null, causes: w.causes, ratio: w.total > 0 ? Math.min(1, w.active / w.total) : null };
  });
  const revisions = Object.entries(state.sourceRevisions).map(([id, n]) => ({ id, title: (state.sources[id] || {}).title || id, n })).sort((a, b) => b.n - a.n).slice(0, 10);
  const mocks = Object.entries(state.mocks).filter(([, m]) => m.status === 'submitted' && m.unlocked).map(([id, m]) => ({ id, ts: m.submittedTs, score: m.score, max: m.max, title: m.title, n: m.n })).sort((a, b) => a.ts - b.ts);
  const archived = atoms.filter((a) => { const end = archiveDay(a); return end !== null && end < localMs(args.today); }).length;
  return { heatmap, forecast, weakest, trend, revisions, mocks, archived, examFirst: ex.first, examMains: ex.mains, topics: pri.length };
}
