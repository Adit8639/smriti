// Calibration and scoring maths for the Prelims Lab. All pure.
// Negative marking: +m for right, −m·f for wrong (GS-I: +2, −2/3). Attempting a band of
// confidence pays when its accuracy a gives EV = m·a − m·f·(1 − a) > 0, i.e. a > f/(1 + f)
// (25% for f = 1/3).

import { rng } from './rng.js';

export const BANDS = ['sure', '5050', 'guess'];
export const BAND_LABEL = { sure: 'Sure', '5050': '50-50', guess: 'Guess' };
export const MIN_BAND = 5; // fewer answers than this in a band: no rule yet

// Marks per question from an MCQ paper of the profile (defaults: GS-I).
export function marksFor(paper) {
  const right = paper && paper.marks && paper.questions ? paper.marks / paper.questions : 2;
  const f = paper && Number.isFinite(paper.negativeFraction) ? paper.negativeFraction : 1 / 3;
  return { right, wrong: right * f, f };
}

export const ev = (a, m) => m.right * a - m.wrong * (1 - a);
export const breakEven = (m) => m.f / (1 + m.f);
const round = (x, d = 2) => Math.round(x * 10 ** d) / 10 ** d;

// answers: [{c: band, ok: boolean}] → {band: {n, correct, acc, ev, attempt}}
export function bandStats(answers, m) {
  const out = {};
  for (const b of BANDS) out[b] = { n: 0, correct: 0, acc: null, ev: null, attempt: null };
  for (const x of answers) {
    const s = out[x.c];
    if (!s) continue;
    s.n++;
    if (x.ok) s.correct++;
  }
  for (const b of BANDS) {
    const s = out[b];
    if (!s.n) continue;
    s.acc = s.correct / s.n;
    s.ev = round(ev(s.acc, m), 3);
    s.attempt = s.acc > breakEven(m);
  }
  return out;
}

const pct = (x) => `${Math.round(x * 100)}%`;
const PLURAL = { sure: 'Sures', '5050': '50-50s', guess: 'pure guesses' };

// "Attempt 50-50s: 61%. Skip pure guesses: 22%." Bands with too few answers say so.
export function ruleText(stats, m) {
  const parts = [];
  for (const b of BANDS) {
    const s = stats[b];
    if (!s || s.n < MIN_BAND) { parts.push(`${BAND_LABEL[b]}: too few answers yet (${s ? s.n : 0} of ${MIN_BAND}).`); continue; }
    parts.push(`${s.attempt ? 'Attempt' : 'Skip'} ${PLURAL[b]}: ${pct(s.acc)}.`);
  }
  return `${parts.join(' ')} Break-even is ${pct(breakEven(m))}.`;
}

// Bands worth attempting (unknown bands are attempted, as in the exam you would).
export function attemptBands(stats) {
  return new Set(BANDS.filter((b) => !stats[b] || stats[b].n < MIN_BAND || stats[b].attempt));
}

// questions: [{answer}], answers: [{choice, confidence}]; skip: bands left unanswered.
export function scoreMock(questions, answers, m, skip = new Set()) {
  let right = 0;
  let wrong = 0;
  let skipped = 0;
  for (let i = 0; i < questions.length; i++) {
    const a = answers[i];
    if (!a || !Number.isInteger(a.choice) || (a.confidence && skip.has(a.confidence))) { skipped++; continue; }
    if (a.choice === questions[i].answer) right++;
    else wrong++;
  }
  return { right, wrong, skipped, attempted: right + wrong, score: round(right * m.right - wrong * m.wrong), max: round(questions.length * m.right) };
}

// What the same mock would have scored had you left a band blank.
export function simulate(questions, answers, m) {
  const runs = [
    ['As answered', []],
    ['Skipping pure guesses', ['guess']],
    ['Skipping 50-50s and guesses', ['5050', 'guess']],
  ];
  return runs.map(([label, skip]) => ({ label, skip, ...scoreMock(questions, answers, m, new Set(skip)) }));
}

// Marks per question for a sample under an attempt rule.
function meanMarks(sample, attempt, m) {
  if (!sample.length) return 0;
  let t = 0;
  for (const x of sample) if (!x.c || attempt.has(x.c)) t += x.ok ? m.right : -m.wrong;
  return t / sample.length;
}

// Projected paper score as a 10th–90th percentile range. groups: Map subject → answers;
// expected: Map subject → expected questions. A subject with no answers of its own uses the
// pooled answers. Resampling is seeded, so the same data always gives the same range.
export function projectBand({ groups, expected, m, attempt, iters = 1000, seed = 'projection' }) {
  const pooled = [...groups.values()].flat();
  if (!pooled.length) return null;
  const r = rng(seed);
  const parts = [...expected.entries()].filter(([, e]) => e > 0).map(([s, e]) => ({ s, e, data: groups.get(s) && groups.get(s).length ? groups.get(s) : pooled }));
  const totals = [];
  for (let k = 0; k < iters; k++) {
    let total = 0;
    for (const p of parts) {
      const n = p.data.length;
      let t = 0;
      for (let j = 0; j < n; j++) {
        const x = p.data[Math.floor(r.next() * n)];
        if (!x.c || attempt.has(x.c)) t += x.ok ? m.right : -m.wrong;
      }
      total += p.e * (t / n);
    }
    totals.push(total);
  }
  totals.sort((a, b) => a - b);
  const q = (p) => totals[Math.min(totals.length - 1, Math.max(0, Math.round(p * (totals.length - 1))))];
  const point = parts.reduce((acc, p) => acc + p.e * meanMarks(p.data, attempt, m), 0);
  return { p10: round(q(0.1), 1), p50: round(q(0.5), 1), p90: round(q(0.9), 1), point: round(point, 1), n: pooled.length, subjects: parts.length };
}

// Expected questions per subject: recency-weighted PYQ counts, smoothed towards an even
// split so a thin PYQ set cannot put the whole paper on one subject.
export function expectedQuestions(weights, subjects, questions, alpha = 1) {
  const out = new Map();
  const list = [...new Set(subjects)];
  if (!list.length) return out;
  const total = list.reduce((a, s) => a + (weights.get(s) || 0), 0);
  const denom = total + alpha * list.length;
  for (const s of list) out.set(s, (questions * ((weights.get(s) || 0) + alpha)) / denom);
  return out;
}

// CSAT: questions reached in the time at your pace, times your marks per question.
export function projectCsat({ answers, paper }) {
  const m = marksFor(paper);
  if (!answers.length) return null;
  const secs = answers.map((x) => x.ms / 1000).filter((x) => x > 0).sort((a, b) => a - b);
  const median = secs.length ? secs[Math.floor(secs.length / 2)] : null;
  const perQ = meanMarks(answers, new Set(BANDS), m);
  const reach = median ? Math.min(paper.questions, Math.floor((paper.durationMin * 60) / median)) : paper.questions;
  const projected = round(reach * perQ, 1);
  const qualifying = paper.qualifyingPct ? (paper.marks * paper.qualifyingPct) / 100 : null;
  return { projected, reach, median: median ? round(median, 1) : null, accuracy: answers.filter((x) => x.ok).length / answers.length, qualifying, warn: qualifying !== null && projected < 1.25 * qualifying, max: paper.marks };
}
