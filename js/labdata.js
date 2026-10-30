// Prelims Lab data work that runs in the data worker: the PYQ list with its filters, mock
// assembly and the projected-score bootstrap. Each takes the open database and the worker's
// rebuilt state.

import { profileContext } from './profiles.js';
import { quarantineStatus } from './rebuild.js';
import { pyqCounts, recencyWeights, rollUp, subjectOf as subjectOfIn, paperSubjects } from './weights.js';
import { buildMock } from './mockgen.js';
import { pyqProbe } from './pyq.js';
import { bandStats, attemptBands, marksFor, projectBand, expectedQuestions, BANDS } from './calib.js';

// PYQ-style formats: answers to these feed the projected score.
export const PYQ_STYLE = new Set(['statement', 'notCorrect', 'assertionReason', 'identify', 'odd', 'match', 'pyq', 'single', 'howMany']);

export async function nodeMaps(db) {
  const { starter, papers } = profileContext(await db.getAll('profiles'));
  const nodes = new Map(starter);
  for (const n of await db.getAll('nodes')) nodes.set(n.id, n);
  const parentOf = new Map([...nodes.values()].map((n) => [n.id, n.parent || null]));
  return { nodes, parentOf, papers, subjectOf: (id) => (id ? subjectOfIn(id, parentOf) : null) };
}

export async function packKinds(db) {
  return new Map((await db.getAll('packs')).map((p) => [p.id, p.kind]));
}

const usableAtom = (a, state) => {
  const q = quarantineStatus(a, state);
  const rec = state.atoms[a.id];
  return (q === 'clear' || q === 'approved') && !(rec && (rec.retired || rec.suspended));
};

// Real PYQs (not mock-pack questions) of objective papers, as compact rows plus facets.
export async function pyqList(db, state) {
  const kinds = await packKinds(db);
  const { papers, subjectOf, nodes } = await nodeMaps(db);
  const rows = [];
  const mains = [];
  for (const q of await db.getAll('pyqs')) {
    if (kinds.get(q._pack) === 'mock') continue;
    const paper = papers.get(q.paper);
    const st = state.pyqStats[q.id] || null;
    const base = { id: q.id, year: q.year, paper: q.paper, nodes: q.nodes || [], subject: subjectOf((q.nodes || [])[0]), stem: String(q.stem).slice(0, 220), n: st ? st.n : 0, right: st ? st.right : 0, lastOk: st ? st.lastOk : null };
    if (paper && paper.type === 'descriptive') mains.push({ ...base, directive: q.directive || null, marks: q.marks || null });
    else if (paper) rows.push({ ...base, format: q.format, answerSource: q.answerSource || null, statements: !!pyqProbe(q).statements });
  }
  rows.sort((a, b) => b.year - a.year || (a.id < b.id ? -1 : 1));
  const subjects = [...new Set(rows.map((r) => r.subject).filter(Boolean))].map((id) => ({ id, title: (nodes.get(id) || {}).title || id }));
  return { rows, mains, subjects };
}

export async function pyqsByIds(db, ids) {
  return (await Promise.all(ids.map((id) => db.get('pyqs', id)))).filter(Boolean);
}

// Subject weights for a paper: recency-weighted PYQ counts rolled up to subjects.
async function subjectWeights(db, paper, maps, kinds) {
  const pyqs = (await db.getAll('pyqs')).filter((q) => kinds.get(q._pack) !== 'mock');
  const packs = await db.getAll('packs');
  const byPack = new Map();
  for (const q of pyqs) {
    if (!byPack.has(q._pack)) byPack.set(q._pack, new Map());
    const m = byPack.get(q._pack);
    m.set(q.year, (m.get(q.year) || 0) + 1);
  }
  const pyqYears = new Map([...byPack].map(([id, m]) => [id, [...m].sort((a, b) => b[1] - a[1])[0][0]]));
  const counts = pyqCounts({ pyqs, nodes: maps.nodes, packs: packs.filter((p) => p.kind === 'pyq'), pyqYears, paperIds: new Set([paper.id]) });
  const { weights, maxYear } = recencyWeights(counts);
  return { node: weights, subject: rollUp(weights, maps.subjectOf), maxYear, pyqs };
}

// The subjects a paper covers that you have content for.
function contentSubjects(paper, maps, atoms, pyqs) {
  const { subjects } = paperSubjects(paper, maps.nodes);
  const inPaper = new Set(subjects);
  const have = new Set();
  for (const a of atoms) { const s = maps.subjectOf((a.nodes || [])[0]); if (s && (!inPaper.size || inPaper.has(s))) have.add(s); }
  for (const q of pyqs) { if (q.paper !== paper.id) continue; const s = maps.subjectOf((q.nodes || [])[0]); if (s) have.add(s); }
  return [...have];
}

// args: {n, seed, source: 'generated'|'pyq'|'pack', paper, year?, packId?, mix}
export async function mockQuestions(db, state, args) {
  const maps = await nodeMaps(db);
  const kinds = await packKinds(db);
  const paper = args.paper;
  if (args.source === 'pyq' || args.source === 'pack') {
    const all = await db.getAll('pyqs');
    const list = all.filter((q) => (args.source === 'pack' ? q._pack === args.packId : kinds.get(q._pack) !== 'mock' && q.year === args.year && q.paper === paper.id) && Array.isArray(q.options));
    list.sort((a, b) => (a._i ?? 0) - (b._i ?? 0) || (a.id < b.id ? -1 : 1));
    return list.map((q, i) => ({
      qid: `pyq:${q.id}`, kind: args.source === 'pack' ? 'mock' : 'pyq', format: q.format, stem: q.stem, options: q.options.slice(), answer: q.answer,
      explanation: q.elimination || '', nodes: q.nodes || [], atoms: q.atoms || [], subject: maps.subjectOf((q.nodes || [])[0]), traps: q.traps || [], year: q.year, answerSource: q.answerSource || null, n: i + 1,
    }));
  }
  const atoms = (await db.getAll('atoms')).filter((a) => usableAtom(a, state));
  const atomIds = new Set(atoms.map((a) => a.id));
  const probes = (await db.getAll('probes')).filter((p) => (p.atoms || []).every((id) => atomIds.has(id)));
  const w = await subjectWeights(db, paper, maps, kinds);
  const pyqs = w.pyqs.filter((q) => q.paper === paper.id && Array.isArray(q.options));
  const subjects = contentSubjects(paper, maps, atoms, pyqs);
  const expected = expectedQuestions(w.subject, subjects, args.n);
  return buildMock({ n: args.n, seed: args.seed, pyqs, probes, atoms, subjectOf: maps.subjectOf, mix: args.mix || undefined, expected });
}

// Objective answers that count for analytics: mock answers only once that mock's autopsy
// is done. Newest last; at most `limit`.
export function countedAnswers(state, limit = 300, filter = null) {
  const out = [];
  for (let i = state.objective.length - 1; i >= 0 && out.length < limit; i--) {
    const x = state.objective[i];
    if (x.m && !(state.mocks[x.m] && state.mocks[x.m].unlocked)) continue;
    if (filter && !filter(x)) continue;
    out.push(x);
  }
  return out.reverse();
}

// Projected paper score: per subject, expected questions × marks per question from your
// recent PYQ-style answers, under your attempt rule; a 10th–90th percentile bootstrap.
export async function projection(db, state, { paper }) {
  const maps = await nodeMaps(db);
  const kinds = await packKinds(db);
  const m = marksFor(paper);
  const answers = countedAnswers(state, 300, (x) => PYQ_STYLE.has(x.f));
  const atomCache = new Map();
  const pyqCache = new Map();
  const groups = new Map();
  for (const x of answers) {
    let s = x.s || null;
    if (!s && x.q) {
      if (!pyqCache.has(x.q)) pyqCache.set(x.q, await db.get('pyqs', x.q));
      const q = pyqCache.get(x.q);
      s = q ? maps.subjectOf((q.nodes || [])[0]) : null;
    }
    if (!s && x.a) {
      if (!atomCache.has(x.a)) atomCache.set(x.a, await db.get('atoms', x.a));
      const a = atomCache.get(x.a);
      s = a ? maps.subjectOf((a.nodes || [])[0]) : null;
    }
    const key = s || '(other)';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ c: x.c, ok: x.ok });
  }
  const stats = bandStats(answers, m);
  const attempt = attemptBands(stats);
  const w = await subjectWeights(db, paper, maps, kinds);
  const atoms = (await db.getAll('atoms')).filter((a) => usableAtom(a, state));
  const subjects = [...new Set([...contentSubjects(paper, maps, atoms, w.pyqs), ...[...groups.keys()].filter((k) => k !== '(other)')])];
  const expected = expectedQuestions(w.subject, subjects, paper.questions || 100);
  const band = answers.length >= 20 ? projectBand({ groups, expected, m, attempt, seed: `${state.count}` }) : null;
  const titles = Object.fromEntries(subjects.map((id) => [id, (maps.nodes.get(id) || {}).title || id]));
  const perSubject = subjects.map((id) => {
    const g = groups.get(id) || [];
    return { id, title: titles[id], expected: Math.round((expected.get(id) || 0) * 10) / 10, n: g.length, acc: g.length ? g.filter((x) => x.ok).length / g.length : null, weight: Math.round((w.subject.get(id) || 0) * 10) / 10 };
  }).sort((a, b) => b.expected - a.expected);
  return { band, n: answers.length, stats, attempt: BANDS.filter((b) => attempt.has(b)), perSubject, pyqYears: w.maxYear, marks: m };
}
