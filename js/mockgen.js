// Mock builder: a full paper from PYQs, probes and atoms, matching the exam's format mix
// and recency-weighted subject weights. PYQs and pack probes are used as written; when they
// run short, template questions are generated from your atoms and marked "generated"
// (single-answer, statement sets, NOT-correct and how-many). All pure and seeded.

import { rng as makeRng } from './rng.js';
import { hasGap } from './probes.js';
import { normalize, overlap } from './cloze.js';

export const MOCK_FORMATS = ['statement', 'single', 'assertionReason', 'notCorrect', 'identify', 'match', 'howMany'];
const DEFAULT_MIX = { statement: 65, single: 9, assertionReason: 8, notCorrect: 7, identify: 5, match: 4, howMany: 2 };
const ROMANS = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII', 'XIII', 'XIV', 'XV', 'XVI', 'XVII', 'XVIII', 'XIX', 'XX', 'XXI', 'XXII'];
const POSITIVE_Q = 'Which of the statements given above is/are correct?';

// ---------------------------------------------------------------- answer kinds
export function answerKind(ans) {
  const t = String(ans ?? '').trim();
  if (/^(1[0-9]{3}|20[0-9]{2})$/.test(t)) return 'year';
  if (/^\d+(st|nd|rd|th)$/i.test(t)) return 'ordinal';
  if (/^article\s+\d+[a-z]{0,2}$/i.test(t)) return 'article';
  if (/^[IVXL]+$/.test(t)) return 'roman';
  if (/^-?\d+(\.\d+)?\s*%$/.test(t)) return 'percent';
  if (/^-?\d[\d,]*(\.\d+)?$/.test(t)) return 'number';
  if (/^\d+\s+\S/.test(t)) return 'numtext';
  if (t.split(/\s+/).length > 6) return 'long';
  if (/^[A-Z]/.test(t)) return 'name';
  return 'text';
}
const NUMERIC = new Set(['year', 'ordinal', 'article', 'roman', 'percent', 'number', 'numtext']);
const ordSuffix = (n) => (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th');
const numOf = (t) => Number(String(t).replace(/,/g, '').match(/-?\d+(\.\d+)?/)[0]);

// Plausible wrong values near a numeric answer.
function nearValues(ans, kind, r) {
  const t = String(ans).trim();
  const out = [];
  if (kind === 'roman') {
    const i = ROMANS.indexOf(t);
    for (const d of [1, -1, 2, -2, 3, 5, -3]) if (ROMANS[i + d]) out.push(ROMANS[i + d]);
    return out;
  }
  const n = numOf(t);
  const steps = kind === 'year' ? [1, -1, 2, -3, 5, -5, 10, -10] : kind === 'ordinal' || kind === 'article' ? [1, 2, -1, -2, 10, -10, 3, 5] : [2, -2, 1, -1, 4, 5, 10, -5];
  for (const d of r.shuffle(steps)) {
    const v = kind === 'percent' ? n + d * 5 : kind === 'number' && Math.abs(n) >= 100 ? Math.round(n * (1 + d / 20)) : n + d;
    if (v <= 0 && n > 0) continue;
    if (kind === 'ordinal') out.push(`${v}${ordSuffix(v)}`);
    else if (kind === 'article') out.push(t.replace(/\d+/, String(v)));
    else if (kind === 'percent') out.push(`${v}%`);
    else if (kind === 'numtext') out.push(t.replace(/^\d+/, String(v)));
    else out.push(String(v));
  }
  return out;
}

// Up to k wrong answers for an atom: its confusables' answers first, then answers of the
// same kind (same subject first, nearest numbers first), then near values.
export function distractors(atom, pool, r, k = 3) {
  const ans = String(atom.answer);
  const kind = answerKind(ans);
  if (kind === 'long') return [];
  const seen = new Set([normalize(ans)]);
  const out = [];
  const push = (v) => {
    const s = String(v).trim();
    const key = normalize(s);
    if (!s || !key || seen.has(key) || out.length >= k) return;
    if (normalize(atom.text).includes(key) && key.length > 2) return; // already in the sentence
    seen.add(key);
    out.push(s);
  };
  for (const id of atom.confusables || []) {
    const o = pool.byId.get(id);
    if (o && answerKind(o.answer) !== 'long') push(o.answer);
  }
  const sameKind = (pool.byKind.get(kind) || []).filter((o) => o.id !== atom.id);
  const subj = atom._subject;
  const words = ans.split(/\s+/).length;
  let ranked = sameKind.filter((o) => kind !== 'name' && kind !== 'text' ? true : Math.abs(String(o.answer).split(/\s+/).length - words) <= 1);
  if (NUMERIC.has(kind) && kind !== 'roman') {
    const n = numOf(ans);
    ranked = ranked.slice().sort((a, b) => Math.abs(Math.log((numOf(a.answer) || 1) / (n || 1))) - Math.abs(Math.log((numOf(b.answer) || 1) / (n || 1))));
  } else {
    ranked = r.shuffle(ranked);
  }
  ranked.sort((a, b) => (a._subject === subj ? 0 : 1) - (b._subject === subj ? 0 : 1));
  // Words only swap with words that look alike (shared words, or the same topic), so a
  // false statement is never absurd.
  if (kind === 'text' || kind === 'name') {
    ranked = ranked.filter((o) => overlap(o.answer, ans) >= 0.3);
  }
  for (const o of ranked) push(o.answer);
  if (NUMERIC.has(kind)) for (const v of nearValues(ans, kind, r)) push(v);
  return out;
}

const fill = (atom, value) => atom.text.replace(/_{3,}/, String(value));
const TRAP_FOR = { year: 'year-swap', ordinal: 'number-swap', article: 'number-swap', roman: 'number-swap', percent: 'number-swap', number: 'number-swap', numtext: 'number-swap' };
function trapFor(atom, wrong) {
  const kind = answerKind(atom.answer);
  if (TRAP_FOR[kind]) return TRAP_FOR[kind];
  if (/\b(committee|commission|council|board|court|ministry|bank|authority|parliament|sabha|speaker|president|governor|cabinet)\b/i.test(`${atom.answer} ${wrong}`)) return 'institution-swap';
  if (kind === 'text') return 'partial-truth';
  return 'near-name';
}

// ---------------------------------------------------------------- converters
const listStatements = (sts, roman = false) => sts.map((s, i) => `${roman ? ROMANS[i] : i + 1}. ${s}`).join('\n');
const inStem = (stem, text) => String(stem).includes(String(text).replace(/^Statement-(I|II):\s*/, '').slice(0, 40));

export function fromPyq(q, subjectOf) {
  return {
    qid: `pyq:${q.id}`, kind: 'pyq', format: q.format, stem: q.stem, options: q.options.slice(), answer: q.answer,
    explanation: q.elimination || '', nodes: q.nodes || [], atoms: q.atoms || [], subject: subjectOf((q.nodes || [])[0]),
    traps: q.traps || [], year: q.year, answerSource: q.answerSource || null,
  };
}

// Pack probe → mock question, or null when the format has no exam form (cloze, explain…).
export function fromProbe(p, subjectOf, atomsById, r) {
  const nodes = [...new Set((p.atoms || []).flatMap((id) => (atomsById.get(id) || {}).nodes || []))];
  const base = { qid: `probe:${p.id}`, kind: 'probe', nodes, atoms: p.atoms || [], subject: subjectOf(nodes[0]), explanation: p.explanation || '' };
  const traps = (p.statements || []).map((s, i) => (s.trap ? { statement: i + 1, tag: s.trap } : null)).filter(Boolean);
  switch (p.format) {
    case 'statement': {
      const full = (p.statements || []).every((s) => inStem(p.stem, s.text));
      const stem = full ? p.stem : `${p.stem}\n${listStatements(p.statements.map((s) => s.text))}\n${POSITIVE_Q}`;
      return { ...base, format: 'statement', stem, options: p.options.slice(), answer: p.answer, traps };
    }
    case 'assertionReason': {
      const full = (p.statements || []).every((s) => inStem(p.stem, s.text));
      const stem = full ? p.stem : `${p.stem}\n${p.statements.map((s, i) => `Statement-${i ? 'II' : 'I'}: ${s.text.replace(/^Statement-(I|II):\s*/, '')}`).join('\n')}`;
      return { ...base, format: 'assertionReason', stem, options: p.options.slice(), answer: p.answer, traps };
    }
    case 'notCorrect':
    case 'identify':
      return { ...base, format: p.format, stem: p.stem, options: p.options.slice(), answer: p.answer };
    case 'odd':
      return { ...base, format: 'single', stem: p.stem, options: p.options.slice(), answer: p.answer };
    case 'match': {
      if (Array.isArray(p.options) && Number.isInteger(p.answer)) {
        return { ...base, format: 'match', stem: `${p.stem}\n${p.pairs.map(([a, b], i) => `${String.fromCharCode(65 + i)}. ${a} — ${b}`).join('\n')}`, options: p.options.slice(), answer: p.answer };
      }
      return matchCodes(base, p.stem, p.pairs, r);
    }
    case 'order':
      return orderCodes(base, p.stem, p.items, r);
    case 'tf': {
      if (!Array.isArray(p.statements) || p.statements.length < 2 || p.statements.length > 3) return null;
      return statementQuestion(base, p.stem.replace(/^true or false\??$/i, 'Consider the following statements:'), p.statements.map((s) => ({ text: s.text, true: s.true, trap: s.trap })), 'statement', r);
    }
    default:
      return null;
  }
}

// Match-the-list as UPSC codes: "A-2, B-1, C-3".
function matchCodes(base, stem, pairs, r) {
  const n = pairs.length;
  if (n < 3 || n > 4) return null;
  const right = r.shuffle(pairs.map((_, i) => i));          // display position → pair index
  const code = (perm) => perm.map((pos, i) => `${String.fromCharCode(65 + i)}-${pos + 1}`).join(', ');
  const correct = pairs.map((_, i) => right.indexOf(i));     // for left i, right display position
  const seen = new Set([code(correct)]);
  const wrong = [];
  for (let k = 0; wrong.length < 3 && k < 200; k++) {
    const perm = r.shuffle(correct);
    const c = code(perm);
    if (!seen.has(c)) { seen.add(c); wrong.push(c); }
  }
  if (wrong.length < 3) return null;
  const opts = r.shuffle([code(correct), ...wrong]);
  const lists = `List-I:\n${pairs.map(([a], i) => `${String.fromCharCode(65 + i)}. ${a}`).join('\n')}\nList-II:\n${right.map((pi, pos) => `${pos + 1}. ${pairs[pi][1]}`).join('\n')}`;
  return { ...base, format: 'match', stem: `${stem}\n${lists}\nSelect the correct answer using the code given below:`, options: opts, answer: opts.indexOf(code(correct)) };
}

// Chronology as UPSC codes: "2-1-3-4".
function orderCodes(base, stem, items, r) {
  const n = items.length;
  if (n < 3 || n > 5) return null;
  const shown = r.shuffle(items.map((_, i) => i));           // display position → true rank
  const correct = items.map((_, rank) => shown.indexOf(rank) + 1).join('-');
  const seen = new Set([correct]);
  const wrong = [];
  for (let k = 0; wrong.length < 3 && k < 200; k++) {
    const c = r.shuffle(items.map((_, i) => i + 1)).join('-');
    if (!seen.has(c)) { seen.add(c); wrong.push(c); }
  }
  const opts = r.shuffle([correct, ...wrong]);
  return { ...base, format: 'single', stem: `${stem.replace(/:$/, '')}:\n${shown.map((rank, pos) => `${pos + 1}. ${items[rank]}`).join('\n')}\nSelect the correct order (earliest first):`, options: opts, answer: opts.indexOf(correct) };
}

const SUBSET_LABEL = (set, n) => {
  const xs = [...set].sort((a, b) => a - b);
  if (!xs.length) return n === 2 ? 'Neither 1 nor 2' : 'None of the above';
  if (xs.length === n) return n === 2 ? 'Both 1 and 2' : n === 3 ? '1, 2 and 3' : 'All of the above';
  if (xs.length === 1) return `${xs[0]} only`;
  return `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]} only`;
};

// A statement set from statements with known truth: options are subsets ("1 and 3 only")
// or counts ("Only two") for how-many questions.
function statementQuestion(base, intro, sts, format, r) {
  const n = sts.length;
  const truthSet = new Set(sts.map((s, i) => (s.true ? i + 1 : null)).filter(Boolean));
  const stem = `${intro}\n${listStatements(sts.map((s) => s.text))}\n${format === 'howMany' ? 'How many of the above statements are correct?' : POSITIVE_Q}`;
  let options;
  let answer;
  if (format === 'howMany') {
    options = n === 3 ? ['Only one', 'Only two', 'All three', 'None'] : n === 4 ? ['Only one', 'Only two', 'Only three', 'All four'] : null;
    if (!options) return null;
    const count = truthSet.size;
    answer = n === 3 ? (count === 0 ? 3 : count - 1) : count - 1;
    if (answer < 0) return null;
  } else if (n === 2) {
    options = ['1 only', '2 only', 'Both 1 and 2', 'Neither 1 nor 2'];
    answer = truthSet.size === 2 ? 2 : truthSet.size === 0 ? 3 : truthSet.has(1) ? 0 : 1;
  } else {
    const all = [];
    for (let m = 0; m < 1 << n; m++) all.push(new Set(Array.from({ length: n }, (_, i) => (m >> i) & 1 ? i + 1 : null).filter(Boolean)));
    const key = (s) => [...s].sort().join(',');
    const others = r.shuffle(all.filter((s) => key(s) !== key(truthSet) && s.size > 0)).slice(0, 3);
    const sets = [truthSet, ...others].sort((a, b) => a.size - b.size || key(a).localeCompare(key(b)));
    options = sets.map((s) => SUBSET_LABEL(s, n));
    answer = sets.findIndex((s) => key(s) === key(truthSet));
  }
  const traps = sts.map((s, i) => (!s.true && s.trap ? { statement: i + 1, tag: s.trap } : null)).filter(Boolean);
  return { ...base, format, stem, options, answer, traps };
}

// ---------------------------------------------------------------- generated from atoms
function atomStatement(atom, pool, r, makeFalse) {
  if (!hasGap(atom.text)) return null;
  if (!makeFalse) return { text: fill(atom, atom.answer), true: true, trap: null, reason: '' };
  const d = distractors(atom, pool, r, 1)[0];
  if (!d) return null;
  return { text: fill(atom, d), true: false, trap: trapFor(atom, d), reason: `It is ${atom.answer}, not ${d}.` };
}

function genSingle(atom, pool, r) {
  const ds = distractors(atom, pool, r, 3);
  if (ds.length < 3 || answerKind(atom.answer) === 'text') return null;
  const opts = r.shuffle([String(atom.answer), ...ds]);
  const stem = hasGap(atom.text) ? `Which one of the following correctly fills the blank?\n“${atom.text}”` : atom.text;
  return { qid: `gen:single:${atom.id}`, kind: 'gen', format: 'single', stem, options: opts, answer: opts.indexOf(String(atom.answer)),
    explanation: `${fill(atom, atom.answer)}${atom.note ? ` ${atom.note}` : ''}`, nodes: atom.nodes || [], atoms: [atom.id], subject: atom._subject, traps: [] };
}

function genSet(atoms, pool, r, format) {
  const n = atoms.length;
  for (let tries = 0; tries < 6; tries++) {
    const pattern = atoms.map(() => r.chance(0.5));
    if (format === 'howMany' && n === 3 && pattern.every((x) => !x)) pattern[r.int(0, n - 1)] = true;
    if (format === 'notCorrect') { pattern.fill(true); pattern[r.int(0, n - 1)] = false; }
    const sts = atoms.map((a, i) => atomStatement(a, pool, r, !pattern[i]));
    if (sts.some((s) => !s)) continue;
    const nodes = [...new Set(atoms.flatMap((a) => a.nodes || []))];
    const base = { qid: `gen:${format}:${atoms.map((a) => a.id).sort().join('+')}:${pattern.map((x) => (x ? 1 : 0)).join('')}`, kind: 'gen', nodes, atoms: atoms.map((a) => a.id), subject: atoms[0]._subject,
      explanation: atoms.map((a, i) => `${i + 1}. ${pattern[i] ? 'Correct' : `Not correct: ${fill(a, a.answer)}`}`).join('\n') };
    if (format === 'notCorrect') {
      const wrongAt = pattern.indexOf(false);
      return { ...base, format, stem: 'Which one of the following statements is not correct?', options: sts.map((s) => s.text), answer: wrongAt,
        traps: [{ statement: wrongAt + 1, tag: sts[wrongAt].trap }], explanation: `${fill(atoms[wrongAt], atoms[wrongAt].answer)} The other three are correct.` };
    }
    return statementQuestion(base, 'Consider the following statements:', sts, format, r);
  }
  return null;
}

// ---------------------------------------------------------------- the mock
function quotas(mix, n) {
  const entries = MOCK_FORMATS.map((f) => [f, Math.max(0, Number(mix[f]) || 0)]);
  const total = entries.reduce((a, [, w]) => a + w, 0) || 1;
  const raw = entries.map(([f, w]) => [f, (n * w) / total]);
  const out = Object.fromEntries(raw.map(([f, x]) => [f, Math.floor(x)]));
  let left = n - Object.values(out).reduce((a, b) => a + b, 0);
  for (const [f] of raw.slice().sort((a, b) => (b[1] % 1) - (a[1] % 1))) { if (left <= 0) break; out[f]++; left--; }
  return out;
}

// pyqs: MCQ PYQs of the paper (not mock-pack items). probes, atoms: active content.
// subjectOf: node id → subject id. expected: Map subject → expected questions out of n.
export function buildMock({ n = 100, seed, pyqs = [], probes = [], atoms = [], subjectOf = () => null, mix = DEFAULT_MIX, expected = new Map(), usePyqs = true, atomCap = 3 }) {
  const r = makeRng(`mock|${seed}`);
  const pool = { byId: new Map(), byKind: new Map() };
  for (const a of atoms) {
    const x = { ...a, _subject: subjectOf((a.nodes || [])[0]) };
    pool.byId.set(a.id, x);
    const k = answerKind(a.answer);
    if (!pool.byKind.has(k)) pool.byKind.set(k, []);
    pool.byKind.get(k).push(x);
  }
  const atomsById = pool.byId;
  const cands = new Map(MOCK_FORMATS.map((f) => [f, []]));
  const add = (q) => { if (q && cands.has(q.format)) cands.get(q.format).push(q); };
  if (usePyqs) for (const q of pyqs) add(fromPyq(q, subjectOf));
  for (const p of probes) add(fromProbe(p, subjectOf, atomsById, r));
  const usable = [...pool.byId.values()];
  for (const a of usable) add(genSingle(a, pool, r));

  // Statement-style questions from groups of atoms in the same subject.
  const bySubject = new Map();
  for (const a of usable) if (hasGap(a.text)) { const s = a._subject || ''; if (!bySubject.has(s)) bySubject.set(s, []); bySubject.get(s).push(a); }
  const made = new Set();
  const genFrom = (format, want) => {
    let got = 0;
    for (let k = 0; got < want && k < want * 8; k++) {
      const size = format === 'notCorrect' ? 4 : format === 'howMany' ? 3 : r.pick([2, 2, 3]);
      const groups = [...bySubject.values()].filter((g) => g.length >= size);
      if (!groups.length) return;
      const q = genSet(r.sample(r.pick(groups), size), pool, r, format);
      if (q && !made.has(q.qid)) { made.add(q.qid); add(q); got++; }
    }
  };

  const quota = quotas(mix, n);
  for (const f of ['statement', 'notCorrect', 'howMany']) genFrom(f, quota[f] + 6);
  const chosen = [];
  const usedQ = new Set();
  const atomUse = new Map();
  const subjUse = new Map();
  const over = (q, cap) => (q.atoms || []).some((id) => (atomUse.get(id) || 0) >= cap);
  const take = (q) => {
    chosen.push(q);
    usedQ.add(q.qid);
    for (const id of q.atoms || []) atomUse.set(id, (atomUse.get(id) || 0) + 1);
    subjUse.set(q.subject, (subjUse.get(q.subject) || 0) + 1);
  };
  // Prefer PYQs, then pack probes, then generated; among those, subjects under their share.
  const rank = (q) => [q.kind === 'pyq' ? 0 : q.kind === 'probe' ? 1 : 2, expected.size ? (subjUse.get(q.subject) || 0) - (expected.get(q.subject) || 0) : 0];
  const pickFrom = (f, cap) => {
    let best = null;
    let bestRank = null;
    for (const q of cands.get(f)) {
      if (usedQ.has(q.qid) || over(q, cap)) continue;
      const k = rank(q);
      if (!best || k[0] < bestRank[0] || (k[0] === bestRank[0] && k[1] < bestRank[1])) { best = q; bestRank = k; }
    }
    return best;
  };
  // Pass 1: every format towards its share of the paper, one question at a time to the
  // format furthest behind, so no format is starved of atoms by the others.
  const count = Object.fromEntries(MOCK_FORMATS.map((f) => [f, 0]));
  const stuck = new Set();
  while (chosen.length < n) {
    let f = null;
    let gap = 0;
    for (const x of MOCK_FORMATS) {
      if (stuck.has(x) || count[x] >= quota[x]) continue;
      const g = (quota[x] - count[x]) / quota[x];
      if (g > gap) { gap = g; f = x; }
    }
    if (!f) break;
    const q = pickFrom(f, atomCap);
    if (!q) { stuck.add(f); continue; }
    take(q);
    count[f]++;
  }
  // Pass 2: fill what is left, most common formats first, letting an atom appear a little
  // more often only when the content is thin.
  const byWeight = MOCK_FORMATS.slice().sort((a, b) => (mix[b] || 0) - (mix[a] || 0));
  for (let cap = atomCap; chosen.length < n && cap <= atomCap + 6; cap++) {
    genFrom('statement', (n - chosen.length) * 2);
    genFrom('howMany', 4);
    for (const f of byWeight) {
      while (chosen.length < n) { const q = pickFrom(f, cap); if (!q) break; take(q); }
    }
  }
  // Exam-like order: shuffled, so subjects and formats interleave.
  return r.shuffle(chosen).map((q, i) => ({ ...q, n: i + 1 }));
}
