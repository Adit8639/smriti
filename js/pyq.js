// Previous-year questions: statements written into a stem, what the question asks
// (correct or NOT correct), which statements the key makes true, and trap tags. All pure.
// A PYQ in the schema has a stem, options and an answer key; statements live inside the
// stem as numbered lines, so they are parsed here for statement-level marking.

const ROMAN = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6 };
const NUMBERED = /^\s*(?:(\d{1,2})|\(?(i{1,3}|iv|vi?|v)\)?)[.)]\s+(.+)$/i;
const STATEMENT_I = /^\s*statement[\s-]*(i{1,3}|\d)\s*[:.-]\s*(.+)$/i;

function statementLine(line) {
  let m = NUMBERED.exec(line);
  if (m) return m[1] ? { n: Number(m[1]), text: m[3].trim(), kind: 'arabic' } : { n: ROMAN[m[2].toLowerCase()], text: m[3].trim(), kind: 'roman' };
  m = STATEMENT_I.exec(line);
  if (m) return { n: /^\d$/.test(m[1]) ? Number(m[1]) : ROMAN[m[1].toLowerCase()], text: m[2].trim(), kind: 'statement' };
  return null;
}

// {intro, statements: [{n, text}], outro, numbering: 'arabic'|'roman'|'statement'} or null
// when the stem has fewer than two numbered statements in a row.
export function parseStatements(stem) {
  const lines = String(stem || '').split('\n');
  let found = [];
  let start = -1;
  let end = -1;
  let numbering = null;
  const begin = (i, hit) => { found = [{ n: hit.n, text: hit.text }]; start = i; end = i; numbering = hit.kind; };
  for (let i = 0; i < lines.length; i++) {
    const hit = statementLine(lines[i]);
    if (hit && found.length && hit.n === found.length + 1 && hit.kind === numbering) {
      found.push({ n: hit.n, text: hit.text });
      end = i;
      continue;
    }
    // A wrapped statement: a following line that starts in lower case.
    if (!hit && found.length && end === i - 1 && /^\s*[a-z(]/.test(lines[i])) {
      found[found.length - 1].text += ` ${lines[i].trim()}`;
      end = i;
      continue;
    }
    if (found.length >= 2) break;
    if (hit && hit.n === 1) begin(i, hit);
    else if (found.length) { found = []; start = -1; end = -1; numbering = null; }
  }
  if (found.length < 2) return null;
  return {
    intro: lines.slice(0, start).join('\n').trim(),
    statements: found,
    outro: lines.slice(end + 1).join('\n').trim(),
    numbering,
  };
}

const NEG = /\b(not\s+correct(?:ly)?|incorrect(?:ly)?|not\s+true|untrue|not\s+necessarily|not\s+(?:a|an|the)\b|is\s+not|are\s+not|wrong(?:ly)?|false|does\s+not|do\s+not|cannot\s+be|except)\b/i;

// 'positive' when the question asks for the correct statements, 'negative' for "NOT
// correct" and similar. A question line after the statements decides; a closing line that
// asks nothing ("Select the correct answer using the code…") defers to the intro.
export function polarity(parsed, stem = '') {
  if (!parsed) return NEG.test(stem) ? 'negative' : 'positive';
  const asks = /\?\s*$/.test(parsed.outro) ? parsed.outro : `${parsed.intro}\n${parsed.outro}`;
  return NEG.test(asks) ? 'negative' : 'positive';
}

const WORD_NUM = { one: 1, two: 2, three: 3, four: 4, five: 5 };

// Which statement numbers an option names: {set} for "1 and 3 only", "Both 1 and 2",
// "Neither 1 nor 2", "All of the above"; {count} for "Only two"; null when it names none.
export function optionSet(text, n, numbering = 'arabic') {
  const t = String(text || '').toLowerCase().replace(/[’']/g, '').replace(/\s+/g, ' ').trim();
  const all = new Set(Array.from({ length: n }, (_, i) => i + 1));
  let m = /^only (one|two|three|four|five)\b/.exec(t) || /^(one|two|three|four|five) only\b/.exec(t) || /^(?:exactly )?(one|two|three|four|five) (?:of the (?:above|statements|pairs)|statements?|pairs?)\b/.exec(t);
  if (m) return { count: WORD_NUM[m[1]] };
  if (/^all\b/.test(t) && !/\d/.test(t)) return { set: all };
  if (/^(none\b|neither\b)/.test(t)) return { set: new Set() };
  const nums = new Set();
  if (numbering === 'roman') {
    for (const r of t.matchAll(/\b(iv|vi|v|i{1,3})\b/g)) nums.add(ROMAN[r[1]]);
  } else {
    for (const d of t.matchAll(/\b(\d{1,2})\b/g)) nums.add(Number(d[1]));
  }
  if (!nums.size || [...nums].some((x) => x < 1 || x > n)) return null;
  return { set: nums };
}

// Statement-I / Statement-II options state each statement's truth in words.
export function assertionTruth(text) {
  const t = String(text || '').toLowerCase().replace(/\s+/g, ' ');
  const verdict = (s) => (/\b(incorrect|not correct|false|untrue|wrong)\b/.test(s) ? false : /\b(correct|true)\b/.test(s) ? true : null);
  if (/^both\b/.test(t)) {
    const v = verdict(t.split(/ and statement[\s-]*ii is| but /)[0] || t);
    return v === null ? null : [v, v];
  }
  const out = [null, null];
  for (const m of t.matchAll(/statement[\s-]*(ii|i|2|1)\b(.*?)(?=statement[\s-]*(?:ii|i|2|1)\b|$)/g)) {
    const idx = m[1] === 'i' || m[1] === '1' ? 0 : 1;
    if (out[idx] === null) out[idx] = verdict(m[2]);
  }
  return out.every((x) => x !== null) ? out : null;
}

// Statement index (0-based) a trap entry points to: a number (1-based) or the statement text.
function trapIndex(trap, statements) {
  if (Number.isInteger(trap.statement)) return trap.statement - 1;
  const want = String(trap.statement || '').toLowerCase().trim().slice(0, 50);
  if (!want) return -1;
  return statements.findIndex((s) => s.text.toLowerCase().includes(want) || want.includes(s.text.toLowerCase().slice(0, 50)));
}

// Per statement: true, false, or null when the key does not settle it. A trap tag marks a
// wrong statement; when tags and the key disagree, nothing is claimed.
export function inferTruth(q, parsed = parseStatements(q.stem)) {
  if (!parsed) return null;
  const n = parsed.statements.length;
  const unknown = Array(n).fill(null);
  const falseByTrap = new Set();
  for (const t of q.traps || []) {
    const i = trapIndex(t, parsed.statements);
    if (i >= 0 && i < n) falseByTrap.add(i);
  }
  const opt = Array.isArray(q.options) && Number.isInteger(q.answer) ? q.options[q.answer] : null;
  let truth = unknown.slice();
  if (q.format === 'assertionReason' || parsed.numbering === 'statement') {
    const at = n === 2 && opt != null ? assertionTruth(opt) : null;
    if (!at) return unknown;
    truth = at;
  } else {
    const sel = opt == null ? null : optionSet(opt, n, parsed.numbering);
    const neg = polarity(parsed) === 'negative';
    if (sel && sel.set) {
      truth = truth.map((_, i) => (neg ? !sel.set.has(i + 1) : sel.set.has(i + 1)));
    } else if (sel && Number.isInteger(sel.count)) {
      const trueCount = neg ? n - sel.count : sel.count;
      if (falseByTrap.size !== n - trueCount) return unknown;
      truth = truth.map((_, i) => !falseByTrap.has(i));
    } else {
      return falseByTrap.size ? truth.map((_, i) => (falseByTrap.has(i) ? false : null)) : unknown;
    }
  }
  for (const i of falseByTrap) if (truth[i] === true) return unknown;
  return truth;
}

export function trapTags(q, parsed = parseStatements(q.stem)) {
  const out = parsed ? Array(parsed.statements.length).fill(null) : [];
  for (const t of q.traps || []) {
    const i = parsed ? trapIndex(t, parsed.statements) : -1;
    if (i >= 0 && i < out.length) out[i] = t.tag;
  }
  return out;
}

// PYQ (or mock question) as a probe for the review player: numbered statements become
// markable rows, with their truth when the key settles it.
export function pyqProbe(q) {
  const parsed = parseStatements(q.stem);
  const truth = parsed ? inferTruth(q, parsed) : null;
  const tags = parsed ? trapTags(q, parsed) : [];
  return {
    id: `pyq:${q.id}`,
    format: 'pyq',
    atoms: q.atoms || [],
    stem: q.stem,
    options: q.options,
    answer: q.answer,
    explanation: q.elimination || '',
    difficulty: 2,
    pyq: q,
    statements: parsed ? parsed.statements.map((s, i) => ({ text: s.text, true: truth ? truth[i] : null, trap: tags[i] || null, reason: '' })) : null,
    parsed,
  };
}

// Which PYQs are real previous-year questions (not mock-pack questions) and which are Mains.
export const isMockItem = (q, packKinds) => !!(q && packKinds && packKinds.get(q._pack) === 'mock');
export const isDescriptive = (q, papers) => !!(papers && papers.get(q.paper) && papers.get(q.paper).type === 'descriptive');
