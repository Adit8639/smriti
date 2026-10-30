// Text helpers for recall: forgiving answer matching for typed clozes, and cloze-target
// suggestions (numbers, years, Article/Schedule/Amendment numbers, proper nouns).

const STOP = new Set(['the', 'a', 'an', 'of', 'to', 'in', 'on', 'and', 'or', 'by', 'for', 'is', 'are', 'was', 'its']);

export function normalize(s) {
  return String(s ?? '')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[’'`"“”]/g, '')
    .replace(/(\d)(st|nd|rd|th)\b/g, '$1')
    .replace(/[^a-z0-9ऀ-ॿ]+/g, ' ')
    .trim();
}

export const tokens = (s) => normalize(s).split(' ').filter((t) => t && !STOP.has(t));

export function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

// Typed answer vs expected answer: exact after normalising, same words in any order, or a
// small typo allowance that grows with length. Numbers must match exactly.
export function answerMatches(typed, answer) {
  const t = normalize(typed);
  const a = normalize(answer);
  if (!t || !a) return false;
  if (t === a) return true;
  const tt = tokens(t);
  const at = tokens(a);
  if (!at.length) return false;
  if (tt.length === at.length && tt.slice().sort().join(' ') === at.slice().sort().join(' ')) return true;
  if (/\d/.test(a) || /\d/.test(t)) {
    const nums = (x) => (x.match(/\d+/g) || []).join(',');
    if (nums(a) !== nums(t)) return false;
  }
  const allow = a.length >= 12 ? 2 : a.length >= 5 ? 1 : 0;
  if (allow && levenshtein(t, a) <= allow) return true;
  // Every expected content word present (each with at most one typo when long).
  return at.every((w) => tt.some((x) => x === w || (w.length > 4 && levenshtein(x, w) <= 1)));
}

// Overlap between two texts as a share of the smaller token set (0–1).
export function overlap(a, b) {
  const A = new Set(tokens(a));
  const B = new Set(tokens(b));
  if (!A.size || !B.size) return 0;
  let n = 0;
  for (const x of A) if (B.has(x)) n++;
  return n / Math.min(A.size, B.size);
}

const SENTENCE_START = new Set(['The', 'A', 'An', 'In', 'On', 'Under', 'It', 'This', 'These', 'Its', 'Both', 'Which', 'When', 'While', 'After', 'Before', 'During', 'As', 'At', 'By', 'For', 'From', 'If', 'Since', 'With']);

// Candidate gaps for a sentence, most exam-worthy first.
export function clozeTargets(text) {
  const out = [];
  const seen = new Set();
  const add = (t, kind) => {
    const v = t.trim().replace(/[.,;:]+$/, '');
    if (v.length < 2 || seen.has(v.toLowerCase())) return;
    seen.add(v.toLowerCase());
    out.push({ text: v, kind });
  };
  const s = String(text);
  for (const m of s.matchAll(/\b(\d{1,3}(?:st|nd|rd|th))\s+(?:Constitutional\s+)?Amendment\b/gi)) add(m[1], 'amendment');
  for (const m of s.matchAll(/\b(?:Article|Art\.|Articles)\s+(\d{1,3}[A-Z]{0,2}(?:\(\d+\))?)/g)) add(m[1], 'article');
  for (const m of s.matchAll(/\b(?:Schedule|Part)\s+([IVXL]+[A-Z]?|\d{1,2})\b/g)) add(m[1], 'schedule');
  for (const m of s.matchAll(/\b(1[0-9]{3}|20[0-9]{2})\b/g)) add(m[1], 'year');
  for (const m of s.matchAll(/(₹\s?[\d,.]+(?:\s*(?:lakh|crore|million|billion|trillion))*|\b\d[\d,.]*\s?(?:%|per cent|km|hectares?|(?:lakh|crore|million|billion|trillion)(?:\s+(?:lakh|crore|million|billion|trillion))*))/gi)) add(m[1].replace(/[.,]+$/, ''), 'number');
  for (const m of s.matchAll(/\b([A-Z][a-z]+(?:[\s-]+(?:of|the|and|for|on)?\s*[A-Z][a-zA-Z]+)+)\b/g)) {
    const words = m[1].split(/\s+/);
    if (words.length === 1 && SENTENCE_START.has(words[0])) continue;
    add(SENTENCE_START.has(words[0]) && words.length > 1 ? words.slice(1).join(' ') : m[1], 'name');
  }
  for (const m of s.matchAll(/\b(\d+)\b/g)) add(m[1], 'number');
  for (const m of s.matchAll(/(?:^|[^.]\s)([A-Z][a-z]{3,})\b/g)) if (!SENTENCE_START.has(m[1])) add(m[1], 'name');
  return out.slice(0, 10);
}

// Replaces the first occurrence of target with ___.
export function makeCloze(text, target) {
  const i = text.indexOf(target);
  if (i < 0) return null;
  return text.slice(0, i) + '___' + text.slice(i + target.length);
}

// Atom text with its gap filled, for checklists and reading views.
export const filled = (atom) => (/_{3,}/.test(atom.text) ? atom.text.replace(/_{3,}/, String(atom.answer)) : `${atom.text} — ${atom.answer}`);

// Rejoins a PDF page's text into paragraphs: PDF text breaks at every printed line, which
// reads badly on a narrow screen. Short lines (headings) and bullets keep their own line.
export function reflow(text) {
  const paras = [];
  let cur = '';
  let prevLen = 0;
  for (const raw of String(text || '').split('\n')) {
    const line = raw.trim();
    if (!line) { if (cur) paras.push(cur); cur = ''; continue; }
    if (!cur) { cur = line; prevLen = line.length; continue; }
    const bullet = /^([•▪●◦*\-–]|\(?[0-9ivx]{1,4}[.)])\s/i.test(line);
    const ended = /[.!?:;"”)]$/.test(cur);
    const lower = /^[a-z(,]/.test(line);
    const join = !bullet && (lower || (!ended && prevLen >= 40));
    prevLen = line.length;
    if (join) {
      cur = /[a-z]-$/.test(cur) && lower ? cur.slice(0, -1) + line : `${cur} ${line}`;
    } else {
      paras.push(cur);
      cur = line;
    }
  }
  if (cur) paras.push(cur);
  return paras;
}
