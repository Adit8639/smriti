// Probe logic: which way to test an atom (chooser), the auto-card fallback, contrast probes,
// answer checking, response-time targets and the suggested rating. All pure.

import { answerMatches, filled } from './cloze.js';
import { fnv1a } from './util.js';

const DAY = 86400000;

// Formats that take a confidence tag before the reveal (everything except free recall).
export const OBJECTIVE = new Set(['cloze', 'qa', 'tf', 'statement', 'notCorrect', 'match', 'order', 'odd', 'assertionReason', 'identify', 'pyq', 'contrast']);
export const FORMAT_LABEL = {
  cloze: 'Cloze', qa: 'Recall', tf: 'True / false', statement: 'Statements', notCorrect: 'NOT correct', match: 'Match the list',
  order: 'Chronology', odd: 'Odd one out', assertionReason: 'Statement-I / II', identify: 'Identify', explain: 'Explain', pyq: 'PYQ', contrast: 'Contrast',
};

export const hasGap = (text) => /_{3,}/.test(String(text));

// The atom itself as a card: a cloze when its text has a gap, otherwise prompt → answer.
export function autoCard(atom) {
  return {
    id: `auto:${atom.id}`,
    auto: true,
    format: hasGap(atom.text) ? 'cloze' : 'qa',
    atoms: [atom.id],
    stem: atom.text,
    answer: String(atom.answer),
    explanation: atom.note || '',
    difficulty: 1,
  };
}

// Two confusable atoms side by side: match each prompt with its answer.
export function contrastProbe(a, b) {
  const pa = hasGap(a.text) ? a.text : `${a.text} …`;
  const pb = hasGap(b.text) ? b.text : `${b.text} …`;
  return {
    id: `contrast:${a.id}|${b.id}`,
    format: 'contrast',
    atoms: [a.id, b.id],
    stem: 'Tell these two apart: give each statement its answer.',
    pairs: [[pa, String(a.answer)], [pb, String(b.answer)]],
    explanation: `${filled(a)}\n${filled(b)}`,
    difficulty: 2,
  };
}

// Probe formats mapped to the exam's format mix (from the profile's first MCQ paper).
export function formatWeights(profile, atom) {
  const paper = profile && (profile.papers || []).find((p) => p.type === 'mcq' && p.formatMix);
  const mix = (paper && paper.formatMix) || {};
  const single = mix.single ?? 9;
  const mainsOnly = Array.isArray(atom && atom.stage) && atom.stage.length === 1 && atom.stage[0] === 'mains';
  return {
    statement: mix.statement ?? 30,
    notCorrect: mix.notCorrect ?? 7,
    assertionReason: mix.assertionReason ?? 8,
    identify: mix.identify ?? 5,
    match: mix.match ?? 4,
    odd: single,
    tf: single,
    cloze: single,
    qa: single,
    order: 4,
    explain: mainsOnly ? 30 : 3,
  };
}

// Least recently used format for this atom, weighted by the format mix; within a format,
// the least recently used probe. Deterministic, so a review shows the same probe on retry.
export function chooseProbe({ atom, probes, rec, probeUse, weights, now }) {
  const cands = [autoCard(atom), ...probes];
  const byFormat = new Map();
  for (const p of cands) {
    if (!byFormat.has(p.format)) byFormat.set(p.format, []);
    byFormat.get(p.format).push(p);
  }
  const used = (rec && rec.formats) || {};
  const scores = [];
  for (const [format, list] of byFormat) {
    const last = used[format];
    const days = last ? Math.min(60, Math.max(0, (now - last) / DAY)) : 60;
    const w = weights[format] ?? 5;
    scores.push({ format, score: w * (1 + days), n: list.length });
  }
  scores.sort((a, b) => b.score - a.score || (a.format === 'cloze' || a.format === 'qa' ? 1 : 0) - (b.format === 'cloze' || b.format === 'qa' ? 1 : 0) || (a.format < b.format ? -1 : 1));
  const format = scores[0].format;
  const list = byFormat.get(format).slice().sort((a, b) => ((probeUse && probeUse[a.id]) || 0) - ((probeUse && probeUse[b.id]) || 0) || (a.id < b.id ? -1 : 1));
  return { probe: list[0], scores };
}

// Seconds the answer should take: 8 s per card unit, the paper's per-question time for
// full Prelims-style questions. Free recall has no speed target.
export function targetMs(probe, profile) {
  const card = ((profile && profile.targets && profile.targets.cardSeconds) || 8) * 1000;
  const paper = profile && (profile.papers || []).find((p) => p.type === 'mcq' && p.questions);
  const question = paper ? Math.round((paper.durationMin * 60 * 1000) / paper.questions) : 72000;
  switch (probe.format) {
    case 'explain': return null;
    case 'statement': case 'notCorrect': case 'assertionReason': case 'pyq': return question;
    case 'tf': return card * Math.max(1, (probe.statements || []).length || 1);
    case 'order': return card * Math.max(1, (probe.items || []).length);
    case 'match': return probe.options ? question : card * Math.max(1, (probe.pairs || []).length);
    case 'contrast': return card * 2;
    case 'identify': return card * 2;
    default: return card;
  }
}

// Deterministic shuffle (mulberry32 seeded by a string), so a card looks the same on redraw.
export function shuffled(n, seed) {
  let a = parseInt(fnv1a(String(seed)), 16) || 1;
  const rand = () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const idx = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  if (n > 1 && idx.every((v, i) => v === i)) idx.push(idx.shift());
  return idx;
}

// Correctness of a response. partial = right answer reached with a misjudged statement.
export function evaluate(probe, r) {
  switch (probe.format) {
    case 'cloze':
    case 'qa': {
      if (typeof r.self === 'boolean') return { correct: r.self, partial: false };
      return { correct: !!r.typed && answerMatches(r.typed, probe.answer), partial: false };
    }
    case 'tf': {
      if (!probe.statements) return { correct: r.marks && r.marks[0] === probe.answer, partial: false };
      const ok = probe.statements.every((s, i) => r.marks && r.marks[i] === s.true);
      return { correct: ok, partial: false };
    }
    case 'pyq':
    case 'statement': {
      const correct = r.choice === probe.answer;
      const wrongMarks = (probe.statements || []).some((s, i) => (s.true === true || s.true === false) && r.marks && r.marks[i] !== undefined && r.marks[i] !== s.true);
      return { correct, partial: correct && wrongMarks };
    }
    case 'match':
    case 'contrast':
      if (probe.options && probe.format === 'match' && r.choice !== undefined) return { correct: r.choice === probe.answer, partial: false };
      // By text, so two identical answers can be paired either way.
      return { correct: Array.isArray(r.pairing) && r.pairing.length === probe.pairs.length && r.pairing.every((j, i) => j !== null && probe.pairs[j] && probe.pairs[j][1] === probe.pairs[i][1]), partial: false };
    case 'order':
      return { correct: Array.isArray(r.order) && r.order.length === probe.items.length && r.order.every((v, i) => v === i), partial: false };
    case 'explain': {
      const total = (probe.keyPoints || []).length || 1;
      const got = (r.ticked || []).filter(Boolean).length;
      const ratio = got / total;
      return { correct: ratio >= 0.5, partial: false, ratio };
    }
    default:
      return { correct: r.choice === probe.answer, partial: false };
  }
}

// The contract's rule: wrong → Again; correct + Guess → Hard; correct + (slow or 50-50) →
// Hard; correct + Sure within target → Good; correct + Sure under 40% of target after a
// previous Good → Easy. A lucky pass with a misjudged statement is held at Hard.
export function suggestRating({ correct, partial, confidence, ms, target, prevRating, format, ratio }) {
  if (!correct) return 1;
  if (format === 'explain') {
    if (ratio >= 1) return prevRating >= 3 ? 4 : 3;
    return ratio >= 0.8 ? 3 : 2;
  }
  let r;
  const slow = target && ms > target;
  if (confidence === 'guess') r = 2;
  else if (slow || confidence === '5050') r = 2;
  else if (confidence === 'sure' && target && ms < 0.4 * target && prevRating >= 3) r = 4;
  else r = 3;
  if (partial) r = Math.min(r, 2);
  return r;
}

export function ratingReason({ correct, partial, confidence, ms, target, prevRating, format, ratio }) {
  if (!correct) return 'Wrong, so Again.';
  if (format === 'explain') return `${Math.round((ratio || 0) * 100)}% of the key points.`;
  const secs = (x) => `${Math.round(x / 100) / 10} s`;
  if (confidence === 'guess') return 'Right, but a guess: Hard.';
  if (target && ms > target) return `Right but slow (${secs(ms)} vs ${secs(target)} target): Hard.`;
  if (confidence === '5050') return 'Right at 50-50: Hard.';
  if (partial) return 'Right option, but a statement was misjudged: Hard.';
  if (confidence === 'sure' && target && ms < 0.4 * target && prevRating >= 3) return `Fast and sure after a Good (${secs(ms)}): Easy.`;
  return `Sure and within ${target ? secs(target) : 'time'}: Good.`;
}
