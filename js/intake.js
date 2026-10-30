// Offline intake: candidate facts from a PDF's text by rules, no AI. Sentences with Article,
// Schedule or Amendment numbers, years, percentages, money, the verbs that mark exam facts
// (launched, established, headquartered, ratified, signed, located…), rivers, protected
// areas and Ramsar sites, indices, reports and rankings, ministries and schemes. Each
// candidate gets a cloze target, is checked against existing atoms (token Jaccard ≥ 0.8
// counts as a duplicate) and gets topic suggestions by keyword. All pure.

import { tokens, clozeTargets, makeCloze, reflow } from './cloze.js';

export const DUP_JACCARD = 0.8;
export const RULES = [
  ['article', 'Article', 2, /\b(?:Article|Articles|Art\.)\s+\d+[A-Z]{0,2}\b/],
  ['amendment', 'Amendment', 2, /\b\d{1,3}(?:st|nd|rd|th)\s+(?:Constitutional\s+)?Amendment\b/i],
  ['schedule', 'Schedule or Part', 2, /\b(?:Schedule|Part)\s+[IVXL]+[A-Z]?\b|\b(?:First|Second|Third|Fourth|Fifth|Sixth|Seventh|Eighth|Ninth|Tenth|Eleventh|Twelfth)\s+Schedule\b/],
  ['year', 'Year', 1, /\b(?:1[6-9]\d{2}|20[0-4]\d)\b/],
  ['percent', 'Percentage', 1.5, /\b\d+(?:\.\d+)?\s?(?:%|per\s?cent)/i],
  ['money', 'Money', 1.5, /₹|\bRs\.?\s?\d|\b\d[\d,.]*\s?(?:crore|lakh|billion|million|trillion)\b/i],
  ['verb', 'Exam verb', 1.5, /\b(?:launched|established|headquartered|ratified|signed|located|set up|constituted|inaugurated|notified|enacted|came into force|instituted|founded|adopted|declared|designated|conferred|awarded)\b/i],
  ['river', 'River', 1, /\b[Rr]ivers?\b|\btributar(?:y|ies)\b|\bconfluence\b/],
  ['protected', 'Protected area', 2, /\b(?:National Park|Tiger Reserve|Wildlife Sanctuary|Biosphere Reserve|Ramsar|Elephant Reserve|Wetland|Bird Sanctuary|Geological Heritage)\b/i],
  ['index', 'Index, report or ranking', 1.5, /\b(?:Index|Report|Ranking|ranked|Survey|Outlook|Atlas)\b/],
  ['ministry', 'Ministry', 1, /\bMinistry of\b|\bDepartment of\b/],
  ['scheme', 'Scheme', 1.5, /\b(?:scheme|yojana|mission|abhiyan|programme|initiative)\b/i],
  ['body', 'Body', 1, /\b(?:Commission|Committee|Authority|Council|Board|Tribunal|Organisation|Organization|Agency)\b/],
];
const MIN_SCORE = 1.5;
const MIN_WORDS = 7;
const MAX_WORDS = 45;
const PER_PAGE = 14;

// Sentences of a page, splitting on . ? ! without breaking at common abbreviations.
const ABBR = /\b(?:No|Nos|Art|Arts|Dr|Mr|Mrs|Ms|St|Sr|Jr|Prof|Gen|Lt|Col|Govt|Dept|Rs|Ltd|Co|Corp|Inc|vs|viz|etc|i\.e|e\.g|U\.S|U\.K|U\.N|approx|est|fig|vol|pp|cf|al|Hon|Sec|Cl)\.$/i;
export function sentences(text) {
  const out = [];
  for (const para of reflow(text)) {
    let buf = '';
    const parts = para.split(/(?<=[.?!])\s+(?=[A-Z0-9“"(₹])/);
    for (const part of parts) {
      buf = buf ? `${buf} ${part}` : part;
      if (ABBR.test(buf.trim()) || /\b[A-Z]\.$/.test(buf.trim())) continue;
      out.push(buf.trim());
      buf = '';
    }
    if (buf.trim()) out.push(buf.trim());
  }
  return out;
}

export function scoreSentence(s) {
  const hits = [];
  let score = 0;
  for (const [id, , w, re] of RULES) if (re.test(s)) { hits.push(id); score += w; }
  return { score, hits };
}

// The best cloze target: the first exam-worthy one from cloze targets that the rules saw.
export function pickTarget(s, hits) {
  const targets = clozeTargets(s).filter((t) => t.text.length < s.length * 0.6 && makeCloze(s, t.text)
    // Long official names get cut by the name pattern ("Ministry of Environment, Forest…").
    && !(t.kind === 'name' && /^(?:Ministry|Department|Government|Office) of\b/.test(t.text)));
  if (!targets.length) return null;
  const prefer = hits.includes('amendment') ? 'amendment' : hits.includes('article') ? 'article' : hits.includes('schedule') ? 'schedule' : null;
  if (prefer) { const t = targets.find((x) => x.kind === prefer); if (t) return t; }
  // Counts, money, percentages and ranks are the fact in data-heavy sentences.
  if (hits.some((x) => ['percent', 'money', 'protected', 'index'].includes(x))) { const t = targets.find((x) => x.kind === 'number'); if (t) return t; }
  return targets[0];
}

const jaccard = (a, b) => {
  let n = 0;
  for (const x of a) if (b.has(x)) n++;
  return n / (a.size + b.size - n || 1);
};

// existing: [{id, text}] (atom text with the gap filled). Returns a dedupe checker.
export function dupIndex(existing) {
  const sets = existing.map((x) => new Set(tokens(x.text)));
  const inv = new Map();
  sets.forEach((s, i) => { for (const t of s) { if (!inv.has(t)) inv.set(t, []); inv.get(t).push(i); } });
  const seen = [];
  return {
    // The id of an existing atom (or earlier candidate) this text duplicates, or null.
    check(text, candId = null) {
      const A = new Set(tokens(text));
      if (A.size < 3) return null;
      const count = new Map();
      for (const t of A) for (const i of inv.get(t) || []) count.set(i, (count.get(i) || 0) + 1);
      for (const [i, c] of count) {
        if (c < A.size * DUP_JACCARD - 1e-9) continue;
        if (jaccard(A, sets[i]) >= DUP_JACCARD) return existing[i].id;
      }
      for (const s of seen) if (jaccard(A, s.set) >= DUP_JACCARD) return s.id;
      if (candId) seen.push({ id: candId, set: A });
      return null;
    },
  };
}

// Keyword topic suggestions: IDF-weighted overlap with each topic's keywords, title and
// description. nodes: [{id, title, keywords, description}].
export function keywordIndex(nodes) {
  const docs = nodes.map((n) => ({
    id: n.id,
    kw: new Set((n.keywords || []).flatMap((k) => tokens(k))),
    title: new Set(tokens(n.title || '')),
    desc: new Set(tokens(n.description || '')),
  }));
  const df = new Map();
  for (const d of docs) for (const t of new Set([...d.kw, ...d.title, ...d.desc])) df.set(t, (df.get(t) || 0) + 1);
  const N = docs.length || 1;
  const idf = (t) => Math.log(1 + N / (df.get(t) || N));
  return {
    suggest(text, top = 3) {
      const T = new Set(tokens(text));
      const scored = [];
      for (const d of docs) {
        let s = 0;
        for (const t of T) {
          if (d.kw.has(t)) s += 2 * idf(t);
          else if (d.title.has(t)) s += 1.5 * idf(t);
          else if (d.desc.has(t)) s += 0.6 * idf(t);
        }
        if (s > 0) scored.push({ nodeId: d.id, score: s });
      }
      scored.sort((a, b) => b.score - a.score || (a.nodeId < b.nodeId ? -1 : 1));
      const best = scored[0] ? scored[0].score : 1;
      return scored.slice(0, top).map((x) => ({ nodeId: x.nodeId, score: Math.round((x.score / best) * 100) / 100, by: 'keywords' }));
    },
  };
}

// texts: page texts (1-based pages from `from`). mapped(page) → node ids mapped to that page.
export function extractCandidates({ texts, from = 1, to = texts.length, existing = [], nodes = [], mapped = () => [], batchId = 'b' }) {
  const t0 = Date.now();
  const dups = dupIndex(existing);
  const kw = keywordIndex(nodes);
  const out = [];
  let scanned = 0;
  let duplicates = 0;
  for (let page = Math.max(1, from); page <= Math.min(texts.length, to); page++) {
    const found = [];
    for (const s of sentences(texts[page - 1] || '')) {
      scanned++;
      const words = s.split(/\s+/).length;
      if (words < MIN_WORDS || words > MAX_WORDS || /\?\s*$/.test(s) || /^(?:table|figure|fig\.|source|note)\b/i.test(s)) continue;
      const { score, hits } = scoreSentence(s);
      if (score < MIN_SCORE) continue;
      const target = pickTarget(s, hits);
      if (!target) continue;
      found.push({ s, score, hits, target });
    }
    found.sort((a, b) => b.score - a.score);
    for (const f of found.slice(0, PER_PAGE)) {
      const id = `${batchId}.${out.length + 1}`;
      const dupOf = dups.check(f.s, id);
      if (dupOf) { duplicates++; continue; }
      const prior = mapped(page).map((nodeId) => ({ nodeId, score: 1, by: 'page map' }));
      const sug = kw.suggest(f.s, 3).filter((x) => !prior.some((p) => p.nodeId === x.nodeId));
      out.push({ id, page, sentence: f.s, cloze: makeCloze(f.s, f.target.text), answer: f.target.text, targetKind: f.target.kind, hits: f.hits, score: f.score, nodes: [...prior, ...sug].slice(0, 3) });
    }
  }
  return { candidates: out, stats: { pages: Math.max(0, Math.min(texts.length, to) - Math.max(1, from) + 1), scanned, duplicates, ms: Date.now() - t0 } };
}

// Shelf life for a kept current-affairs fact: 900 days for annual reports and indices, else 540.
export const caShelfFor = (sentence) => (/\b(?:index|report|ranking|ranked|survey)\b/i.test(sentence) ? 900 : 540);
