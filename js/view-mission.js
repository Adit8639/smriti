// The daily mission on Today: blocks built from today's time budget (reviews, a Learn Loop
// on the top-priority topic, a PYQ elimination set, writing, the CA bridge, a five-minute
// close), each with Start, Swap and Skip (skips ask why). Also the streak, misses waiting
// for a cause, and the close-of-day sheet.

import { h, clear, toast, sheet } from './ui.js';
import { app, allNodes, activeProfile, appendEvents, emit } from './store.js';
import { call } from './data.js';
import { dayBounds, limits, minutesToday, currentRules } from './study.js';
import { buildMission, blockDone, dayActivity, dayCounts, streak, BLOCK_KINDS } from './mission.js';
import { causeSheet } from './sheets.js';
import { solvePyqs } from './view-lab.js';
import { quarantineStatus } from './rebuild.js';
import { isAnchored } from './view-ca.js';
import * as clock from './clock.js';
import { localDate, addDays, plural } from './util.js';

const SKIP_REASONS = [['tired', 'Tired'], ['no-time', 'No time'], ['not-useful', 'Not useful today']];

export async function tagPending(list) {
  for (const p of list) {
    if (p.pyqId) {
      const q = await app.db.get('pyqs', p.pyqId);
      if (!q) continue;
      toast(`PYQ ${q.year}: ${String(q.stem).replace(/\s+/g, ' ').slice(0, 90)}…`, { ms: 5000 });
      const ans = await causeSheet({ atom: null });
      if (!ans) break;
      await appendEvents([['review.cause', { reviewId: p.reviewId, atomId: null, pyqId: q.id, cause: ans.cause, other: ans.other || null, trap: ans.trap || null }]]);
      continue;
    }
    const atom = await app.db.get('atoms', p.atomId);
    if (!atom) continue;
    const ans = await causeSheet({ atom });
    if (!ans) break;
    const ev = [['review.cause', { reviewId: p.reviewId, atomId: atom.id, cause: ans.cause, other: ans.other || null, trap: ans.trap || null }]];
    if (ans.cause === 'confused' && ans.other) ev.push(['confusion.hit', { a: atom.id, b: ans.other, via: 'cause', reviewId: p.reviewId }]);
    await appendEvents(ev);
  }
}

// Misses still waiting for a cause: atoms from the queue, PYQs without atoms from state.
export function pendingCauses(q) {
  const pyq = Object.entries(app.state.pyqStats).filter(([, x]) => x.pendingCause).map(([pyqId, x]) => ({ pyqId, reviewId: x.pendingCause }));
  return [...q.pending, ...pyq];
}

export function currentStreak() {
  const today = localDate(clock.now());
  return streak((d) => dayCounts(dayActivity(app.state, d)), today);
}

async function caAtomIds() {
  const ids = new Set();
  for (const x of await app.db.getAll('ca')) for (const id of x.atoms || []) ids.add(id);
  return ids;
}

// Plans today's mission once (the first plan of the day wins on every device).
export async function ensureMission(q, { replan = false } = {}) {
  const today = localDate(clock.now());
  if (app.state.missions[today] && !replan) return app.state.missions[today];
  const profile = activeProfile();
  // No mission before there is anything to study.
  if (!profile || !(app.derived.summary && app.derived.summary.counts.atoms > 0)) return null;
  const rules = currentRules();
  let top = null;
  try {
    const pri = await call('mission.priorities', { profile, today, rules });
    top = (pri.find((p) => p.P > 0 && p.status !== 'learned') || pri.find((p) => p.P > 0) || {}).nodeId || null;
  } catch (_) { top = null; }
  const hasCa = (await app.db.count('ca')) > 0;
  const plan = buildMission({ minutes: minutesToday(), date: today, rules, topNode: top, hasCa, reviewCap: limits().reviewCap, dueCount: q.counts.forced + q.counts.learning + q.counts.due + q.counts.new + q.counts.contrasts });
  if (!plan.blocks.length) return null;
  await appendEvents([['mission.planned', { date: today, minutes: plan.minutes, minimum: plan.minimum, blocks: plan.blocks, replace: replan }]]);
  return app.state.missions[today];
}

function targetText(b, nodes) {
  const t = b.target || {};
  switch (b.kind) {
    case 'reviews': return `${t.reviews || 'All'} due reviews, mixed subjects and formats`;
    case 'learn': return t.nodeId ? `Learn: ${(nodes.get(t.nodeId) || {}).title || t.nodeId} (top priority)` : 'One topic, start to finish';
    case 'pyq': return `${t.pyqs} PYQs with statement marking and confidence`;
    case 'statements': return '10 PYQ statements: a 60-second sprint counts';
    case 'writing': return t.answer ? 'One timed answer on paper (alternate days)' : `${t.sprints} skeleton sprints, 90 s each`;
    case 'ca': return 'Anchor new CA items, then 10 CA facts';
    case 'close': return 'Tag the day\'s misses and preview tomorrow';
    default: return '';
  }
}

// Where a block's Start goes (respecting a swap).
async function startBlock(b, mission, q) {
  const to = (mission.swaps || {})[b.id] || b.kind;
  const t = b.target || {};
  switch (to) {
    case 'reviews': location.hash = '#/review'; return;
    case 'commute': location.hash = '#/commute'; return;
    case 'learn': {
      const node = t.nodeId;
      const loopId = node && app.state.activeLoop[node];
      location.hash = loopId ? `#/learn/${encodeURIComponent(loopId)}` : node ? `#/learn/start/${encodeURIComponent(node)}` : '#/library';
      return;
    }
    case 'pyq': {
      const data = await call('lab.pyqs');
      const rows = data.rows.slice().sort((a, b) => (a.n ? (a.lastOk ? 2 : 1) : 0) - (b.n ? (b.lastOk ? 2 : 1) : 0));
      if (!rows.length) { toast('No PYQs installed yet: a trap drill instead.'); location.hash = '#/practice/traps?tags=scope-creep,number-swap'; return; }
      solvePyqs(rows.slice(0, t.pyqs || 15).map((r) => r.id), 'Elimination Lab');
      return;
    }
    case 'traps': {
      const top = Object.entries(app.state.traps).filter(([k]) => k !== 'untagged').sort((a, b) => b[1] - a[1]).slice(0, 2).map(([k]) => k);
      location.hash = `#/practice/traps?tags=${(top.length ? top : ['scope-creep', 'number-swap']).join(',')}`;
      return;
    }
    case 'csat': location.hash = '#/csat/mixed?level=mixed'; return;
    case 'statements': location.hash = '#/commute/sprint'; return;
    case 'writing': location.hash = t.answer ? '#/mains/answer' : `#/mains/sprint?n=${t.sprints || 3}`; return;
    case 'shadow': location.hash = '#/mains?tab=write'; return;
    case 'ca': {
      const ids = [...(await caAtomIds())];
      const live = [];
      for (const id of ids) {
        const a = await app.db.get('atoms', id);
        if (!a) continue;
        const qs = quarantineStatus(a, app.state);
        if (qs === 'clear' || qs === 'approved') live.push(id);
        if (live.length >= 10) break;
      }
      const nodes = allNodes();
      const unanchored = (await app.db.getAll('ca')).some((x) => !isAnchored(x, nodes) && !(app.state.caMonths[String(x.date).slice(0, 7)] || {}).done);
      if (!live.length || unanchored) { location.hash = '#/ca'; return; }
      location.hash = `#/practice/atoms?ids=${live.map(encodeURIComponent).join(',')}`;
      return;
    }
    case 'intake': location.hash = '#/intake'; return;
    case 'close': closeDay(q); return;
    default: location.hash = '#/today';
  }
}

const SWAPS = {
  reviews: [['commute', 'Commute mode: swipe to rate']],
  learn: [],
  pyq: [['traps', 'Trap drill on your top traps'], ['csat', 'A CSAT set'], ['statements', 'A 60-second statement sprint']],
  statements: [['pyq', 'PYQs instead']],
  writing: [['shadow', 'Shadow Writing'], ['writing', 'Sprints or a timed answer']],
  ca: [['intake', 'PDF intake triage']],
  close: [],
};

async function swapBlock(b, today) {
  const nodes = allNodes();
  let options = SWAPS[b.kind] || [];
  if (b.kind === 'learn') {
    const pri = await call('mission.priorities', { profile: activeProfile(), today, rules: currentRules() });
    options = pri.filter((p) => p.nodeId !== (b.target || {}).nodeId).slice(0, 5).map((p) => [`node:${p.nodeId}`, `Learn: ${(nodes.get(p.nodeId) || {}).title || p.nodeId}`]);
  }
  if (!options.length) { toast('Nothing to swap this block with.'); return; }
  const s = sheet({
    title: `Swap: ${BLOCK_KINDS[b.kind].name}`,
    body: h('div', { class: 'cause-grid' }, options.map(([id, label]) => h('button', {
      class: 'cause-btn', type: 'button',
      onclick: async () => {
        s.close();
        if (id.startsWith('node:')) {
          await appendEvents([['mission.swap', { date: today, block: b.id, to: 'learn' }]]);
          const node = id.slice(5);
          location.hash = app.state.activeLoop[node] ? `#/learn/${encodeURIComponent(app.state.activeLoop[node])}` : `#/learn/start/${encodeURIComponent(node)}`;
          return;
        }
        await appendEvents([['mission.swap', { date: today, block: b.id, to: id }]]);
        emit('rerender');
      },
    }, h('strong', { text: label })))),
  });
}

function skipBlock(b, today) {
  const s = sheet({
    title: `Skip ${BLOCK_KINDS[b.kind].name.toLowerCase()}?`,
    body: h('div', { class: 'cause-grid' }, h('p', { class: 'small muted', text: 'Why? It is logged, so the weekly review can spot a pattern.' }),
      SKIP_REASONS.map(([id, label]) => h('button', { class: 'cause-btn', type: 'button', onclick: async () => { s.close(); await appendEvents([['mission.skip', { date: today, block: b.id, reason: id }]]); emit('rerender'); } }, h('strong', { text: label })))),
  });
}

// Close of day: misses without a cause, then tomorrow's preview.
async function closeDay(q) {
  const today = localDate(clock.now());
  const pending = pendingCauses(q);
  const tomorrow = addDays(today, 1);
  const { dayStart } = dayBounds(clock.now() + 86400000);
  let dueTomorrow = 0;
  for (const rec of Object.values(app.state.atoms)) if (rec.card && rec.card.due < dayStart + 86400000 && rec.card.due >= dayStart) dueTomorrow++;
  const pri = await call('mission.priorities', { profile: activeProfile(), today: tomorrow, rules: currentRules(clock.now() + 86400000) }).catch(() => []);
  const nodes = allNodes();
  const next = pri.find((p) => p.P > 0 && p.status !== 'learned');
  const s = sheet({
    title: 'Close the day',
    body: h('div', null,
      h('h3', { text: '1 · Error triage' }),
      pending.length ? h('p', null, `${plural(pending.length, 'miss', 'misses')} still without a cause. `, h('button', { class: 'btn small', type: 'button', onclick: async () => { s.close(); await tagPending(pending); emit('rerender'); } }, 'Tag them now'))
        : h('p', { class: 'ok-text', text: 'Every miss has a cause.' }),
      h('h3', { text: '2 · Tomorrow' }),
      h('p', { text: `About ${plural(dueTomorrow, 'review')} fall due tomorrow.${next ? ` Top topic to learn: ${(nodes.get(next.nodeId) || {}).title || next.nodeId}.` : ''}` }),
      h('p', { class: 'small muted', text: `Tomorrow's budget: ${minutesToday(clock.now() + 86400000)} minutes.` })),
    actions: [{ label: 'Not yet', onClick: () => s.close() }, { label: 'Close the day', kind: 'primary', onClick: async () => { s.close(); await appendEvents([['mission.closed', { date: today }]]); toast('Day closed. See you tomorrow.', { kind: 'ok' }); emit('rerender'); } }],
  });
}

export async function missionSection(q) {
  const today = localDate(clock.now());
  const mission = await ensureMission(q);
  if (!mission) return null;
  const nodes = allNodes();
  const { dayStart, dayEnd } = dayBounds(clock.now());
  const act = dayActivity(app.state, today, dayStart, dayEnd, await caAtomIds());
  const queueEmpty = q.counts.total === 0;
  const minimumMode = (mission.swaps || {})['*'] === 'minimum';
  const blocks = minimumMode ? buildMission({ minutes: 15, date: today, rules: currentRules(), reviewCap: limits().reviewCap, dueCount: q.counts.total }).blocks : mission.blocks;
  const status = blocks.map((b) => ({ b, done: blockDone(b, act, { queueEmpty, closed: mission.closed }), skipped: (mission.skips || {})[b.id] }));
  const doneN = status.filter((x) => x.done).length;
  const firstOpen = status.find((x) => !x.done && !x.skipped);
  const st = currentStreak();
  const counted = dayCounts(act);
  const list = h('ol', { class: 'mission' }, status.map(({ b, done, skipped }) => {
    const swapped = (mission.swaps || {})[b.id];
    return h('li', { class: `mission-block${done ? ' done' : skipped ? ' skipped' : firstOpen && firstOpen.b === b ? ' next' : ''}` },
      h('span', { class: 'mb-state', 'aria-hidden': 'true', text: done ? '✓' : skipped ? '–' : String(blocks.indexOf(b) + 1) }),
      h('div', { class: 'mb-main' },
        h('div', { class: 'row-between' }, h('strong', { text: BLOCK_KINDS[b.kind].name }), h('span', { class: 'small muted', text: `${b.minutes} min` })),
        h('span', { class: 'small', text: swapped && swapped !== b.kind ? `Swapped: ${(SWAPS[b.kind].find((x) => x[0] === swapped) || [null, swapped])[1]}` : targetText(b, nodes) }),
        skipped ? h('span', { class: 'small muted', text: `Skipped (${(SKIP_REASONS.find((r) => r[0] === skipped) || [null, skipped])[1].toLowerCase()})` }) : null,
        !done && !skipped ? h('div', { class: 'mb-actions' },
          h('button', { class: `btn small${firstOpen && firstOpen.b === b ? ' primary' : ''}`, type: 'button', onclick: () => startBlock(b, mission, q) }, b.kind === 'close' ? 'Close the day' : 'Start'),
          (SWAPS[b.kind] || []).length || b.kind === 'learn' ? h('button', { class: 'btn small', type: 'button', onclick: () => swapBlock(b, today) }, 'Swap') : null,
          b.kind !== 'close' ? h('button', { class: 'btn small', type: 'button', onclick: () => skipBlock(b, today) }, 'Skip') : null) : null));
  }));
  return h('section', { class: 'card hero mission-card' },
    h('div', { class: 'row-between' }, h('h2', { text: minimumMode || mission.minimum ? 'Minimum mission' : "Today's mission" }),
      h('span', { class: `badge ${counted ? 'ok' : 'muted'}`, title: 'One missed day a week never breaks it', text: st ? `${plural(st, 'day')} streak` : 'Start a streak' })),
    h('p', { class: 'small muted', text: `${doneN} of ${blocks.length} blocks done · ${mission.minutes || minutesToday()}-minute budget${counted ? ' · today counts for the streak' : ''}` }),
    list,
    h('div', { class: 'mission-links' },
      !mission.minimum && !minimumMode && doneN < blocks.length ? h('button', { class: 'link-btn small', type: 'button', onclick: async () => { await appendEvents([['mission.swap', { date: today, block: '*', to: 'minimum' }]]); emit('rerender'); } }, 'Bad day? Switch to the 15-minute minimum (reviews + 10 PYQ statements)') : null,
      doneN === 0 && !Object.keys(mission.skips || {}).length ? h('button', { class: 'link-btn small', type: 'button', onclick: async () => { await ensureMission(q, { replan: true }); toast('Mission planned again from your current budget and topics.'); emit('rerender'); } }, 'Re-plan today') : null));
}

// The week a weekly review covers: on Sunday the week ending today; Monday to Wednesday,
// a missed review of last week can still be done.
export function reviewWeek(now = clock.now()) {
  const today = localDate(now);
  const dow = new Date(now).getDay();
  const monday = dow === 0 ? addDays(today, -6) : addDays(today, -((dow + 6) % 7) - 7);
  return { monday, sunday: addDays(monday, 6), catchUp: dow !== 0, open: dow === 0 || dow <= 3 };
}

// Sunday prompt for the weekly review (or a catch-up early in the week).
export function weeklyPrompt() {
  const w = reviewWeek();
  if (!w.open || app.state.weekly[w.monday]) return null;
  if (!Object.keys(app.state.days).some((d) => d >= w.monday && d <= w.sunday)) return null;
  return h('a', { class: 'deck', href: '#/weekly' }, h('strong', { text: w.catchUp ? 'Weekly review (last week)' : 'Weekly review' }), h('span', { class: 'badge warn', text: '15 min' }), h('span', { class: 'small muted', text: 'What moved, your weakest high-weight topics, plan changes and a backup' }));
}
