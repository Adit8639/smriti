// Timeline Lab (#/timeline): drills on dated atoms (a year as the answer, or a current-
// affairs event date). Order four events; find the missing middle event; date → event;
// event → date. Logged as practice; the schedule is unchanged.

import { h, clear } from './ui.js';
import { app, appendEvents, flushState, emit } from './store.js';
import { importDemoFile } from './view-data.js';
import { quarantineStatus } from './rebuild.js';
import { filled } from './cloze.js';
import { ulid } from './ulid.js';
import { rng, freshSeed } from './rng.js';
import * as clock from './clock.js';
import { plural } from './util.js';

const MODES = [['order', 'Order the events', 'Put four events in time order.'], ['middle', 'Missing middle', 'Which event falls between the two shown?'], ['date2event', 'Date → event', 'A year: which event?'], ['event2date', 'Event → date', 'An event: which year?']];
const ROUNDS = 8;
let cleanup = null;
export function leave() {
  document.body.classList.remove('focus');
  if (cleanup) { try { cleanup(); } catch (_) { /* ignore */ } }
  cleanup = null;
}

// The event label: the atom's text without its blank ("…was fought in ___." → "…was fought").
export const eventLabel = (a) => String(a.text).replace(/\s*,?\s*(?:in|on|of|by|from|during)?\s*(?:\d{1,2}\s+\w+\s+)?_{3,}[.,;]?/i, '').replace(/\s+([.,;])/g, '$1').replace(/[.,;]\s*$/, '').trim();

async function events() {
  const out = [];
  for (const a of await app.db.getAll('atoms')) {
    const q = quarantineStatus(a, app.state);
    if (q !== 'clear' && q !== 'approved') continue;
    const ans = String(a.answer).trim();
    // A year-answer counts only on atoms typed "date" (a threshold year in a fact is not an event).
    let year = a.type === 'date' && /^(1[0-9]{3}|20[0-9]{2})$/.test(ans) && /_{3,}/.test(a.text) ? Number(ans) : null;
    if (!year && a.eventDate) year = Number(String(a.eventDate).slice(0, 4));
    if (!year) continue;
    out.push({ atom: a, year, label: year && /_{3,}/.test(a.text) && Number(ans) === year ? eventLabel(a) : filled(a) });
  }
  return out;
}

export async function render(route) {
  const host = h('div', { class: 'timeline-host' });
  const pool = await events();
  const mode = route.arg || '';
  if (pool.length < 4) {
    host.append(h('section', { class: 'card' }, h('h2', { text: 'Timeline Lab' }),
      h('p', { text: 'Dated atoms (a year as the answer, or a current-affairs event date) become timeline drills.' }),
      h('p', { class: 'small muted', text: `You have ${plural(pool.length, 'dated atom')}; drills need four or more.` }),
      h('button', { class: 'btn primary', type: 'button', onclick: () => importDemoFile('demo-places-dates.json') }, 'Load the demo places and dates')));
    return host;
  }
  if (MODES.some(([id]) => id === mode)) { setTimeout(() => drill(host, pool, mode), 0); return host; }
  const years = pool.map((p) => p.year).sort((a, b) => a - b);
  host.append(h('div', { class: 'timeline-lab' },
    h('section', { class: 'card' }, h('h2', { text: 'Timeline Lab' }), h('p', { class: 'small muted', text: `${plural(pool.length, 'dated atom')}, ${years[0]}–${years[years.length - 1]}.` })),
    h('div', { class: 'csat-grid' }, MODES.map(([id, title, text]) => h('a', { class: 'card commute-card', href: `#/timeline/${id}`, 'data-nav': '' }, h('strong', { text: title }), h('span', { class: 'small muted', text })))),
    h('section', { class: 'card' }, h('h3', { text: 'Your timeline' }), h('ol', { class: 'timeline-list' }, pool.slice().sort((a, b) => a.year - b.year || (a.label < b.label ? -1 : 1)).map((p) => h('li', null, h('strong', { text: String(p.year) }), ` ${p.label}`))))));
  return host;
}

async function drill(host, pool, mode) {
  const r = rng(freshSeed(clock.now()));
  const sessionId = ulid(clock.now());
  await appendEvents([['session.started', { sessionId, kind: 'timeline' }]]);
  cleanup = () => appendEvents([['session.ended', { sessionId }]]).catch(() => {});
  document.body.classList.add('focus');
  const byYear = [...new Map(pool.map((p) => [p.year, p])).values()].sort((a, b) => a.year - b.year);
  let i = 0;
  let right = 0;
  let total = 0;
  const log = (p, correct, ms, count = true) => { if (count) { total++; if (correct) right++; } return appendEvents([['review.done', { atomId: p.atom.id, probeId: `timeline:${mode}:${p.atom.id}`, format: 'timeline', mode: 'practice', correct, partial: false, confidence: null, ms, target: null, suggested: null, rating: null, sessionId }]]).catch(() => {}); };
  const next = () => { i++; if (i < ROUNDS) show(); else finish(); };
  const frame = (title, body, foot) => clear(host).append(h('div', { class: 'rv timeline-drill' },
    h('div', { class: 'rv-head' }, h('button', { class: 'btn small', type: 'button', onclick: () => { location.hash = '#/timeline'; } }, 'End'), h('div', { class: 'rv-title' }, h('strong', { text: title }), h('span', { class: 'rv-count', text: ` · ${i + 1} / ${ROUNDS}` })), h('span')),
    h('div', { class: 'rv-body' }, body), h('div', { class: 'rv-foot' }, foot)));
  const choiceRound = (title, question, correct, options, label, p, explain) => {
    const t0 = performance.now();
    const verdict = h('p', { class: 'map-verdict' });
    const box = h('div', { class: 'opts' });
    options.forEach((o) => box.append(h('button', {
      class: 'opt', type: 'button',
      onclick: async () => {
        if (box.dataset.done) return;
        box.dataset.done = '1';
        const ok = o === correct;
        [...box.children].forEach((b, k) => { b.disabled = true; if (options[k] === correct) b.classList.add('right'); else if (options[k] === o) b.classList.add('wrong'); });
        verdict.textContent = explain;
        verdict.className = `map-verdict ${ok ? 'ok-text' : 'error-text'}`;
        await log(p, ok, Math.round(performance.now() - t0));
        box.append(h('button', { class: 'btn primary block-btn', type: 'button', onclick: next }, i < ROUNDS - 1 ? 'Next' : 'Finish'));
      },
    }, h('span', { class: 'opt-text', text: label(o) }))));
    frame(title, h('div', null, h('p', { class: 'question', text: question }), box, verdict), h('span'));
  };
  const show = () => {
    if (mode === 'order') {
      const four = r.sample(byYear, Math.min(4, byYear.length));
      const shown = r.shuffle(four);
      const picked = [];
      const t0 = performance.now();
      const placed = h('ol', { class: 'order-placed' });
      const verdict = h('p', { class: 'map-verdict' });
      const pool2 = h('div', { class: 'order-pool' });
      const check = async () => {
        const sorted = four.slice().sort((a, b) => a.year - b.year);
        const ok = picked.every((p, k) => p === sorted[k]);
        clear(placed);
        picked.forEach((p, k) => placed.append(h('li', { class: p === sorted[k] ? 'right' : 'wrong', text: `${p.label} (${p.year})` })));
        verdict.textContent = ok ? 'Right order.' : `Correct order: ${sorted.map((p) => `${p.year} ${p.label}`).join(' → ')}`;
        verdict.className = `map-verdict ${ok ? 'ok-text' : 'error-text'}`;
        const ms = Math.round(performance.now() - t0);
        for (const [n, p] of four.entries()) await log(p, ok, ms, n === 0);
        clear(foot).append(h('button', { class: 'btn primary grow', type: 'button', onclick: next }, i < ROUNDS - 1 ? 'Next' : 'Finish'));
      };
      shown.forEach((p) => pool2.append(h('button', {
        class: 'order-item', type: 'button',
        onclick: (e) => { if (picked.includes(p) || picked.length >= four.length) return; picked.push(p); e.currentTarget.classList.add('used'); e.currentTarget.disabled = true; placed.append(h('li', { text: p.label })); if (picked.length === four.length) check(); },
      }, h('span', { class: 'opt-text', text: p.label }))));
      const foot = h('div', { class: 'foot-row' }, h('p', { class: 'small muted', text: 'Tap the events from earliest to latest.' }));
      frame('Order the events', h('div', null, pool2, placed, verdict), foot);
    } else if (mode === 'middle') {
      const k = r.int(1, byYear.length - 2);
      const a = byYear[k - 1]; const mid = byYear[k]; const c = byYear[k + 1];
      const outside = byYear.filter((p) => p.year < a.year || p.year > c.year);
      const opts = r.shuffle([mid, ...r.sample(outside, Math.min(3, outside.length))]);
      choiceRound('Missing middle', `${a.year}: ${a.label}\n…\n${c.year}: ${c.label}\nWhich event came in between?`, mid, opts, (p) => p.label, mid, `${mid.year}: ${mid.label}`);
    } else if (mode === 'date2event') {
      const p = r.pick(byYear);
      const opts = r.shuffle([p, ...r.sample(byYear.filter((x) => x !== p), 3)]);
      choiceRound('Date → event', `Which happened in ${p.year}?`, p, opts, (x) => x.label, p, `${p.year}: ${p.label}`);
    } else {
      const p = r.pick(byYear);
      const near = [...new Set([...byYear.filter((x) => x !== p).map((x) => x.year), p.year - 1, p.year + 1, p.year - 2, p.year + 3, p.year - 5].filter((y) => y !== p.year))];
      near.sort((x, y) => Math.abs(x - p.year) - Math.abs(y - p.year));
      const opts = r.shuffle([p.year, ...near.slice(0, 3)]);
      choiceRound('Event → date', `${p.label}: when?`, p.year, opts, (y) => String(y), p, filled(p.atom));
    }
  };
  const finish = async () => {
    cleanup = null;
    await appendEvents([['session.ended', { sessionId }]]).catch(() => {});
    flushState();
    document.body.classList.remove('focus');
    clear(host).append(h('div', { class: 'focus-frame' }, h('div', { class: 'card summary' }, h('h2', { text: 'Drill done' }),
      h('p', { class: 'big-number' }, h('strong', { text: `${right} / ${total}` }), ' right'),
      h('div', { class: 'button-row' }, h('button', { class: 'btn primary', type: 'button', onclick: () => emit('rerender') }, 'Again'), h('a', { class: 'btn', href: '#/timeline' }, 'Timeline Lab')))));
  };
  show();
}
