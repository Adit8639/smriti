// Commute mode: one-thumb study. #/commute/swipe: today's reviews as cards, tap to reveal,
// swipe to rate (right: had it, left: missed). #/commute/sprint: 60-second true/false
// statement sprints. #/commute/listen: the phone reads the prompt, waits 6 seconds, reads
// the answer, and you tap Know or Don't know. Misses wait in Today for their cause.

import { h, clear, toast } from './ui.js';
import { app, activeProfile, appendEvents, flushState, emit } from './store.js';
import { call } from './data.js';
import { buildQueueNow } from './study.js';
import { autoCard, targetMs, suggestRating } from './probes.js';
import { preview, formatInterval, State, RATING_NAMES } from './fsrs.js';
import { filled } from './cloze.js';
import { quarantineStatus } from './rebuild.js';
import { ulid } from './ulid.js';
import { rng, freshSeed } from './rng.js';
import { pyqProbe } from './pyq.js';
import * as clock from './clock.js';
import { plural } from './util.js';

let cleanup = null;
export function leave() {
  document.body.classList.remove('focus');
  if (cleanup) { try { cleanup(); } catch (_) { /* ignore */ } }
  cleanup = null;
  try { window.speechSynthesis && window.speechSynthesis.cancel(); } catch (_) { /* no speech */ }
}

export async function render(route) {
  const mode = route.arg || '';
  const host = h('div', { class: 'commute-host' });
  if (mode === 'swipe') setTimeout(() => swipe(host), 0);
  else if (mode === 'sprint') setTimeout(() => sprint(host), 0);
  else if (mode === 'listen') setTimeout(() => listen(host), 0);
  else host.append(hub());
  return host;
}

function hub() {
  const card = (href, title, text) => h('a', { class: 'card commute-card', href, 'data-nav': '' }, h('strong', { text: title }), h('span', { class: 'small muted', text }));
  return h('div', { class: 'commute' },
    h('section', { class: 'card' }, h('h2', { text: 'Commute mode' }), h('p', { class: 'small muted', text: 'Built for one thumb on a moving bus or train: big targets in the lower half, no typing.' })),
    card('#/commute/swipe', 'Swipe reviews', "Today's due reviews: tap to see the answer, swipe right if you had it, left if you missed. Misses wait in Today for their cause."),
    card('#/commute/sprint', '60-second statement sprint', 'True or false, as many as you can in a minute, from your probes and PYQs. Counts toward the minimum day.'),
    card('#/commute/listen', 'Listen mode', 'Eyes free: the phone reads the prompt, waits 6 seconds, reads the answer; tap Know or Don’t know. Uses the phone’s voices.'));
}

async function startSession(kind) {
  const sessionId = ulid(clock.now());
  await appendEvents([['session.started', { sessionId, kind }]]);
  return sessionId;
}
const endSession = (sessionId) => appendEvents([['session.ended', { sessionId }]]).then(flushState).catch(() => {});

// Due atoms as simple cards (cloze or prompt → answer).
async function dueAtoms(limit = 200) {
  const q = await buildQueueNow();
  const out = [];
  for (const it of q.items) {
    if (it.type !== 'atom') continue;
    const a = await app.db.get('atoms', it.atomId);
    if (a) out.push({ atom: a, kind: it.kind });
    if (out.length >= limit) break;
  }
  return out;
}

async function rate(atom, { correct, ms, rating, sessionId, format = null }) {
  const profile = activeProfile();
  const probe = autoCard(atom);
  const target = targetMs(probe, profile);
  const rec = app.state.atoms[atom.id];
  const suggested = suggestRating({ correct, partial: false, confidence: correct ? 'sure' : null, ms, target, prevRating: rec && rec.lastRating, format: probe.format });
  await appendEvents([['review.done', { atomId: atom.id, probeId: probe.id, format: format || probe.format, mode: 'review', correct, partial: false, confidence: null, ms, target, suggested, rating: rating || suggested, sessionId }]]);
  return rating || suggested;
}

function done(host, title, lines) {
  document.body.classList.remove('focus');
  clear(host).append(h('div', { class: 'focus-frame' }, h('div', { class: 'card summary' }, h('h2', { text: title }), lines.map((l) => h('p', { text: l })),
    h('div', { class: 'button-row' }, h('a', { class: 'btn primary', href: '#/commute' }, 'Commute mode'), h('a', { class: 'btn', href: '#/today' }, 'Today')))));
}

// ------------------------------------------------------------------ swipe reviews
async function swipe(host) {
  const deck = await dueAtoms();
  if (!deck.length) { done(host, 'Nothing due right now', ['Come back later, or try a 60-second sprint.']); return; }
  document.body.classList.add('focus');
  const sessionId = await startSession('commute');
  let i = 0;
  let right = 0;
  let n = 0;
  cleanup = () => endSession(sessionId);
  const show = () => {
    if (i >= deck.length) { cleanup = null; endSession(sessionId); done(host, 'Deck done', [`${n} cards, ${right} had it.`]); return; }
    const { atom } = deck[i];
    const probe = autoCard(atom);
    const t0 = performance.now();
    let revealed = false;
    const ans = h('p', { class: 'cm-answer', hidden: true, text: filled(atom) });
    const hint = h('p', { class: 'small muted cm-hint', text: 'Tap the card to see the answer.' });
    const card = h('div', { class: 'cm-card', role: 'button', tabindex: '0', 'aria-label': 'Card: tap to reveal' }, h('p', { class: 'cm-prompt', text: probe.stem.replace(/_{3,}/g, '_____') }), ans, hint);
    const rec = app.state.atoms[atom.id];
    const prev = preview(rec && rec.card, clock.now(), app.state.settings.retention);
    let busy = false;
    const go = async (correct, rating = null) => {
      if (!revealed) { reveal(); return; }
      if (busy || !card.isConnected) return;
      busy = true;
      const ms = Math.round(performance.now() - t0);
      n++;
      if (correct) right++;
      const r = await rate(atom, { correct, ms, rating: correct ? rating : 1, sessionId });
      const after = app.state.atoms[atom.id] && app.state.atoms[atom.id].card;
      if (after && (after.state === State.Learning || after.state === State.Relearning) && after.due - clock.now() < 20 * 60000) deck.splice(Math.min(deck.length, i + 4), 0, { atom, kind: 'learning' });
      toast(`${RATING_NAMES[r]}`, { ms: 700 });
      i++;
      show();
    };
    const reveal = () => { if (revealed) return; revealed = true; ans.hidden = false; hint.textContent = 'Swipe right: had it. Left: missed.'; };
    card.addEventListener('click', reveal);
    let x0 = null;
    card.addEventListener('pointerdown', (e) => { x0 = e.clientX; card.setPointerCapture(e.pointerId); });
    card.addEventListener('pointermove', (e) => { if (x0 === null) return; const dx = e.clientX - x0; card.style.transform = `translateX(${dx}px)`; card.classList.toggle('to-keep', dx > 60); card.classList.toggle('to-discard', dx < -60); });
    card.addEventListener('pointerup', (e) => { if (x0 === null) return; const dx = e.clientX - x0; x0 = null; card.style.transform = ''; card.classList.remove('to-keep', 'to-discard'); if (dx > 90) go(true); else if (dx < -90) go(false); });
    clear(host).append(h('div', { class: 'rv commute-run' },
      h('div', { class: 'rv-head' }, h('button', { class: 'btn small', type: 'button', onclick: () => { location.hash = '#/commute'; } }, 'End'), h('div', { class: 'rv-title' }, h('strong', { text: 'Swipe reviews' }), h('span', { class: 'rv-count', text: ` · ${i + 1} / ${deck.length}` })), h('span')),
      h('div', { class: 'rv-body' }, card),
      h('div', { class: 'rv-foot' }, h('div', { class: 'foot-row cm-buttons' },
        h('button', { class: 'btn grow wrong-btn', type: 'button', onclick: () => go(false) }, 'Missed', h('span', { class: 'small block', text: formatInterval(prev[1].due - clock.now()) })),
        h('button', { class: 'btn grow', type: 'button', onclick: () => go(true, 2) }, 'Hard', h('span', { class: 'small block', text: formatInterval(prev[2].due - clock.now()) })),
        h('button', { class: 'btn grow right-btn', type: 'button', onclick: () => go(true) }, 'Had it', h('span', { class: 'small block', text: 'suggested' })),
        h('button', { class: 'btn grow', type: 'button', onclick: () => go(true, 4) }, 'Easy', h('span', { class: 'small block', text: formatInterval(prev[4].due - clock.now()) }))))));
  };
  show();
}

// ------------------------------------------------------------------ 60-second sprint
async function statementPool() {
  const out = [];
  for (const p of await app.db.getAll('probes')) {
    for (const [i, x] of (p.statements || []).entries()) if (x.true === true || x.true === false) out.push({ id: `stmt:${p.id}#${i}`, text: String(x.text).replace(/^Statement-(I|II):\s*/, ''), true: x.true, trap: x.trap || null, reason: x.reason || '', atomId: (p.atoms || [])[0] || null });
    if (p.format === 'tf' && !p.statements && typeof p.answer === 'boolean') out.push({ id: `stmt:${p.id}`, text: p.stem, true: p.answer, trap: null, reason: '', atomId: (p.atoms || [])[0] || null });
  }
  for (const q of await app.db.getAll('pyqs')) {
    if (!Array.isArray(q.options)) continue;
    const pr = pyqProbe(q);
    for (const [i, x] of (pr.statements || []).entries()) if (x.true === true || x.true === false) out.push({ id: `stmt:pyq:${q.id}#${i}`, text: x.text, true: x.true, trap: x.trap, reason: '', atomId: (q.atoms || [])[0] || null });
  }
  return out;
}

async function sprint(host) {
  const pool = await statementPool();
  if (pool.length < 4) { done(host, 'Not enough statements yet', ['Sprints use statements from your probes and PYQs. Import packs with statement probes (Forge F1 and F2).']); return; }
  const deck = rng(freshSeed(clock.now())).shuffle(pool);
  document.body.classList.add('focus');
  const sessionId = await startSession('commute');
  let left = 60000;
  let last = performance.now();
  let i = 0;
  const log = [];
  let over = false;
  const clockEl = h('span', { class: 'mock-time', text: '1:00' });
  const tick = setInterval(() => {
    const now = performance.now();
    if (document.visibilityState === 'visible') left -= now - last;
    last = now;
    clockEl.textContent = `0:${String(Math.max(0, Math.ceil(left / 1000))).padStart(2, '0')}`;
    if (left <= 0) finish();
  }, 200);
  cleanup = () => { clearInterval(tick); endSession(sessionId); };
  const finish = async () => {
    if (over) return;
    over = true;
    clearInterval(tick);
    cleanup = null;
    await endSession(sessionId);
    const right = log.filter((x) => x.ok).length;
    document.body.classList.remove('focus');
    clear(host).append(h('div', { class: 'focus-frame' }, h('div', { class: 'card summary' },
      h('h2', { text: 'Time!' }), h('p', { class: 'big-number' }, h('strong', { text: `${right} / ${log.length}` }), ' right in 60 seconds'),
      log.filter((x) => !x.ok).length ? h('div', null, h('h3', { text: 'Missed' }), h('ul', { class: 'plain small' }, log.filter((x) => !x.ok).map((x) => h('li', null, h('strong', { text: x.s.true ? 'True: ' : 'False: ' }), x.s.text, x.s.trap ? h('span', { class: 'muted', text: ` (trap: ${x.s.trap.replace(/-/g, ' ')})` }) : null, x.s.reason ? h('span', { class: 'muted block', text: x.s.reason }) : null)))) : null,
      h('div', { class: 'button-row' }, h('button', { class: 'btn primary', type: 'button', onclick: () => emit('rerender') }, 'Again'), h('a', { class: 'btn', href: '#/commute' }, 'Commute mode')))));
  };
  const show = () => {
    if (over) return;
    const st = deck[i % deck.length];
    const t0 = performance.now();
    const answer = async (v) => {
      if (over) return;
      const ok = v === st.true;
      log.push({ s: st, ok });
      flash.textContent = ok ? 'Right' : `${st.true ? 'True' : 'False'}${st.trap ? ` · trap: ${st.trap.replace(/-/g, ' ')}` : ''}`;
      flash.className = `cm-flash ${ok ? 'ok-text' : 'error-text'}`;
      const ms = Math.round(performance.now() - t0);
      const ev = [['review.done', { atomId: st.atomId, probeId: st.id, format: 'tf', mode: 'practice', correct: ok, partial: false, confidence: null, ms, target: 8000, suggested: null, rating: null, sessionId }]];
      appendEvents(ev).then(async (evs) => {
        if (!ok && st.atomId) await appendEvents([['review.cause', { reviewId: evs[0].id, atomId: st.atomId, cause: st.true ? 'overthought' : 'trap', trap: st.true ? null : st.trap }]]);
      }).catch(() => {});
      i++;
      show();
    };
    const flash = (host.querySelector('.cm-flash')) || h('p', { class: 'cm-flash' });
    clear(host).append(h('div', { class: 'rv commute-run' },
      h('div', { class: 'rv-head' }, h('button', { class: 'btn small', type: 'button', onclick: () => finish() }, 'Stop'), h('div', { class: 'rv-title' }, h('strong', { text: '60-second sprint' }), h('span', { class: 'rv-count', text: ` · ${log.length} answered` })), clockEl),
      h('div', { class: 'rv-body' }, h('div', { class: 'cm-card' }, h('p', { class: 'cm-prompt', text: st.text })), flash),
      h('div', { class: 'rv-foot' }, h('div', { class: 'foot-row cm-buttons' },
        h('button', { class: 'btn grow cm-big wrong-btn', type: 'button', onclick: () => answer(false) }, 'False', h('span', { class: 'kbd', text: 'F' })),
        h('button', { class: 'btn grow cm-big right-btn', type: 'button', onclick: () => answer(true) }, 'True', h('span', { class: 'kbd', text: 'T' }))))));
  };
  document.addEventListener('keydown', function onKey(e) {
    if (over || !host.isConnected) { document.removeEventListener('keydown', onKey); return; }
    const k = e.key.toLowerCase();
    if (k === 't' || k === 'f') { e.preventDefault(); const btn = host.querySelector(k === 't' ? '.right-btn' : '.wrong-btn'); if (btn) btn.click(); }
  });
  show();
}

// ------------------------------------------------------------------ listen mode
function voicesReady(timeout = 1500) {
  return new Promise((resolve) => {
    const synth = window.speechSynthesis;
    if (!synth) { resolve([]); return; }
    const v = synth.getVoices();
    if (v.length) { resolve(v); return; }
    const t = setTimeout(() => resolve(synth.getVoices()), timeout);
    synth.addEventListener('voiceschanged', () => { clearTimeout(t); resolve(synth.getVoices()); }, { once: true });
  });
}

function speak(text, voice) {
  return new Promise((resolve) => {
    const u = new SpeechSynthesisUtterance(text);
    if (voice) { u.voice = voice; u.lang = voice.lang; } else u.lang = app.state.settings.dictationLang || 'en-IN';
    u.rate = 0.95;
    u.onend = () => resolve(true);
    u.onerror = () => resolve(false);
    window.speechSynthesis.speak(u);
  });
}

async function listen(host) {
  const synth = window.speechSynthesis;
  const voices = synth ? await voicesReady() : [];
  const local = voices.filter((v) => v.localService);
  const pickVoice = (list) => list.find((v) => /en[-_]IN/i.test(v.lang)) || list.find((v) => /^en/i.test(v.lang)) || list[0] || null;
  const offline = !navigator.onLine;
  if (!synth || !voices.length || (offline && !local.length)) {
    clear(host).append(h('div', { class: 'focus-frame' }, h('div', { class: 'card warn' },
      h('h2', { text: 'Listen mode needs a voice on this device' }),
      h('p', { text: !synth ? 'This browser cannot speak text aloud.' : offline ? 'This device has no offline voice, and you are offline.' : 'No voices are available on this device right now.' }),
      h('p', { class: 'small', text: 'On Android: Settings → System → Languages → Text-to-speech output → Preferred engine (Speech Services by Google) → install the English (India) voice data. Then reopen SMRITI.' }),
      h('div', { class: 'button-row' }, h('a', { class: 'btn primary', href: '#/commute/swipe' }, 'Swipe reviews instead'), h('a', { class: 'btn', href: '#/commute' }, 'Back')))));
    return;
  }
  const voice = pickVoice(local.length ? local : voices);
  const deck = await dueAtoms(60);
  if (!deck.length) { done(host, 'Nothing due right now', ['Listen mode reads your due reviews; none are due.']); return; }
  document.body.classList.add('focus');
  const sessionId = await startSession('commute');
  let stopped = false;
  let paused = false;
  cleanup = () => { stopped = true; synth.cancel(); endSession(sessionId); };
  const status = h('p', { class: 'cm-status small muted' });
  const promptEl = h('p', { class: 'cm-prompt' });
  const ansEl = h('p', { class: 'cm-answer', hidden: true });
  const choice = h('div', { class: 'foot-row cm-buttons', hidden: true });
  let resolveChoice = null;
  const know = h('button', { class: 'btn grow cm-big right-btn', type: 'button', onclick: () => resolveChoice && resolveChoice(true) }, 'Know');
  const dont = h('button', { class: 'btn grow cm-big wrong-btn', type: 'button', onclick: () => resolveChoice && resolveChoice(false) }, 'Don’t know');
  choice.append(dont, know);
  const pauseBtn = h('button', { class: 'btn small', type: 'button', onclick: () => { paused = !paused; pauseBtn.textContent = paused ? 'Resume' : 'Pause'; if (paused) synth.pause(); else synth.resume(); } }, 'Pause');
  clear(host).append(h('div', { class: 'rv commute-run' },
    h('div', { class: 'rv-head' }, h('button', { class: 'btn small', type: 'button', onclick: () => { location.hash = '#/commute'; } }, 'End'), h('div', { class: 'rv-title' }, h('strong', { text: 'Listen mode' }), h('span', { class: 'rv-count small muted', text: voice ? ` · ${voice.name}${voice.localService ? '' : ' (online voice)'}` : '' })), pauseBtn),
    h('div', { class: 'rv-body' }, h('div', { class: 'cm-card' }, promptEl, ansEl), status),
    h('div', { class: 'rv-foot' }, choice)));
  const wait = (ms) => new Promise((r) => { const t0 = Date.now(); const iv = setInterval(() => { if (stopped) { clearInterval(iv); r(); return; } if (paused) return; const left = ms - (Date.now() - t0); status.textContent = left > 0 ? `Answer in your head… ${Math.ceil(left / 1000)}` : ''; if (left <= 0) { clearInterval(iv); r(); } }, 200); });
  let n = 0;
  let known = 0;
  for (const { atom } of deck) {
    if (stopped) return;
    const prompt = autoCard(atom).stem.replace(/_{3,}/g, ' blank ');
    promptEl.textContent = autoCard(atom).stem.replace(/_{3,}/g, '_____');
    ansEl.hidden = true;
    choice.hidden = true;
    status.textContent = 'Listening…';
    const t0 = performance.now();
    await speak(prompt, voice);
    if (stopped) return;
    await wait(6000);
    if (stopped) return;
    ansEl.textContent = filled(atom);
    ansEl.hidden = false;
    await speak(`The answer: ${String(atom.answer)}.`, voice);
    if (stopped) return;
    status.textContent = 'Did you know it?';
    choice.hidden = false;
    const ok = await new Promise((r) => { resolveChoice = r; });
    resolveChoice = null;
    if (stopped) return;
    n++;
    if (ok) known++;
    await rate(atom, { correct: ok, ms: Math.round(performance.now() - t0), rating: ok ? 3 : 1, sessionId, format: 'listen' });
  }
  cleanup = null;
  await endSession(sessionId);
  done(host, 'Listen session done', [`${plural(n, 'card')}, ${known} known.`]);
}
