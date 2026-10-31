// Today: the daily hub. What is due, what to learn next, decks that need attention, and
// quick add.

import { h, toast } from './ui.js';
import { app, allNodes, activeProfile, appendEvents, emit } from './store.js';
import { buildQueueNow, activeToday, minutesToday } from './study.js';
import { examCountdown, phaseOn } from './profiles.js';
import { buildTree } from './tree.js';
import { quickAdd } from './sheets.js';
import { missionSection, weeklyPrompt, tagPending, pendingCauses } from './view-mission.js';
import { formatDate, localDate, plural, formatDateTime } from './util.js';
import * as clock from './clock.js';

const STEP_NAMES = { pretest: 1, read: 2, recall: 3, probes: 4, output: 5 };

// First topic in syllabus order (active exam) with atoms and no Learn Loop yet.
export function nextTopic() {
  const nodes = allNodes();
  const tree = buildTree(nodes, activeProfile(), false);
  const counts = app.derived.nodeCounts || {};
  const stack = tree.roots.slice().reverse();
  while (stack.length) {
    const id = stack.pop();
    const c = counts[id];
    const st = app.state.nodes[id];
    if (c && c.atoms > 0 && (!st || st.status === 'new')) return id;
    for (const k of tree.children(id).slice().reverse()) stack.push(k);
  }
  return null;
}

export async function render() {
  const q = await buildQueueNow();
  const c = q.counts;
  const profile = activeProfile();
  const nodes = allNodes();
  const today = localDate(clock.now());
  const root = h('div', { class: 'today' });

  // Exam line
  if (profile) {
    const first = examCountdown(profile, today).find((d) => d.days >= 0);
    const ph = phaseOn(profile, today);
    root.append(h('p', { class: 'scope-line' },
      h('span', { text: first ? `${first.label}: ${plural(first.days, 'day')} to go${first.tentative ? ' (tentative)' : ''}` : profile.name }),
      ph ? h('span', { class: 'badge ok', text: ph.name }) : null));
  }

  // Today's mission
  try {
    const m = await missionSection(q);
    if (m) root.append(m);
  } catch (e) {
    console.error(e);
  }

  // Reviews
  const dueNow = c.forced + c.learning + c.due + c.contrasts;
  const act = activeToday();
  root.append(h('section', { class: 'card' },
    h('h2', { text: 'Reviews' }),
    h('div', { class: 'stat-row' },
      stat(dueNow, 'due now'), stat(c.new, 'new today'), stat(c.reviewsToday, 'done today')),
    c.overflow ? h('p', { class: 'small warn-text', text: `${c.overflow} more reviews are due than today's cap of ${c.cap} (from your ${minutesToday()}-minute budget) allows. They carry over, most-forgotten first; new atoms pause until the backlog clears.` }) : null,
    !c.overflow && c.newAvailable && !c.new && c.newToday >= c.newLimit ? h('p', { class: 'small muted', text: `Today's ${c.newLimit} new atoms are in. More tomorrow.` }) : null,
    c.contrasts ? h('p', { class: 'small', text: `${plural(c.contrasts, 'contrast card')} for confused pairs ${c.contrasts > 1 ? 'are' : 'is'} in today's queue.` }) : null,
    q.anchor && q.anchor.inWindow ? h('p', { class: 'small', text: `Exam window: every Prelims atom gets a review before ${formatDate(localDate(q.anchor.examMs))}.${c.mainsPaused ? ` ${c.mainsPaused} Mains-only atoms pause until the day after.` : ''}` }) : null,
    act.ratio !== null ? h('p', { class: 'small muted', text: `Active ratio today: ${Math.round(act.ratio * 100)}% (target 70% or more).` }) : null,
    c.total ? h('a', { class: 'btn primary block-btn', href: '#/review' }, `Start review (${c.total})`)
      : h('p', { class: 'muted', text: q.nextDue ? `All caught up. Next review ${formatDateTime(q.nextDue)}.` : (app.derived.summary && app.derived.summary.counts.atoms ? 'All caught up.' : 'No atoms yet: import a pack in Data or add your own.') })));

  // Learn
  const loops = Object.entries(app.state.activeLoop).map(([nodeId, loopId]) => ({ nodeId, loopId, loop: app.state.loops[loopId] })).filter((x) => x.loop && nodes.has(x.nodeId));
  const suggest = nextTopic();
  root.append(h('section', { class: 'card' },
    h('h2', { text: 'Learn' }),
    loops.length ? loops.map((x) => h('a', { class: 'btn primary block-btn', href: `#/learn/${encodeURIComponent(x.loopId)}` }, `Resume: ${nodes.get(x.nodeId).title} (step ${STEP_NAMES[x.loop.step] || 1} of 5)`)) : null,
    suggest ? h('div', null,
      h('p', { class: 'small muted', text: 'Next topic in syllabus order:' }),
      h('a', { class: `btn${loops.length ? '' : ' primary'} block-btn`, href: `#/learn/start/${encodeURIComponent(suggest)}` }, `Learn: ${nodes.get(suggest).title}`))
      : (!loops.length ? h('p', { class: 'small muted', text: app.derived.summary && app.derived.summary.counts.atoms ? 'Every topic with atoms has had a Learn Loop. Pick any topic in the Library to learn it again.' : 'Import a pack (Data → Try the demo pack) to start learning.' }) : null)));

  // Decks
  const decks = [];
  const qn = app.derived.summary ? app.derived.summary.quarantine : 0;
  if (qn) decks.push(h('a', { class: 'deck', href: '#/quarantine' }, h('strong', { text: 'Quarantine' }), h('span', { class: 'badge warn', text: String(qn) }), h('span', { class: 'small muted', text: 'AI-written or "verify" atoms waiting for approval' })));
  if (q.leeches.length) decks.push(h('a', { class: 'deck', href: '#/leeches' }, h('strong', { text: 'Rebuild leeches' }), h('span', { class: 'badge warn', text: String(q.leeches.length) }), h('span', { class: 'small muted', text: 'Suspended after repeated lapses' })));
  const weekly = weeklyPrompt();
  if (weekly) decks.push(weekly);
  const pending = pendingCauses(q);
  if (pending.length) {
    decks.push(h('button', { class: 'deck', type: 'button', onclick: async () => { await tagPending(pending); emit('rerender'); } },
      h('strong', { text: 'Misses without a cause' }), h('span', { class: 'badge warn', text: String(pending.length) }), h('span', { class: 'small muted', text: 'Tag each one: errors are data' })));
  }
  const autopsies = Object.entries(app.state.mocks).filter(([, m]) => m.status === 'submitted' && !m.unlocked);
  for (const [id, m] of autopsies) {
    decks.push(h('a', { class: 'deck', href: `#/mock/${id}` }, h('strong', { text: 'Mock autopsy' }), h('span', { class: 'badge warn', text: String(m.needs.length - Object.keys(m.tags).length) }), h('span', { class: 'small muted', text: `${m.title}: tag the misses to unlock the score` })));
  }
  for (const [id, m] of Object.entries(app.state.mocks).filter(([, x]) => x.status === 'started')) {
    decks.push(h('a', { class: 'deck', href: `#/mock/${id}` }, h('strong', { text: 'Mock in progress' }), h('span', { class: 'small muted', text: `${m.title}: resume where you paused` })));
  }
  if (decks.length) root.append(h('section', { class: 'card' }, h('h2', { text: 'Needs you' }), h('div', { class: 'decks' }, decks)));

  // Quick actions in thumb reach.
  root.append(h('div', { class: 'dock', role: 'group', 'aria-label': 'Quick actions' },
    h('button', { class: 'btn', type: 'button', onclick: async () => { const a = await quickAdd({ nodeSuggestions: suggest ? [suggest] : [] }); if (a) location.hash = '#/today'; } }, 'Quick add'),
    c.total ? h('a', { class: 'btn primary', href: '#/review' }, 'Review') : h('a', { class: 'btn', href: '#/library' }, 'Library')));
  return root;
}

function stat(n, label) {
  return h('div', { class: 'stat' }, h('strong', { text: String(n) }), h('span', { class: 'small muted', text: label }));
}

