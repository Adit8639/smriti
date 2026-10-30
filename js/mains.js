// Mains Studio data and helpers: the directive decoder, the dimension wheel, value-add
// categories, the self-scoring rubric, the Shadow Writing diff, précis targets and the
// question pool. Everything here is answer-writing guidance, not study content. All pure.

import { tokens, overlap } from './cloze.js';
import { wordCount } from './util.js';

// The twelve directives: what each asks for, the structure it expects, the one-line check
// an answer must pass, and answer patterns for the "which directive is this?" drill.
export const DIRECTIVES = [
  {
    id: 'discuss', name: 'Discuss',
    asks: 'Bring out the various aspects of the issue, with arguments for and against where they exist.',
    structure: ['Intro: context or definition', 'Body: several dimensions, each with points for and against', 'Conclusion: a balanced view'],
    check: 'Does it cover several dimensions, not just one side?',
    patterns: ['Covers the social, economic and political sides of the issue, with points for and against, and ends with a balanced view.', 'Walks through four aspects of the reform, noting both the gains and the concerns under each, and closes evenly.'],
    near: ['examine', 'analyse', 'critically'],
  },
  {
    id: 'examine', name: 'Examine',
    asks: 'Probe the issue in depth: its causes, implications and the evidence behind them.',
    structure: ['Intro: the issue in one line', 'Body: break it into parts and investigate each with facts', 'Conclusion: the implication that follows'],
    check: 'Does it look into causes and consequences with evidence, beyond describing?',
    patterns: ['Investigates why the problem arose and what follows from it, testing each claim against data, and draws out the implication.', 'Takes the provision apart clause by clause, checks how each has worked in practice, and states what that means.'],
    near: ['analyse', 'discuss', 'critically'],
  },
  {
    id: 'critically', name: 'Critically examine',
    asks: 'Examine in depth and give a judgement: strengths and limitations, weighed to a reasoned verdict.',
    structure: ['Intro: context', 'Body: merits with evidence, then limitations with evidence', 'Judgement: weigh them', 'Way forward'],
    check: 'Are both sides argued with evidence, and is there a clear, reasoned verdict?',
    patterns: ["Sets out the scheme's achievements with data, then its shortcomings with data, and closes with a reasoned verdict on balance.", 'Argues the case for the law and the case against it, each with evidence, then says which weighs more and why.'],
    near: ['evaluate', 'examine', 'discuss'],
  },
  {
    id: 'analyse', name: 'Analyse',
    asks: 'Break the issue into its components and show how they relate: the how and the why.',
    structure: ['Intro: the issue', 'Body: components or factors, each explained, with the links between them', 'Conclusion: a synthesis'],
    check: 'Does it split the issue into parts and connect them, rather than list facts?',
    patterns: ['Breaks the problem into its causes, shows how each feeds the others, and pulls them together at the end.', 'Separates the demand, supply and policy factors behind the trend and traces how they interact.'],
    near: ['examine', 'explain', 'discuss'],
  },
  {
    id: 'evaluate', name: 'Evaluate',
    asks: 'Judge the worth or effectiveness against criteria, weighing achievements and shortfalls.',
    structure: ['Intro: what is being judged', 'Criteria', 'Achievements with data', 'Shortfalls with data', 'Overall assessment'],
    check: 'Is there an explicit judgement of how well, backed by evidence?',
    patterns: ['Sets criteria for success, measures the policy against each with evidence, and concludes how far it worked.', 'Scores the mission on reach, quality and cost with figures for each, and ends with an overall rating.'],
    near: ['critically', 'justify', 'comment'],
  },
  {
    id: 'comment', name: 'Comment',
    asks: 'Give your opinion on the statement or issue, supported by reasons and evidence.',
    structure: ['Intro: what the statement means', 'Your stand, with arguments and evidence', 'Brief nod to the other view', 'Conclusion: restate your opinion'],
    check: 'Is your own opinion clear and justified?',
    patterns: ['States a clear opinion on the quotation, argues for it with evidence, briefly answers the opposite view, and restates the stand.', 'Takes a position on whether the remark holds today, gives three reasons with examples, and ends by restating that position.'],
    near: ['justify', 'evaluate', 'discuss'],
  },
  {
    id: 'elucidate', name: 'Elucidate',
    asks: 'Make the idea clear by explaining it in detail, with examples.',
    structure: ['Intro: the idea', 'Body: explain it step by step, each part with an example', 'Conclusion'],
    check: 'Would a reader now understand it clearly, with examples?',
    patterns: ['Explains the concept step by step, making each part clear with an example.', 'Unpacks a difficult phrase in the Constitution piece by piece, with a court case for each part.'],
    near: ['explain', 'illustrate', 'describe'],
  },
  {
    id: 'explain', name: 'Explain',
    asks: 'Make clear how or why something happens: the reasons, mechanism and relationships.',
    structure: ['Intro', 'Body: the reasons or mechanism, in a logical order', 'Conclusion'],
    check: 'Does it say why and how, not just what?',
    patterns: ['Sets out the mechanism of how and why it happens, cause by cause, in a logical order.', 'Traces the chain from the monsoon failure to food inflation, one step leading to the next.'],
    near: ['elucidate', 'analyse', 'describe'],
  },
  {
    id: 'justify', name: 'Justify',
    asks: 'Give reasons and evidence that support the statement; defend it.',
    structure: ['Intro: the claim', 'Body: supporting arguments with evidence', 'Answer an objection briefly', 'Conclusion: affirm the claim'],
    check: 'Does every point support the claim with evidence?',
    patterns: ['Gives arguments and evidence that support the claim, answers one objection, and affirms the claim.', 'Defends the decision with three reasons and data, shows why the main criticism does not hold, and reaffirms it.'],
    near: ['comment', 'evaluate', 'explain'],
  },
  {
    id: 'illustrate', name: 'Illustrate',
    asks: 'Explain using examples, cases, diagrams or figures.',
    structure: ['Intro: the concept', 'Body: concrete examples, case studies or a diagram carry the point', 'Conclusion'],
    check: 'Is the point carried mainly by examples or a diagram?',
    patterns: ['Makes the point mainly through three concrete case studies and a labelled diagram.', 'Shows the concept at work in two states and one country, with a flowchart of the process.'],
    near: ['elucidate', 'explain', 'describe'],
  },
  {
    id: 'enumerate', name: 'Enumerate',
    asks: 'List the points concisely, one after another, without discussion.',
    structure: ['One-line intro', 'Numbered points, one line each', 'One-line conclusion'],
    check: 'Are the points listed crisply, without long discussion?',
    patterns: ['Gives a numbered list of seven provisions in one line each, with no discussion.', 'Lists the functions of the body as short bullets and stops.'],
    near: ['describe', 'illustrate', 'elucidate'],
  },
  {
    id: 'describe', name: 'Describe',
    asks: 'Give a detailed account of the features or characteristics: what it is like.',
    structure: ['Intro', 'Body: features, characteristics or the process, in a logical order', 'Brief conclusion'],
    check: 'Does it give a complete picture of the features, without arguing?',
    patterns: ["Gives a detailed account of the river system's features and course in geographical order, without arguing a position.", 'Paints a full picture of how the institution is set up and works, part by part, with no verdict.'],
    near: ['enumerate', 'explain', 'elucidate'],
  },
];
export const DIRECTIVE_BY_ID = new Map(DIRECTIVES.map((d) => [d.id, d]));

// The directive a question uses ("Critically analyse" counts as Critically examine).
export function detectDirective(text) {
  const t = String(text || '').toLowerCase();
  if (/critically\s+(examine|analy[sz]e|evaluate|discuss|assess|comment)/.test(t)) return 'critically';
  const order = ['discuss', 'examine', 'analyse', 'evaluate', 'comment', 'elucidate', 'explain', 'justify', 'illustrate', 'enumerate', 'describe'];
  let best = null;
  let at = Infinity;
  for (const id of order) {
    const re = id === 'analyse' ? /\banaly[sz]e\b/ : new RegExp(`\\b${id}\\b`);
    const m = re.exec(t);
    if (m && m.index < at) { at = m.index; best = id; }
  }
  return best;
}
export const directiveName = (id) => (DIRECTIVE_BY_ID.get(id) || {}).name || null;

// ---------------------------------------------------------------- dimension wheel
export const DEFAULT_DIMENSIONS = ['political', 'economic', 'social', 'technological', 'legal-constitutional', 'environmental', 'ethical', 'administrative', 'international', 'security', 'historical', 'geographical'];
const DIM_SYNONYMS = {
  constitutional: 'legal-constitutional', legal: 'legal-constitutional', legislative: 'legal-constitutional', judicial: 'legal-constitutional', law: 'legal-constitutional',
  politics: 'political', democratic: 'political', electoral: 'political',
  governance: 'administrative', institutional: 'administrative', bureaucratic: 'administrative',
  economy: 'economic', fiscal: 'economic', financial: 'economic', monetary: 'economic', trade: 'economic',
  society: 'social', cultural: 'social', gender: 'social', demographic: 'social', health: 'social', education: 'social',
  technology: 'technological', science: 'technological', digital: 'technological', scientific: 'technological',
  environment: 'environmental', ecological: 'environmental', climate: 'environmental',
  ethics: 'ethical', moral: 'ethical',
  global: 'international', foreign: 'international', diplomatic: 'international', geopolitical: 'international',
  defence: 'security', defense: 'security', strategic: 'security',
  history: 'historical', heritage: 'historical',
  geography: 'geographical', regional: 'geographical', spatial: 'geographical',
};
export function normalizeDim(d) {
  const t = String(d || '').toLowerCase().trim().replace(/[\s_]+/g, '-');
  if (!t) return '';
  if (DEFAULT_DIMENSIONS.includes(t)) return t;
  for (const part of t.split('-')) if (DIM_SYNONYMS[part]) return DIM_SYNONYMS[part];
  return DIM_SYNONYMS[t] || t;
}
// Which of the model's dimensions you covered and which you missed.
export function dimensionOverlap(model, mine) {
  const have = new Set(mine.map(normalizeDim).filter(Boolean));
  const covered = [];
  const missed = [];
  for (const d of model) (have.has(normalizeDim(d)) ? covered : missed).push(d);
  const extra = [...have].filter((d) => !model.some((x) => normalizeDim(x) === d));
  return { covered, missed, extra };
}

// ---------------------------------------------------------------- value-adds
export const VALUE_ADD_TYPES = [
  ['article', 'Articles'], ['judgment', 'Judgments'], ['committee', 'Committees'], ['report', 'Reports and indices'],
  ['data', 'Data with year'], ['scheme', 'Schemes'], ['example', 'Examples'], ['quote', 'Quotes'], ['diagram', 'Diagram ideas'],
];
export const VALUE_ADD_LABEL = Object.fromEntries(VALUE_ADD_TYPES);
const VA_IDS = new Set(VALUE_ADD_TYPES.map((x) => x[0]));
export function normalizeValueAdd(type) {
  const t = String(type || '').toLowerCase();
  if (VA_IDS.has(t)) return t;
  if (/case|judg|verdict|court/.test(t)) return 'judgment';
  if (/index|report|ranking|survey/.test(t)) return 'report';
  if (/commission|committee|panel/.test(t)) return 'committee';
  if (/stat|data|figure|number/.test(t)) return 'data';
  if (/scheme|programme|program|mission|policy/.test(t)) return 'scheme';
  if (/quot/.test(t)) return 'quote';
  if (/diagram|map|flow|chart/.test(t)) return 'diagram';
  if (/article|constitution|act|law/.test(t)) return 'article';
  return 'example';
}
// The value-add category of an atom: its tags first, then what the text looks like.
export function valueAddCategory(atom) {
  for (const tag of atom.tags || []) { const v = normalizeValueAdd(tag); if (VA_IDS.has(String(tag).toLowerCase()) || v !== 'example') return v; }
  if (atom.type === 'quote') return 'quote';
  const t = `${atom.text} ${atom.answer}`;
  if (/\bv\.|\bvs\.?\b|\bjudg(e)?ment\b|\bcase\b|\bheld that\b|Supreme Court|High Court/i.test(t)) return 'judgment';
  if (/\b(committee|commission)\b/i.test(t)) return 'committee';
  if (/\b(index|report|ranking|ranked|survey)\b/i.test(t)) return 'report';
  if (/\b(yojana|scheme|mission|abhiyan|programme)\b/i.test(t)) return 'scheme';
  if (/\barticle\s+\d+/i.test(t)) return 'article';
  if (/\b(19|20)\d{2}\b/.test(t) && /\d+(\.\d+)?\s?(%|per cent|crore|lakh|million|billion)|\b\d{2,}\b/.test(t)) return 'data';
  if (/diagram|map|flowchart/i.test(t)) return 'diagram';
  return 'example';
}

// ---------------------------------------------------------------- rubric
export const RUBRIC = [
  ['demand', 'Demand addressed', ['Missed the directive or the question', 'Partly answers what was asked', 'Answers exactly what the directive asks']],
  ['structure', 'Structure', ['No clear intro, body or conclusion', 'Some structure, uneven flow', 'Clear intro, sub-headed body, conclusion']],
  ['dimensions', 'Dimensions', ['One angle only', 'Two or three dimensions', 'Four or more relevant dimensions']],
  ['valueAdd', 'Value-add', ['None', 'One value-add', 'Two or more: Article, judgment, report, data with year…']],
  ['diagram', 'Diagram', ['None where one would help', 'A rough diagram', 'A clear, labelled diagram or flowchart']],
  ['conclusion', 'Conclusion', ['Missing or a summary only', 'A generic way forward', 'A specific, forward-looking way forward']],
];
export const rubricTotal = (r) => RUBRIC.reduce((a, [k]) => a + (Number.isInteger(r[k]) ? r[k] : 0), 0);

// ---------------------------------------------------------------- Shadow Writing diff
// Rebuilt skeleton vs the model's: a body heading counts as recalled when it shares at
// least half its content words with a model heading (each model heading matched once).
export function skeletonDiff(model, rebuilt) {
  const body = (model.body || []).slice();
  const mine = (rebuilt.body || []).map((x) => String(x).trim()).filter(Boolean);
  const used = new Set();
  const matched = [];
  const extra = [];
  for (const m of mine) {
    let best = -1;
    let bestScore = 0;
    body.forEach((b, i) => {
      if (used.has(i)) return;
      const s = overlap(m, b);
      if (s > bestScore) { bestScore = s; best = i; }
    });
    if (best >= 0 && bestScore >= 0.5) { used.add(best); matched.push({ mine: m, model: body[best], score: bestScore }); } else extra.push(m);
  }
  const missed = body.filter((_, i) => !used.has(i));
  const intro = overlap(rebuilt.intro || '', model.intro || '');
  const conclusion = overlap(rebuilt.conclusion || '', model.conclusion || '');
  const score = body.length ? matched.length / body.length : 0;
  return { matched, missed, extra, intro, conclusion, score };
}

// ---------------------------------------------------------------- précis and limits
export const precisTarget = (passage) => Math.max(1, Math.round(wordCount(passage) / 3));
export function precisCheck(passage, text) {
  const target = precisTarget(passage);
  const words = wordCount(text);
  const off = (words - target) / target;
  return { target, words, ok: words > 0 && Math.abs(off) <= 0.1, off };
}

// Time and word limits for an answer from the profile paper (10 → 7 min / 150 words).
export function answerLimits(paper, marks) {
  const m = String(marks || 10);
  const words = (paper && paper.wordLimits && paper.wordLimits[m]) || (marks >= 15 ? 250 : 150);
  const minutes = (paper && paper.minutesPerAnswer && paper.minutesPerAnswer[m]) || (marks >= 15 ? 11 : 7);
  return { words, minutes, ms: minutes * 60000 };
}

// ---------------------------------------------------------------- question pool
// Mains questions from installed content: Mains PYQs, model answers, CA probable
// questions. Each: {ref, text, directive, paper, marks, words, nodes, dims, answerId}.
export function mainsQuestions({ pyqs = [], answers = [], ca = [], papers = new Map() }) {
  const out = [];
  for (const q of pyqs) {
    const paper = papers.get(q.paper);
    if (!paper || paper.type !== 'descriptive') continue;
    out.push({ ref: `pyq:${q.id}`, text: q.stem, directive: detectDirective(q.directive || q.stem) || detectDirective(q.stem), paper: q.paper, marks: q.marks || 10, words: q.words || null, nodes: q.nodes || [], dims: q.dimensions || [], year: q.year, answerId: null, source: `PYQ ${q.year}` });
  }
  for (const a of answers) {
    out.push({ ref: `ans:${a.id}`, text: a.question, directive: detectDirective(a.directive || a.question), paper: a.paper, marks: a.marks || 10, words: a.words || null, nodes: [], dims: a.dimensions || [], answerId: a.id, source: a.topper ? `Topper answer (${a.topper.name || 'model'})` : 'Model answer' });
  }
  for (const x of ca) {
    (x.probableQs || []).forEach((p, i) => {
      if (p.stage !== 'mains') return;
      out.push({ ref: `ca:${x.id}#${i}`, text: p.text, directive: detectDirective(p.text), paper: null, marks: 10, words: null, nodes: x.anchors || [], dims: x.mainsAngle || [], answerId: null, source: `Current affairs: ${x.headline}` });
    });
  }
  return out;
}

// The model answer that best matches a question (same answer, else most similar question).
export function bestModelAnswer(q, answers) {
  if (q.answerId) return answers.find((a) => a.id === q.answerId) || null;
  let best = null;
  let score = 0;
  for (const a of answers) {
    const s = overlap(q.text, a.question);
    if (s > score) { score = s; best = a; }
  }
  return score >= 0.45 ? best : null;
}

export const contentWords = (s) => tokens(s).length;
