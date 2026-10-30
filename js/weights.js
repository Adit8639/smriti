// PYQ weights per topic and subject. W(n) = Σ over years of the questions asked on n that
// year × 1.0 for the five most recent PYQ years and × 0.5 for older years. Counts come from
// installed PYQs, from a syllabus pack's pyqWeight {year: count}, and from a PYQ pack's
// report.nodeCounts; where they overlap for the same topic and year, the largest wins.
// All pure.

export const RECENT_YEARS = 5;

// pyqs: PYQ items (mock-pack questions already removed). nodes: Map id → node.
// packs: installed pack records; pyqYears: Map packId → year of that PYQ pack.
export function pyqCounts({ pyqs = [], nodes = new Map(), packs = [], pyqYears = new Map(), paperIds = null }) {
  const counts = new Map();
  const bump = (node, year, v, max = false) => {
    if (!node || !Number.isInteger(year)) return;
    if (!counts.has(node)) counts.set(node, new Map());
    const m = counts.get(node);
    m.set(year, max ? Math.max(m.get(year) || 0, v) : (m.get(year) || 0) + v);
  };
  const fromItems = new Map();
  for (const q of pyqs) {
    if (paperIds && !paperIds.has(q.paper)) continue;
    const ns = [...new Set(q.nodes || [])];
    for (const n of ns) {
      const key = `${n}|${q.year}`;
      fromItems.set(key, (fromItems.get(key) || 0) + 1 / ns.length);
    }
  }
  for (const [key, v] of fromItems) {
    const i = key.lastIndexOf('|');
    bump(key.slice(0, i), Number(key.slice(i + 1)), v, true);
  }
  for (const n of nodes.values()) {
    if (!n.pyqWeight) continue;
    for (const [y, c] of Object.entries(n.pyqWeight)) bump(n.id, Number(y), c, true);
  }
  for (const p of packs) {
    const nc = p && p.report && p.report.nodeCounts;
    const year = pyqYears.get(p.id);
    if (!nc || !year) continue;
    for (const [node, c] of Object.entries(nc)) if (Number.isFinite(c)) bump(node, year, c, true);
  }
  return counts;
}

export function recencyWeights(counts) {
  let maxYear = 0;
  for (const m of counts.values()) for (const y of m.keys()) if (y > maxYear) maxYear = y;
  const out = new Map();
  for (const [node, m] of counts) {
    let w = 0;
    for (const [y, c] of m) w += c * (y > maxYear - RECENT_YEARS ? 1 : 0.5);
    out.set(node, w);
  }
  return { weights: out, maxYear: maxYear || null };
}

// Ancestor chain from a root down to the node.
export function chainOf(id, parentOf) {
  const out = [];
  const seen = new Set();
  for (let cur = id; cur && !seen.has(cur); cur = parentOf.get(cur)) { out.unshift(cur); seen.add(cur); }
  return out;
}

// The subject of a topic: the node one level below its root (e.g. cse.gs2.polity).
export function subjectOf(id, parentOf) {
  const c = chainOf(id, parentOf);
  return c[1] || c[0] || null;
}

export function rollUp(weights, toSubject) {
  const out = new Map();
  for (const [n, w] of weights) {
    const s = toSubject(n);
    if (s) out.set(s, (out.get(s) || 0) + w);
  }
  return out;
}

// Subjects that belong to a paper: children of its syllabus roots (profile paper
// syllabusRoots, else root nodes whose paper is this paper).
export function paperSubjects(paper, nodes) {
  const roots = new Set(paper && Array.isArray(paper.syllabusRoots) ? paper.syllabusRoots : []);
  if (!roots.size) for (const n of nodes.values()) if (!n.parent && n.paper === (paper && paper.id)) roots.add(n.id);
  const out = [];
  for (const n of nodes.values()) if (n.parent && roots.has(n.parent)) out.push(n.id);
  return { roots, subjects: out };
}
