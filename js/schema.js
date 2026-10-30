// SMRITI SCHEMA v1 validator. Pure: returns precise, readable errors and warnings with
// JSON paths such as atoms[3].source.page. Errors reject the pack; warnings do not.

import { isObj, isIsoDate, wordCount, describeJsonError } from './util.js';

export const PACK_KINDS = ['syllabus', 'book', 'notes', 'pyq', 'ca', 'topper', 'mock', 'custom'];
export const ATOM_TYPES = ['fact', 'concept', 'list', 'date', 'compare', 'map', 'data', 'case', 'quote', 'valueadd'];
export const ORIGINS = ['source', 'model', 'rule', 'self'];
export const PROBE_FORMATS = ['cloze', 'tf', 'statement', 'notCorrect', 'match', 'order', 'odd', 'assertionReason', 'identify', 'explain'];
export const PYQ_FORMATS = ['statement', 'single', 'assertionReason', 'notCorrect', 'identify', 'match', 'howMany'];
export const ANSWER_SOURCES = ['official', 'coaching', 'unverified'];
export const TRAP_TAGS = ['number-swap', 'year-swap', 'institution-swap', 'scope-creep', 'cause-effect', 'chronology', 'near-name', 'location-swap', 'partial-truth'];
export const STAGES = ['prelims', 'mains'];
export const COLLECTIONS = ['nodes', 'atoms', 'probes', 'pyqs', 'ca', 'answers', 'notes'];
export const NOTE_CAPS = { 1: 300, 2: 150, 3: 60, 4: 12 };

const ALLOWED = {
  root: ['pack', ...COLLECTIONS],
  pack: ['id', 'version', 'kind', 'exam', 'title', 'createdAt', 'source', 'report'],
  source: ['title', 'edition', 'author', 'pages'],
  report: ['counts', 'doubts', 'unmapped', 'skipped', 'nodeCounts'],
  nodes: ['id', 'parent', 'paper', 'title', 'keywords', 'description', 'sharedWith', 'pyqWeight'],
  atoms: ['id', 'type', 'text', 'answer', 'nodes', 'source', 'origin', 'verify', 'confusables', 'stage', 'geo', 'eventDate', 'shelfLifeDays', 'mnemonic', 'note', 'tags'],
  atomSource: ['pack', 'page', 'pyq'],
  probes: ['id', 'atoms', 'format', 'stem', 'explanation', 'difficulty', 'statements', 'options', 'answer', 'pairs', 'items', 'keyPoints'],
  statements: ['text', 'true', 'trap', 'reason'],
  pyqs: ['id', 'year', 'paper', 'format', 'stem', 'options', 'answer', 'answerSource', 'nodes', 'atoms', 'traps', 'elimination', 'directive', 'marks', 'words', 'dimensions'],
  ca: ['id', 'date', 'headline', 'whyInNews', 'anchors', 'atoms', 'shelfLifeDays', 'mainsAngle', 'probableQs', 'connections'],
  answers: ['id', 'question', 'paper', 'marks', 'directive', 'skeleton', 'dimensions', 'valueAdds', 'source', 'diagrams', 'words', 'whyItScores', 'drills', 'topper'],
  notes: ['id', 'node', 'level', 'text', 'source'],
};

const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const NODE_ID = /^[a-z0-9][a-z0-9_-]*(?:\.[a-z0-9][a-z0-9_-]*)*$/;

const show = (v) => {
  if (v === undefined) return 'nothing';
  const s = JSON.stringify(v);
  return s.length > 48 ? s.slice(0, 45) + '…' : s;
};
const at = (p, k) => (p ? `${p}.${k}` : k);
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k) && o[k] !== undefined;
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

class Checker {
  constructor() {
    this.errors = [];
    this.warnings = [];
    this.unknown = new Map();
  }
  err(path, msg) { this.errors.push({ path, msg }); }
  warn(path, msg) { this.warnings.push({ path, msg }); }

  fields(o, p, group) {
    for (const k of Object.keys(o)) {
      if (ALLOWED[group].includes(k)) continue;
      if (k[0] === '_') { this.err(at(p, k), 'field names starting with "_" are reserved for the app'); continue; }
      const key = `${group}|${k}`;
      const u = this.unknown.get(key);
      if (u) u.count++;
      else this.unknown.set(key, { group, field: k, count: 1, first: at(p, k) });
    }
  }

  finishUnknown() {
    for (const u of this.unknown.values()) {
      const where = ['root', 'pack', 'source', 'report'].includes(u.group) ? u.first : `${u.first} (${u.count} item${u.count > 1 ? 's' : ''})`;
      this.warn(where, `unknown field "${u.field}" is not in the schema; check the spelling (it is kept but unused)`);
    }
  }

  need(o, k, p) {
    if (has(o, k)) return true;
    this.err(at(p, k), 'required field is missing');
    return false;
  }

  text(o, k, p, { required = true, allowEmpty = false } = {}) {
    if (!has(o, k)) { if (required) this.err(at(p, k), 'required field is missing'); return false; }
    const v = o[k];
    if (typeof v !== 'string') { this.err(at(p, k), `must be text (got ${show(v)})`); return false; }
    if (!allowEmpty && !v.trim()) { this.err(at(p, k), 'must not be empty'); return false; }
    return true;
  }

  int(o, k, p, { required = true, min = -Infinity, max = Infinity } = {}) {
    if (!has(o, k)) { if (required) this.err(at(p, k), 'required field is missing'); return false; }
    const v = o[k];
    if (!Number.isInteger(v)) { this.err(at(p, k), `must be a whole number (got ${show(v)})`); return false; }
    if (v < min || v > max) {
      this.err(at(p, k), max === Infinity ? `must be ${min} or more (got ${v})` : `must be between ${min} and ${max} (got ${v})`);
      return false;
    }
    return true;
  }

  bool(o, k, p, { required = true } = {}) {
    if (!has(o, k)) { if (required) this.err(at(p, k), 'required field is missing'); return false; }
    if (typeof o[k] !== 'boolean') { this.err(at(p, k), `must be true or false (got ${show(o[k])})`); return false; }
    return true;
  }

  oneOf(o, k, p, list, { required = true } = {}) {
    if (!has(o, k)) { if (required) this.err(at(p, k), `required field is missing (one of: ${list.join(', ')})`); return false; }
    if (!list.includes(o[k])) { this.err(at(p, k), `must be one of: ${list.join(', ')} (got ${show(o[k])})`); return false; }
    return true;
  }

  date(o, k, p, { required = true } = {}) {
    if (!has(o, k)) { if (required) this.err(at(p, k), 'required field is missing (YYYY-MM-DD)'); return false; }
    if (!isIsoDate(o[k])) { this.err(at(p, k), `must be a real date written YYYY-MM-DD (got ${show(o[k])})`); return false; }
    return true;
  }

  obj(o, k, p, { required = true } = {}) {
    if (!has(o, k)) { if (required) this.err(at(p, k), 'required field is missing'); return false; }
    if (!isObj(o[k])) { this.err(at(p, k), `must be an object {…} (got ${show(o[k])})`); return false; }
    return true;
  }

  // item: 'text' | (value, path) => void
  list(o, k, p, { required = true, min = 0, max = Infinity, item = null, what = 'items' } = {}) {
    if (!has(o, k)) { if (required) this.err(at(p, k), 'required field is missing'); return false; }
    const v = o[k];
    if (!Array.isArray(v)) { this.err(at(p, k), `must be a list […] (got ${show(v)})`); return false; }
    if (v.length < min || v.length > max) {
      const range = max === Infinity ? `at least ${min}` : min === max ? `exactly ${min}` : `${min}–${max}`;
      this.err(at(p, k), `needs ${range} ${what} (got ${v.length})`);
    }
    v.forEach((x, i) => {
      const ip = `${at(p, k)}[${i}]`;
      if (item === 'text') {
        if (typeof x !== 'string' || !x.trim()) this.err(ip, `must be non-empty text (got ${show(x)})`);
      } else if (item) item(x, ip);
    });
    return true;
  }
}

// ---------------------------------------------------------------- object validators

function checkNode(c, n, p, papers) {
  if (!isObj(n)) return c.err(p, 'must be an object');
  c.fields(n, p, 'nodes');
  if (c.text(n, 'id', p) && !NODE_ID.test(n.id)) c.err(at(p, 'id'), `must be a dotted path of lowercase words, e.g. "cse.gs2.polity.parliament" (got ${show(n.id)})`);
  if (!has(n, 'parent')) c.err(at(p, 'parent'), 'required field is missing (use null for a top-level node)');
  else if (n.parent !== null) {
    if (typeof n.parent !== 'string' || !NODE_ID.test(n.parent)) c.err(at(p, 'parent'), `must be a node id or null (got ${show(n.parent)})`);
    else if (n.parent === n.id) c.err(at(p, 'parent'), 'a node cannot be its own parent');
  }
  if (c.text(n, 'paper', p) && papers && !papers.has(n.paper)) c.err(at(p, 'paper'), `unknown paper ${show(n.paper)}; known papers: ${[...papers.keys ? papers.keys() : papers].join(', ')}`);
  c.text(n, 'title', p);
  if (c.list(n, 'keywords', p, { item: 'text', what: 'keywords' }) && n.keywords.length === 0) c.warn(at(p, 'keywords'), 'no keywords: search and node suggestions will be weak');
  if (c.text(n, 'description', p, { allowEmpty: true }) && !n.description.trim()) c.warn(at(p, 'description'), 'empty description');
  c.list(n, 'sharedWith', p, { required: false, item: 'text' });
  if (c.obj(n, 'pyqWeight', p, { required: false })) {
    for (const [y, cnt] of Object.entries(n.pyqWeight)) {
      if (!/^\d{4}$/.test(y)) c.err(at(at(p, 'pyqWeight'), y), 'keys must be 4-digit years');
      else if (!Number.isInteger(cnt) || cnt < 0) c.err(at(at(p, 'pyqWeight'), y), `must be a whole number ≥ 0 (got ${show(cnt)})`);
    }
  }
}

// Used by profile validation too: checks a node list and its internal parent links.
export function validateNodeList(list, path, paperIds) {
  const c = new Checker();
  const ids = new Map();
  list.forEach((n, i) => {
    checkNode(c, n, `${path}[${i}]`, paperIds);
    if (isObj(n) && typeof n.id === 'string') {
      if (ids.has(n.id)) c.err(`${path}[${i}].id`, `duplicate id "${n.id}" (also ${ids.get(n.id)})`);
      else ids.set(n.id, `${path}[${i}]`);
    }
  });
  list.forEach((n, i) => {
    if (isObj(n) && typeof n.parent === 'string' && !ids.has(n.parent)) c.err(`${path}[${i}].parent`, `parent "${n.parent}" is not in this list`);
  });
  return c.errors;
}

function checkAtom(c, a, p, packId) {
  if (!isObj(a)) return c.err(p, 'must be an object');
  c.fields(a, p, 'atoms');
  if (c.text(a, 'id', p) && packId && !new RegExp(`^${escapeRe(packId)}\\.\\d{4}$`).test(a.id)) {
    c.err(at(p, 'id'), `must be "<packId>.<4 digits>", e.g. "${packId}.0001" (got ${show(a.id)})`);
  }
  c.oneOf(a, 'type', p, ATOM_TYPES);
  if (c.text(a, 'text', p) && wordCount(a.text) > 35) c.warn(at(p, 'text'), `${wordCount(a.text)} words; atoms should be 35 words or fewer`);
  if (!has(a, 'answer')) c.err(at(p, 'answer'), 'required field is missing');
  else if (!((typeof a.answer === 'string' && a.answer.trim()) || typeof a.answer === 'number')) c.err(at(p, 'answer'), `must be non-empty text (got ${show(a.answer)})`);
  c.list(a, 'nodes', p, { min: 1, max: 3, item: 'text', what: 'node ids' });
  c.oneOf(a, 'origin', p, ORIGINS);
  c.bool(a, 'verify', p);
  if (c.obj(a, 'source', p)) {
    const s = a.source;
    const sp = at(p, 'source');
    c.fields(s, sp, 'atomSource');
    if (has(s, 'pyq')) {
      c.text(s, 'pyq', sp);
    } else if (!has(s, 'pack')) {
      c.err(sp, 'must be {"pack": "<pack id>", "page": <page>} or {"pyq": "<pyq id>"}');
    } else {
      c.text(s, 'pack', sp);
      if (!has(s, 'page')) {
        if (a.origin !== 'model') c.err(at(sp, 'page'), 'required field is missing (every atom needs its source page unless origin is "model")');
      } else if (!((Number.isInteger(s.page) && s.page >= 1) || (typeof s.page === 'string' && s.page.trim()))) {
        c.err(at(sp, 'page'), `must be a page number ≥ 1 or a page label like "xii" (got ${show(s.page)})`);
      }
    }
  }
  c.list(a, 'confusables', p, { required: false, item: 'text', what: 'atom ids' });
  c.list(a, 'stage', p, { required: false, item: (v, ip) => { if (!STAGES.includes(v)) c.err(ip, `must be "prelims" or "mains" (got ${show(v)})`); } });
  if (c.obj(a, 'geo', p, { required: false })) {
    const g = a.geo;
    const gp = at(p, 'geo');
    if (typeof g.lat !== 'number' || g.lat < -90 || g.lat > 90) c.err(at(gp, 'lat'), `must be a latitude from -90 to 90 (got ${show(g.lat)})`);
    if (typeof g.lon !== 'number' || g.lon < -180 || g.lon > 180) c.err(at(gp, 'lon'), `must be a longitude from -180 to 180 (got ${show(g.lon)})`);
  }
  c.date(a, 'eventDate', p, { required: false });
  c.int(a, 'shelfLifeDays', p, { required: false, min: 1 });
  c.text(a, 'mnemonic', p, { required: false });
  c.text(a, 'note', p, { required: false, allowEmpty: true });
  c.list(a, 'tags', p, { required: false, item: 'text' });
}

function checkStatements(c, o, p, { required, min, max }) {
  if (!has(o, 'statements')) { if (required) c.err(at(p, 'statements'), 'required field is missing'); return; }
  const v = o.statements;
  if (!Array.isArray(v)) return c.err(at(p, 'statements'), `must be a list of {text, true, trap, reason} (got ${show(v)})`);
  if (v.length < min || v.length > max) {
    c.err(at(p, 'statements'), min === max ? `needs exactly ${min} statement${min > 1 ? 's' : ''} (got ${v.length})` : `statement sets need ${min}–${max} statements (got ${v.length})`);
  }
  v.forEach((s, i) => {
    const sp = `${at(p, 'statements')}[${i}]`;
    if (!isObj(s)) return c.err(sp, 'must be an object {text, true, trap, reason}');
    c.fields(s, sp, 'statements');
    c.text(s, 'text', sp);
    c.bool(s, 'true', sp);
    if (has(s, 'trap') && s.trap !== null) {
      if (!TRAP_TAGS.includes(s.trap)) c.err(at(sp, 'trap'), `unknown trap tag ${show(s.trap)}; use null or one of: ${TRAP_TAGS.join(', ')}`);
      else if (s.true === true) c.warn(at(sp, 'trap'), 'a true statement carries a trap tag');
    } else if (s.true === false) {
      c.warn(at(sp, 'trap'), 'a false statement should name its trap tag');
    }
    if (!has(s, 'reason')) c.warn(at(sp, 'reason'), 'missing the one-line reason');
    else c.text(s, 'reason', sp, { allowEmpty: true });
  });
}

function checkOptions(c, o, p, { required }) {
  const hasOpts = has(o, 'options');
  if (!hasOpts) {
    if (required) c.err(at(p, 'options'), 'required field is missing (4 options)');
  } else if (!Array.isArray(o.options) || o.options.length !== 4 || o.options.some((x) => typeof x !== 'string' || !x.trim())) {
    c.err(at(p, 'options'), `needs exactly 4 non-empty text options (got ${Array.isArray(o.options) ? o.options.length : show(o.options)})`);
  }
  if (!has(o, 'answer')) {
    if (required || hasOpts) c.err(at(p, 'answer'), 'required field is missing (the correct option index, counting from 0)');
  } else if (!Number.isInteger(o.answer) || o.answer < 0 || o.answer > 3) {
    c.err(at(p, 'answer'), `must be the correct option index 0–3 (got ${show(o.answer)})`);
  }
}

function checkProbe(c, q, p) {
  if (!isObj(q)) return c.err(p, 'must be an object');
  c.fields(q, p, 'probes');
  c.text(q, 'id', p);
  c.list(q, 'atoms', p, { min: 1, item: 'text', what: 'atom ids' });
  const fmtOk = c.oneOf(q, 'format', p, PROBE_FORMATS);
  c.text(q, 'stem', p);
  c.text(q, 'explanation', p);
  c.int(q, 'difficulty', p, { min: 1, max: 3 });
  if (!fmtOk) return;
  switch (q.format) {
    case 'cloze':
      if (typeof q.stem === 'string' && !q.stem.includes('___')) c.err(at(p, 'stem'), 'a cloze stem must contain ___ where the gap is');
      if (!has(q, 'answer')) c.err(at(p, 'answer'), 'required field is missing (the text that fills ___)');
      else if (!((typeof q.answer === 'string' && q.answer.trim()) || typeof q.answer === 'number')) c.err(at(p, 'answer'), `must be the gap text (got ${show(q.answer)})`);
      break;
    case 'tf':
      if (has(q, 'statements')) checkStatements(c, q, p, { required: true, min: 1, max: 4 });
      else if (typeof q.answer !== 'boolean') c.err(at(p, 'statements'), 'a true/false probe needs "statements" [{text, true, trap, reason}] (or a stem with "answer": true/false)');
      break;
    case 'statement':
      checkStatements(c, q, p, { required: true, min: 2, max: 4 });
      checkOptions(c, q, p, { required: true });
      break;
    case 'notCorrect':
      if (has(q, 'statements')) checkStatements(c, q, p, { required: false, min: 2, max: 4 });
      checkOptions(c, q, p, { required: true });
      break;
    case 'assertionReason':
      checkStatements(c, q, p, { required: true, min: 2, max: 2 });
      checkOptions(c, q, p, { required: true });
      break;
    case 'odd':
    case 'identify':
      checkOptions(c, q, p, { required: true });
      break;
    case 'match':
      c.list(q, 'pairs', p, {
        min: 3, max: 4, what: 'pairs',
        item: (v, ip) => {
          if (!Array.isArray(v) || v.length !== 2 || v.some((x) => typeof x !== 'string' || !x.trim())) c.err(ip, `each pair must be ["left", "right"] (got ${show(v)})`);
        },
      });
      if (has(q, 'options')) checkOptions(c, q, p, { required: false });
      break;
    case 'order':
      if (c.list(q, 'items', p, { min: 3, item: 'text', what: 'items' }) && new Set(q.items).size !== q.items.length) c.err(at(p, 'items'), 'items must all be different');
      break;
    case 'explain':
      c.list(q, 'keyPoints', p, { min: 1, item: 'text', what: 'key points' });
      break;
    default:
      break;
  }
}

function checkPyq(c, q, p, papers) {
  if (!isObj(q)) return c.err(p, 'must be an object');
  c.fields(q, p, 'pyqs');
  c.text(q, 'id', p);
  c.int(q, 'year', p, { min: 1979, max: 2100 });
  let type = null;
  if (c.text(q, 'paper', p)) {
    const paper = papers && papers.get(q.paper);
    if (papers && !paper) c.err(at(p, 'paper'), `unknown paper ${show(q.paper)}; known papers: ${[...papers.keys()].join(', ')}`);
    else type = paper ? paper.type : null;
  }
  c.text(q, 'stem', p);
  c.list(q, 'nodes', p, { item: 'text', what: 'node ids' });
  if (Array.isArray(q.nodes) && q.nodes.length === 0) c.warn(at(p, 'nodes'), 'not mapped to any node');
  if (type === 'descriptive') {
    c.text(q, 'directive', p);
    c.int(q, 'marks', p, { min: 1 });
    c.int(q, 'words', p, { min: 1 });
    c.list(q, 'dimensions', p, { item: 'text' });
    c.oneOf(q, 'answerSource', p, ANSWER_SOURCES, { required: false });
    c.list(q, 'atoms', p, { required: false, item: 'text' });
    return;
  }
  if (type !== 'mcq') return;
  c.oneOf(q, 'format', p, PYQ_FORMATS);
  checkOptions(c, q, p, { required: true });
  c.oneOf(q, 'answerSource', p, ANSWER_SOURCES);
  c.list(q, 'atoms', p, { item: 'text', what: 'atom ids' });
  c.list(q, 'traps', p, {
    what: 'traps',
    item: (v, ip) => {
      if (!isObj(v)) return c.err(ip, 'must be {statement, tag}');
      if (!((typeof v.statement === 'string' && v.statement.trim()) || Number.isInteger(v.statement))) c.err(`${ip}.statement`, `must be the statement text or its number (got ${show(v.statement)})`);
      if (!TRAP_TAGS.includes(v.tag)) c.err(`${ip}.tag`, `unknown trap tag ${show(v.tag)}; use one of: ${TRAP_TAGS.join(', ')}`);
    },
  });
  c.text(q, 'elimination', p);
}

function checkCa(c, x, p) {
  if (!isObj(x)) return c.err(p, 'must be an object');
  c.fields(x, p, 'ca');
  c.text(x, 'id', p);
  c.date(x, 'date', p);
  c.text(x, 'headline', p);
  if (c.text(x, 'whyInNews', p) && wordCount(x.whyInNews) > 30) c.warn(at(p, 'whyInNews'), `${wordCount(x.whyInNews)} words; keep "why in news" to 30 or fewer`);
  c.list(x, 'anchors', p, { min: 1, item: 'text', what: 'static anchor node ids' });
  c.list(x, 'atoms', p, { item: 'text', what: 'atom ids' });
  c.int(x, 'shelfLifeDays', p, { min: 1 });
  c.list(x, 'mainsAngle', p, { required: false, item: 'text' });
  c.list(x, 'probableQs', p, {
    required: false,
    item: (v, ip) => {
      if (!isObj(v)) return c.err(ip, 'must be {stage, text}');
      if (!STAGES.includes(v.stage)) c.err(`${ip}.stage`, `must be "prelims" or "mains" (got ${show(v.stage)})`);
      if (typeof v.text !== 'string' || !v.text.trim()) c.err(`${ip}.text`, 'must be non-empty text');
    },
  });
  c.list(x, 'connections', p, { required: false, item: 'text' });
}

function checkAnswer(c, a, p, papers) {
  if (!isObj(a)) return c.err(p, 'must be an object');
  c.fields(a, p, 'answers');
  c.text(a, 'id', p);
  c.text(a, 'question', p);
  if (c.text(a, 'paper', p) && papers) {
    const paper = papers.get(a.paper);
    if (!paper) c.err(at(p, 'paper'), `unknown paper ${show(a.paper)}; known papers: ${[...papers.keys()].join(', ')}`);
    else if (paper.type !== 'descriptive') c.warn(at(p, 'paper'), `${a.paper} is an objective paper; model answers usually belong to descriptive papers`);
  }
  c.int(a, 'marks', p, { min: 1 });
  c.text(a, 'directive', p);
  if (c.obj(a, 'skeleton', p)) {
    const sp = at(p, 'skeleton');
    c.text(a.skeleton, 'intro', sp);
    c.list(a.skeleton, 'body', sp, { min: 1, item: 'text', what: 'body headings' });
    c.text(a.skeleton, 'conclusion', sp);
  }
  c.list(a, 'dimensions', p, { item: 'text' });
  c.list(a, 'valueAdds', p, {
    item: (v, ip) => {
      if (!isObj(v)) return c.err(ip, 'must be {type, text}');
      if (typeof v.type !== 'string' || !v.type.trim()) c.err(`${ip}.type`, 'required text');
      if (typeof v.text !== 'string' || !v.text.trim()) c.err(`${ip}.text`, 'required text');
    },
  });
  if (c.obj(a, 'source', p)) {
    const sp = at(p, 'source');
    c.text(a.source, 'pack', sp);
    if (!has(a.source, 'page')) c.err(at(sp, 'page'), 'required field is missing');
    else if (!((Number.isInteger(a.source.page) && a.source.page >= 1) || (typeof a.source.page === 'string' && a.source.page.trim()))) c.err(at(sp, 'page'), `must be a page number ≥ 1 or a page label (got ${show(a.source.page)})`);
  }
  c.list(a, 'diagrams', p, { required: false, item: 'text' });
  c.int(a, 'words', p, { required: false, min: 1 });
  c.list(a, 'whyItScores', p, { required: false, item: 'text' });
  c.list(a, 'drills', p, {
    required: false,
    item: (v, ip) => {
      if (!isObj(v)) return c.err(ip, 'must be {question, hiddenSkeleton}');
      if (typeof v.question !== 'string' || !v.question.trim()) c.err(`${ip}.question`, 'required text');
      if (!has(v, 'hiddenSkeleton')) c.err(`${ip}.hiddenSkeleton`, 'required field is missing');
    },
  });
  if (c.obj(a, 'topper', p, { required: false })) {
    const tp = at(p, 'topper');
    c.text(a.topper, 'name', tp);
    if (has(a.topper, 'rank') && !Number.isInteger(a.topper.rank)) c.err(at(tp, 'rank'), 'must be a whole number');
    if (has(a.topper, 'year') && !Number.isInteger(a.topper.year)) c.err(at(tp, 'year'), 'must be a whole number');
  }
}

function checkNote(c, n, p) {
  if (!isObj(n)) return c.err(p, 'must be an object');
  c.fields(n, p, 'notes');
  c.text(n, 'id', p, { required: false });
  c.text(n, 'node', p);
  const lvlOk = c.int(n, 'level', p, { min: 1, max: 4 });
  if (c.text(n, 'text', p) && lvlOk) {
    const cap = NOTE_CAPS[n.level];
    const size = n.level === 4 ? n.text.split(/[,;\n]+/).map((s) => s.trim()).filter(Boolean).length : wordCount(n.text);
    if (size > cap) c.warn(at(p, 'text'), `level ${n.level} is capped at ${cap} ${n.level === 4 ? 'keywords' : 'words'} (has ${size})`);
  }
  if (!has(n, 'source')) c.err(at(p, 'source'), 'required field is missing');
  else if (!(isObj(n.source) || (typeof n.source === 'string' && n.source.trim()))) c.err(at(p, 'source'), `must be {pack, page} or text (got ${show(n.source)})`);
}

// ---------------------------------------------------------------- pack

export function parsePackText(text) {
  try {
    return { value: JSON.parse(text) };
  } catch (e) {
    return { error: `Not valid JSON — ${describeJsonError(e, text)}` };
  }
}

const noteId = (packId, n) => `${packId}.note.${n.node}.${n.level}`;

// ctx: {papers: Map paperId -> paper, exams: Set}
// Returns {packId, version, kind, title, errors, warnings, pack, items: {collection: [...]}}
export function validatePack(raw, ctx = {}) {
  const c = new Checker();
  const out = { packId: null, version: null, kind: null, title: null, errors: c.errors, warnings: c.warnings, pack: null, items: {} };
  if (!isObj(raw)) {
    c.err('(file)', 'a pack must be one JSON object: { "pack": {…}, "nodes": […], "atoms": […], … }');
    return out;
  }
  if (raw.format === 'smriti-backup') {
    c.err('(file)', 'this is a SMRITI backup file, not a content pack; use Backup → Import backup instead');
    return out;
  }
  c.fields(raw, '', 'root');

  if (c.obj(raw, 'pack', '')) {
    const pk = raw.pack;
    c.fields(pk, 'pack', 'pack');
    if (c.text(pk, 'id', 'pack') && !KEBAB.test(pk.id)) c.err('pack.id', `must be kebab-case: lowercase letters and digits joined by hyphens (got ${show(pk.id)})`);
    c.int(pk, 'version', 'pack', { min: 1 });
    c.oneOf(pk, 'kind', 'pack', PACK_KINDS);
    if (c.list(pk, 'exam', 'pack', { min: 1, item: 'text', what: 'exam ids' }) && ctx.exams) {
      pk.exam.forEach((x, i) => { if (typeof x === 'string' && !ctx.exams.has(x)) c.warn(`pack.exam[${i}]`, `no installed profile uses exam "${x}"`); });
    }
    c.text(pk, 'title', 'pack');
    c.date(pk, 'createdAt', 'pack');
    if (c.obj(pk, 'source', 'pack')) {
      c.fields(pk.source, 'pack.source', 'source');
      c.text(pk.source, 'title', 'pack.source');
      c.text(pk.source, 'edition', 'pack.source', { required: false });
      c.text(pk.source, 'author', 'pack.source', { required: false });
      if (has(pk.source, 'pages') && !(typeof pk.source.pages === 'string' || Number.isInteger(pk.source.pages))) c.err('pack.source.pages', `must be text like "1-40" or a number (got ${show(pk.source.pages)})`);
    }
    if (c.obj(pk, 'report', 'pack')) {
      const r = pk.report;
      c.fields(r, 'pack.report', 'report');
      c.obj(r, 'counts', 'pack.report', { required: false });
      c.obj(r, 'nodeCounts', 'pack.report', { required: false });
      for (const k of ['doubts', 'unmapped', 'skipped']) c.list(r, k, 'pack.report', { required: false });
    }
    out.packId = typeof pk.id === 'string' ? pk.id : null;
    out.version = Number.isInteger(pk.version) ? pk.version : null;
    out.kind = pk.kind;
    out.title = typeof pk.title === 'string' ? pk.title : null;
    out.pack = pk;
  }

  const packId = out.packId && KEBAB.test(out.packId) ? out.packId : null;
  const papers = ctx.papers || null;
  const checkers = {
    nodes: (x, p) => checkNode(c, x, p, papers),
    atoms: (x, p) => checkAtom(c, x, p, packId),
    probes: (x, p) => checkProbe(c, x, p),
    pyqs: (x, p) => checkPyq(c, x, p, papers),
    ca: (x, p) => checkCa(c, x, p),
    answers: (x, p) => checkAnswer(c, x, p, papers),
    notes: (x, p) => checkNote(c, x, p),
  };

  for (const coll of COLLECTIONS) {
    if (!has(raw, coll)) { out.items[coll] = []; continue; }
    const list = raw[coll];
    if (!Array.isArray(list)) {
      c.err(coll, `must be a list […] (got ${show(list)})`);
      out.items[coll] = [];
      continue;
    }
    const seen = new Map();
    const items = [];
    list.forEach((x, i) => {
      const p = `${coll}[${i}]`;
      checkers[coll](x, p);
      if (!isObj(x)) return;
      const item = coll === 'notes' && !has(x, 'id') && packId ? { id: noteId(packId, x), ...x } : x;
      if (typeof item.id === 'string') {
        if (seen.has(item.id)) {
          c.err(`${p}${coll === 'notes' && !has(x, 'id') ? '' : '.id'}`, coll === 'notes' && !has(x, 'id')
            ? `a second level-${x.level} note for node "${x.node}" (also ${seen.get(item.id)})`
            : `duplicate id "${item.id}" (also ${seen.get(item.id)})`);
        } else seen.set(item.id, p);
      }
      items.push(item);
    });
    out.items[coll] = items;
  }

  // A count mismatch often means the Forge output was cut off.
  const counts = out.pack && isObj(out.pack.report) && isObj(out.pack.report.counts) ? out.pack.report.counts : null;
  if (counts) {
    for (const coll of COLLECTIONS) {
      if (!has(counts, coll)) continue;
      const actual = Array.isArray(raw[coll]) ? raw[coll].length : 0;
      if (counts[coll] !== actual) c.warn(`pack.report.counts.${coll}`, `says ${show(counts[coll])} but the file has ${actual}; the pack may be truncated`);
    }
  }

  c.finishUnknown();
  return out;
}

// Reference checks against everything that will exist after the import.
// known: {nodes: Set, nodeParents: Map, atoms: Set, pyqs: Set, ca: Set, packs: Set}
// Unresolved references are warnings; the item imports and is marked orphaned.
export function checkReferences(entry, known) {
  const warnings = [];
  const errors = [];
  const orphanIds = new Set();
  const w = (coll, i, field, kind, ref, id) => {
    warnings.push({ path: `${coll}[${i}].${field}`, msg: `${kind} "${ref}" is not in this pack or installed content; the item will be marked orphaned` });
    if (id) orphanIds.add(`${coll}:${id}`);
  };
  const each = (coll, fn) => (entry.items[coll] || []).forEach((x, i) => fn(x, i));
  const refs = (coll, i, x, field, set, kind) => {
    if (!Array.isArray(x[field])) return;
    x[field].forEach((r, j) => { if (typeof r === 'string' && !set.has(r)) w(coll, i, `${field}[${j}]`, kind, r, x.id); });
  };

  each('nodes', (n, i) => {
    if (typeof n.parent === 'string' && !known.nodes.has(n.parent)) w('nodes', i, 'parent', 'parent node', n.parent, n.id);
    // Cycle check through the full parent map.
    const seen = new Set([n.id]);
    let cur = n.parent;
    while (typeof cur === 'string') {
      if (seen.has(cur)) { errors.push({ path: `nodes[${i}].parent`, msg: `parent chain loops back to "${cur}"` }); break; }
      seen.add(cur);
      cur = known.nodeParents.get(cur);
    }
  });
  each('atoms', (a, i) => {
    refs('atoms', i, a, 'nodes', known.nodes, 'node');
    refs('atoms', i, a, 'confusables', known.atoms, 'confusable atom');
    if (isObj(a.source)) {
      if (typeof a.source.pyq === 'string' && !known.pyqs.has(a.source.pyq)) w('atoms', i, 'source.pyq', 'PYQ', a.source.pyq, a.id);
      if (typeof a.source.pack === 'string' && !known.packs.has(a.source.pack)) w('atoms', i, 'source.pack', 'source pack', a.source.pack, a.id);
    }
  });
  each('probes', (q, i) => refs('probes', i, q, 'atoms', known.atoms, 'atom'));
  each('pyqs', (q, i) => {
    refs('pyqs', i, q, 'nodes', known.nodes, 'node');
    refs('pyqs', i, q, 'atoms', known.atoms, 'atom');
  });
  each('ca', (x, i) => {
    refs('ca', i, x, 'anchors', known.nodes, 'anchor node');
    refs('ca', i, x, 'atoms', known.atoms, 'atom');
    refs('ca', i, x, 'connections', known.ca, 'CA item');
  });
  each('answers', (a, i) => {
    if (isObj(a.source) && typeof a.source.pack === 'string' && !known.packs.has(a.source.pack)) w('answers', i, 'source.pack', 'source pack', a.source.pack, a.id);
  });
  each('notes', (n, i) => {
    if (typeof n.node === 'string' && !known.nodes.has(n.node)) w('notes', i, 'node', 'node', n.node, n.id);
  });
  return { warnings, errors, orphans: orphanIds.size };
}
