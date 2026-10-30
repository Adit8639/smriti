// CSAT Gym: procedural question generators, no fixed bank. Each generator takes a seeded
// random source and a level (1–3) and returns a four-option question with a worked
// solution: {type, level, sig, stem, options, answer, solution}. sig identifies the exact
// question, so a session never repeats one. All pure.

import { rng as makeRng } from './rng.js';

export const CSAT_TYPES = [
  ['percentages', 'Percentages'],
  ['ratio', 'Ratio and proportion'],
  ['averages', 'Averages'],
  ['tsd', 'Time, speed and distance'],
  ['work', 'Time and work'],
  ['numbers', 'Number system'],
  ['interest', 'Simple and compound interest'],
  ['pnc', 'Permutations and combinations'],
  ['sufficiency', 'Data sufficiency'],
  ['seating', 'Seating arrangement'],
  ['directions', 'Directions'],
];
export const CSAT_LABEL = Object.fromEntries(CSAT_TYPES);
export const LEVEL_LABEL = { 1: 'Easy', 2: 'Medium', 3: 'Hard' };

const LETTERS = ['a', 'b', 'c', 'd'];
const gcd = (a, b) => { a = Math.abs(a); b = Math.abs(b); while (b) [a, b] = [b, a % b]; return a; };
const lcm = (a, b) => (a / gcd(a, b)) * b;
const fact = (n) => (n <= 1 ? 1 : n * fact(n - 1));
const nCr = (n, r) => { if (r < 0 || r > n) return 0; let x = 1; for (let i = 1; i <= r; i++) x = (x * (n - r + i)) / i; return Math.round(x); };
const frac = (p, q) => { const g = gcd(p, q); return q / g === 1 ? String(p / g) : `${p / g}/${q / g}`; };
const trim = (x) => (Number.isInteger(x) ? String(x) : String(Math.round(x * 100) / 100));
const money = (x) => `₹${Math.round(x * 100) / 100 === Math.round(x) ? Math.round(x).toLocaleString('en-IN') : (Math.round(x * 100) / 100).toLocaleString('en-IN')}`;

// Four distinct options: the answer plus three distractors (common mistakes first, then
// near values). Options are compared by their printed text.
function mcq(r, correct, distractors, fmt = trim, step = null) {
  const shown = fmt(correct);
  const seen = new Set([shown]);
  const wrong = [];
  for (const d of distractors) {
    if (d === null || d === undefined || (typeof d === 'number' && (!Number.isFinite(d) || d <= 0 && correct > 0))) continue;
    const t = fmt(d);
    if (!seen.has(t)) { seen.add(t); wrong.push(t); }
    if (wrong.length === 3) break;
  }
  const base = typeof correct === 'number' ? correct : 0;
  const s = step || (typeof correct === 'number' ? Math.max(1, Math.round(Math.abs(correct) * 0.1)) : 1);
  for (let k = 1; wrong.length < 3 && k < 40; k++) {
    for (const d of [base + k * s, base - k * s]) {
      if (typeof correct === 'number' && correct > 0 && d <= 0) continue;
      const t = fmt(d);
      if (!seen.has(t) && wrong.length < 3) { seen.add(t); wrong.push(t); }
    }
  }
  const opts = r.shuffle([shown, ...wrong]);
  return { options: opts, answer: opts.indexOf(shown) };
}

// ---------------------------------------------------------------- percentages
function percentages(r, level) {
  if (level === 1) {
    const p = r.pick([5, 10, 12, 15, 20, 25, 30, 35, 40, 45, 60, 75, 80, 120, 150]);
    const n = r.int(2, 40) * 20;
    const ans = (n * p) / 100;
    if (!Number.isInteger(ans)) return null;
    return { sig: `${p}|${n}`, stem: `What is ${p}% of ${n}?`, ...mcq(r, ans, [(n * (p + 5)) / 100, (n * p) / 10, (n * Math.abs(p - 5)) / 100, n - ans]),
      solution: `${p}% of ${n} = ${n} × ${p}/100 = ${ans}.` };
  }
  if (level === 2) {
    if (r.chance(0.5)) {
      const a = r.pick([10, 20, 25, 30, 40, 50, 60]);
      const b = r.pick([10, 20, 25, 30, 40, 50]);
      const net = a - b - (a * b) / 100;
      const word = net > 0 ? 'increase' : net < 0 ? 'decrease' : 'no change';
      const f = (x) => (x === 0 ? 'No change' : `${trim(Math.abs(x))}% ${x > 0 ? 'increase' : 'decrease'}`);
      return { sig: `rise-fall|${a}|${b}`, stem: `The price of an article is raised by ${a}% and then reduced by ${b}%. What is the net change in its price?`,
        ...mcq(r, net, [a - b, a - b + (a * b) / 100, -(a * b) / 100, b - a], f, 5),
        solution: `Net change = a − b − ab/100 = ${a} − ${b} − ${a}×${b}/100 = ${trim(net)}%, so ${word === 'no change' ? 'no change' : `a ${trim(Math.abs(net))}% ${word}`}.` };
    }
    const d = r.pick([10, 15, 20, 25, 30, 40]);
    const sell = r.int(3, 30) * (100 - d);
    const mp = (sell * 100) / (100 - d);
    return { sig: `discount|${d}|${sell}`, stem: `After a discount of ${d}%, an article sells for ${money(sell)}. What is its marked price?`,
      ...mcq(r, mp, [sell * (1 + d / 100), sell + d, sell / (1 - d / 50), mp + sell * 0.05], money, Math.max(10, Math.round(mp * 0.05))),
      solution: `Selling price = (100 − ${d})% of the marked price, so marked price = ${sell} × 100/${100 - d} = ${money(mp)}.` };
  }
  const pairs = [[25, 20], [50, 100 / 3], [20, 100 / 6], [100, 50], [60, 37.5], [300, 75], [12.5, 100 / 9], [40, 200 / 7], [150, 60], [10, 100 / 11], [33.33, 25], [400, 80]];
  const [p, ans] = r.pick(pairs);
  const who = r.pick([['A', 'B'], ['Ravi', 'Mohan'], ['Asha', 'Bela'], ['X', 'Y']]);
  const thing = r.pick(['salary', 'income', 'height', 'score']);
  const f = (x) => `${trim(x)}%`;
  return { sig: `more-less|${p}|${thing}|${who[0]}`, stem: `${who[0]}'s ${thing} is ${trim(p)}% more than ${who[1]}'s. By what percentage is ${who[1]}'s ${thing} less than ${who[0]}'s?`,
    ...mcq(r, ans, [p, 100 - p, p / 2, (p * 100) / (100 - Math.min(p, 50))], f, 5),
    solution: `If ${who[1]} = 100, ${who[0]} = ${trim(100 + p)}. ${who[1]} is less by ${trim(p)}/${trim(100 + p)} × 100 = ${trim(ans)}%.` };
}

// ---------------------------------------------------------------- ratio and proportion
function ratio(r, level) {
  if (level === 1) {
    let a = r.int(1, 9);
    let b = r.int(1, 9);
    if (a === b) b = a + 1;
    const g = gcd(a, b); a /= g; b /= g;
    const n = (a + b) * r.int(3, 40);
    const big = (Math.max(a, b) * n) / (a + b);
    return { sig: `${a}:${b}|${n}`, stem: `Divide ${n} in the ratio ${a} : ${b}. What is the larger part?`,
      ...mcq(r, big, [(Math.min(a, b) * n) / (a + b), n / Math.max(a, b), n - Math.max(a, b), (Math.max(a, b) * n) / (a + b + 1)]),
      solution: `Larger part = ${Math.max(a, b)}/(${a} + ${b}) × ${n} = ${big}.` };
  }
  if (level === 2) {
    const a = r.int(1, 7); const b = r.int(2, 9); const c = r.int(1, 7); const d = r.int(2, 9);
    let x = a * c; let y = b * d; const g = gcd(x, y); x /= g; y /= g;
    if (x === y) return null;
    const f = (v) => v;
    const cands = [`${a * d} : ${b * c}`, `${a + c} : ${b + d}`, `${y} : ${x}`, `${a} : ${d}`].filter((s) => s !== `${x} : ${y}`);
    const shown = `${x} : ${y}`;
    const opts = r.shuffle([shown, ...[...new Set(cands)].slice(0, 3)]);
    if (opts.length < 4) return null;
    return { sig: `chain|${a}|${b}|${c}|${d}`, stem: `If A : B = ${a} : ${b} and B : C = ${c} : ${d}, what is A : C?`, options: opts.map(f), answer: opts.indexOf(shown),
      solution: `A : C = (A/B) × (B/C) = (${a}/${b}) × (${c}/${d}) = ${a * c}/${b * d} = ${x} : ${y}.` };
  }
  let a = r.int(1, 6);
  let b = r.int(a + 1, a + 6);
  const g0 = gcd(a, b); a /= g0; b /= g0;
  const k = r.int(2, 12);
  const add = r.int(2, 15);
  let c = a * k + add; let d = b * k + add; const g = gcd(c, d); c /= g; d /= g;
  if (c === a && d === b) return null;
  const small = a * k;
  return { sig: `add|${a}|${b}|${k}|${add}`, stem: `Two numbers are in the ratio ${a} : ${b}. If ${add} is added to each, the ratio becomes ${c} : ${d}. What is the smaller number?`,
    ...mcq(r, small, [b * k, small + add, a * (k + 1), small - a]),
    solution: `Let the numbers be ${a}k and ${b}k. (${a}k + ${add}) : (${b}k + ${add}) = ${c} : ${d} gives k = ${k}, so the smaller number is ${a} × ${k} = ${small}.` };
}

// ---------------------------------------------------------------- averages
function averages(r, level) {
  if (level === 1) {
    const n = r.int(5, 9);
    const avg = r.int(12, 60);
    const out = r.int(5, 90);
    const total = n * avg - out;
    if (total % (n - 1) !== 0) return null;
    const ans = total / (n - 1);
    return { sig: `${n}|${avg}|${out}`, stem: `The average of ${n} numbers is ${avg}. If the number ${out} is removed, what is the average of the remaining numbers?`,
      ...mcq(r, ans, [avg, (n * avg + out) / (n + 1), avg - out / n, ans + 1]),
      solution: `Total = ${n} × ${avg} = ${n * avg}. Remove ${out}: ${total}. New average = ${total}/${n - 1} = ${ans}.` };
  }
  if (level === 2) {
    const n = r.int(10, 40);
    const avg = r.int(40, 80);
    const rise = r.pick([0.5, 1, 1.5, 2, 2.5, 3]);
    const marks = avg + (n + 1) * rise;
    if (!Number.isInteger(marks)) return null;
    return { sig: `${n}|${avg}|${rise}`, stem: `The average mark of ${n} students is ${avg}. When a new student joins, the average rises by ${rise}. What did the new student score?`,
      ...mcq(r, marks, [avg + rise, avg + n * rise, avg + (n - 1) * rise, marks + rise * 2]),
      solution: `New total = ${n + 1} × ${avg + rise} = ${(n + 1) * (avg + rise)}; old total = ${n * avg}. The new student scored ${(n + 1) * (avg + rise)} − ${n * avg} = ${marks}.` };
  }
  const n1 = r.int(10, 40); const n2 = r.int(10, 40);
  const a1 = r.int(40, 80); const a2 = r.int(40, 80);
  if (a1 === a2) return null;
  const comb = (n1 * a1 + n2 * a2) / (n1 + n2);
  return { sig: `${n1}|${a1}|${n2}|${a2}`, stem: `Section A has ${n1} students with an average of ${a1}; section B has ${n2} students with an average of ${a2}. What is the average of all ${n1 + n2} students (to two decimal places)?`,
    ...mcq(r, comb, [(a1 + a2) / 2, (n1 * a2 + n2 * a1) / (n1 + n2), comb + 1, comb - 1.5], trim, 1),
    solution: `Combined average = (${n1}×${a1} + ${n2}×${a2}) / (${n1} + ${n2}) = ${n1 * a1 + n2 * a2}/${n1 + n2} = ${trim(comb)}.` };
}

// ---------------------------------------------------------------- time, speed, distance
const SPEED_PAIRS = [[40, 60], [30, 60], [20, 30], [60, 90], [45, 90], [12, 24], [36, 45], [50, 75], [10, 15], [30, 45], [24, 40], [42, 56], [60, 120], [35, 140], [48, 72], [15, 60], [18, 90], [70, 105], [21, 28], [33, 66]];
function tsd(r, level) {
  if (level === 1) {
    const kmph = r.int(2, 11) * 18;
    const hours = r.int(1, 10);
    const ms = (kmph * 5) / 18;
    return { sig: `${kmph}|${hours}`, stem: `A car covers ${kmph * hours} km in ${hours} hour${hours > 1 ? 's' : ''}. What is its speed in metres per second?`,
      ...mcq(r, ms, [kmph, (kmph * 18) / 5, kmph / 3.6 + 5, ms * 2], (x) => `${trim(x)} m/s`),
      solution: `Speed = ${kmph * hours}/${hours} = ${kmph} km/h = ${kmph} × 5/18 = ${ms} m/s.` };
  }
  if (level === 2) {
    const [u, v] = r.pick(SPEED_PAIRS);
    const avg = (2 * u * v) / (u + v);
    if (!Number.isInteger(avg)) return null;
    const d = r.int(2, 12) * 10;
    return { sig: `${u}|${v}|${d}`, stem: `A cyclist rides ${d} km at ${u} km/h and returns the same ${d} km at ${v} km/h. What is the average speed for the whole journey?`,
      ...mcq(r, avg, [(u + v) / 2, Math.sqrt(u * v), avg + 2, v - u], (x) => `${trim(x)} km/h`),
      solution: `For equal distances, average speed = 2uv/(u + v) = 2×${u}×${v}/${u + v} = ${avg} km/h (not the simple mean ${trim((u + v) / 2)}).` };
  }
  const speed = r.int(5, 30);
  const t = r.int(6, 20);
  const len = speed * t;
  const plat = speed * r.int(5, 30);
  const ans = (len + plat) / speed;
  return { sig: `${speed}|${t}|${plat}`, stem: `A train ${len} m long passes a signal post in ${t} seconds. How long will it take to cross a platform ${plat} m long?`,
    ...mcq(r, ans, [plat / speed, (plat - len) / speed, t + plat / 10, ans + t], (x) => `${trim(x)} s`),
    solution: `Speed = ${len}/${t} = ${speed} m/s. To cross the platform it covers its own length plus the platform: (${len} + ${plat})/${speed} = ${ans} s.` };
}

// ---------------------------------------------------------------- time and work
const WORK = [[1, 1], [1, 2], [1, 3], [2, 3], [1, 4], [3, 4], [2, 5], [1, 5], [3, 5]];
function work(r, level) {
  const [p, q] = r.pick(WORK);
  const s = r.int(1, 8);
  const a = s * q * (p + q);
  const b = s * p * (p + q);
  const t = s * p * q;
  if (level === 1) {
    return { sig: `${a}|${b}`, stem: `A can finish a job in ${a} days and B in ${b} days. Working together, how many days will they take?`,
      ...mcq(r, t, [(a + b) / 2, Math.abs(a - b) || t + 2, (a * b) / Math.max(1, Math.abs(a - b)), t + 1], (x) => `${trim(x)} days`),
      solution: `Together they do 1/${a} + 1/${b} = ${a + b}/${a * b} of the job a day, so ${a * b}/${a + b} = ${t} days.` };
  }
  if (level === 2) {
    if (a === b) return null;
    const [x, y] = a > b ? [a, b] : [b, a];
    return { sig: `${t}|${y}`, stem: `A and B together finish a job in ${t} days. A alone takes ${y} days. How long will B alone take?`,
      ...mcq(r, x, [y - t, t + y, (t * y) / (t + y), x + t], (z) => `${trim(z)} days`),
      solution: `B's rate = 1/${t} − 1/${y} = ${y - t}/${t * y}, so B takes ${t * y}/${y - t} = ${x} days.` };
  }
  const k = r.int(1, Math.max(1, t - 1));
  const left = 1 - k * (1 / a + 1 / b);
  const bTime = left * b;
  if (left <= 0 || Math.round(bTime * 2) !== bTime * 2) return null;
  return { sig: `${a}|${b}|${k}`, stem: `A can do a job in ${a} days and B in ${b} days. They work together for ${k} day${k > 1 ? 's' : ''}, then A leaves. In how many more days will B finish the job?`,
    ...mcq(r, bTime, [b - k, left * a, bTime + k, (b - k) / 2], (z) => `${trim(z)} days`, 1),
    solution: `In ${k} day${k > 1 ? 's' : ''} they finish ${k} × (1/${a} + 1/${b}) = ${frac(k, t)} of the job. B does the remaining ${frac(t - k, t)} at 1/${b} a day: ${frac(t - k, t)} × ${b} = ${trim(bTime)} days.` };
}

// ---------------------------------------------------------------- number system
function numbers(r, level) {
  if (level === 1) {
    const base = r.int(2, 99);
    const exp = r.int(11, 199);
    const last = Number(BigInt(base) ** BigInt(exp) % 10n);
    const d = base % 10;
    return { sig: `${base}^${exp}`, stem: `What is the unit digit of ${base}^${exp}?`,
      ...mcq(r, last, [d, (d * exp) % 10, ...r.shuffle([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])].filter((x) => x !== last), String, 1),
      solution: `Only the last digit ${d} matters. Its powers repeat in a cycle of ${cycle(d).length} (${cycle(d).join(', ')}); ${exp} mod ${cycle(d).length} = ${exp % cycle(d).length || cycle(d).length}, so the unit digit is ${last}.` };
  }
  if (level === 2) {
    const hcf = r.int(2, 15);
    let m = r.int(2, 12); let n = r.int(2, 12);
    if (gcd(m, n) !== 1 || m === n) return null;
    const a = hcf * m; const b = hcf * n; const l = hcf * m * n;
    return { sig: `${hcf}|${m}|${n}`, stem: `The HCF of two numbers is ${hcf} and their LCM is ${l}. If one number is ${a}, what is the other?`,
      ...mcq(r, b, [l / hcf, l - a, hcf * n + hcf, (l * hcf) / (a * 2)]),
      solution: `HCF × LCM = product of the numbers: ${hcf} × ${l} = ${a} × other, so the other = ${hcf * l}/${a} = ${b}.` };
  }
  const ds = r.sample([4, 5, 6, 8, 9, 10, 12, 15, 18, 20], 3);
  const rem = r.int(1, Math.min(...ds) - 1);
  const L = ds.reduce(lcm);
  const ans = L + rem;
  return { sig: `${ds.slice().sort((a, b) => a - b).join(',')}|${rem}`, stem: `What is the smallest number greater than ${rem} that leaves a remainder of ${rem} when divided by ${ds[0]}, ${ds[1]} and ${ds[2]}?`,
    ...mcq(r, ans, [L, ds[0] * ds[1] * ds[2] + rem, L - rem, 2 * L + rem]),
    solution: `The number is a multiple of LCM(${ds.join(', ')}) = ${L}, plus ${rem}: ${L} + ${rem} = ${ans}.` };
}
function cycle(d) {
  const out = [];
  let x = d % 10;
  while (!out.includes(x)) { out.push(x); x = (x * d) % 10; }
  return out;
}

// ---------------------------------------------------------------- interest
function interest(r, level) {
  if (level === 1) {
    const p = r.int(2, 50) * 500;
    const rate = r.int(2, 15);
    const t = r.int(2, 6);
    const si = (p * rate * t) / 100;
    return { sig: `${p}|${rate}|${t}`, stem: `What is the simple interest on ${money(p)} at ${rate}% per annum for ${t} years?`,
      ...mcq(r, si, [(p * rate) / 100, p + si, (p * rate * (t + 1)) / 100, (p * (rate + 1) * t) / 100], money, Math.max(10, Math.round(si * 0.1))),
      solution: `SI = P × R × T / 100 = ${p} × ${rate} × ${t} / 100 = ${money(si)}.` };
  }
  if (level === 2) {
    const rate = r.pick([5, 10, 20]);
    const p = r.int(1, 40) * 400;
    const ci = p * (1 + rate / 100) ** 2 - p;
    return { sig: `ci|${p}|${rate}`, stem: `What is the compound interest on ${money(p)} for 2 years at ${rate}% per annum, compounded annually?`,
      ...mcq(r, ci, [(2 * p * rate) / 100, p * (1 + rate / 100) ** 2, ci + (p * rate) / 100, (p * rate) / 100], money, Math.max(10, Math.round(ci * 0.05))),
      solution: `Amount = ${p} × (1 + ${rate}/100)² = ${trim(p * (1 + rate / 100) ** 2)}. CI = amount − principal = ${money(ci)}. (Simple interest would be ${money((2 * p * rate) / 100)}.)` };
  }
  const rate = r.pick([4, 5, 8, 10, 12, 15, 20, 25]);
  const p = r.int(1, 30) * (rate % 5 === 0 ? 400 : 625);
  const diff = (p * rate * rate) / 10000;
  if (Math.round(diff * 100) !== diff * 100) return null;
  if (r.chance(0.5)) {
    return { sig: `diff|${p}|${rate}`, stem: `What is the difference between compound and simple interest on ${money(p)} for 2 years at ${rate}% per annum?`,
      ...mcq(r, diff, [(p * rate) / 100, diff * 2, (p * rate * 2) / 100 - diff, diff + rate], money, Math.max(1, Math.round(diff * 0.2))),
      solution: `For 2 years, CI − SI = P × (R/100)² = ${p} × (${rate}/100)² = ${money(diff)}.` };
  }
  return { sig: `find-p|${p}|${rate}`, stem: `The difference between compound and simple interest on a sum for 2 years at ${rate}% per annum is ${money(diff)}. What is the sum?`,
    ...mcq(r, p, [diff * 100 / rate, p * 2, (diff * 10000) / (2 * rate * rate), p + diff * 10], money, Math.max(100, Math.round(p * 0.1))),
    solution: `CI − SI = P × (R/100)², so P = ${trim(diff)} × (100/${rate})² = ${money(p)}.` };
}

// ---------------------------------------------------------------- permutations and combinations
const WORDS = ['PLANET', 'ORANGE', 'MOTHER', 'GARDEN', 'FRIEND', 'SQUARE', 'JUSTICE', 'COUNTRY', 'TRAVEL', 'NATIVE', 'ROCKET', 'SILVER', 'MEADOW', 'PRISON', 'DANGER', 'HUNTER', 'FAMOUS', 'BRIDGE', 'CLIENT', 'ISLAND'];
function pnc(r, level) {
  if (level === 1) {
    const pick = r.int(0, 2);
    if (pick === 2) {
      const n = r.int(5, 24);
      const ans = (n * (n - 3)) / 2;
      return { sig: `diag|${n}`, stem: `How many diagonals does a convex polygon with ${n} sides have?`,
        ...mcq(r, ans, [nCr(n, 2), n * (n - 3), ans + n, (n * (n - 2)) / 2]),
        solution: `Each vertex joins ${n} − 3 others by a diagonal (not itself or its two neighbours), and each diagonal is counted twice: ${n} × ${n - 3} / 2 = ${ans}.` };
    }
    if (pick === 1) {
      const n = r.int(5, 30);
      const ans = nCr(n, 2);
      return { sig: `hand|${n}`, stem: `At a meeting, each of ${n} people shakes hands once with every other person. How many handshakes take place?`,
        ...mcq(r, ans, [n * (n - 1), n * n, ans + n, n * (n + 1) / 2]),
        solution: `Each handshake is a pair of people: C(${n}, 2) = ${n}×${n - 1}/2 = ${ans}.` };
    }
    const n = r.int(4, 7);
    const ans = fact(n);
    return { sig: `row|${n}`, stem: `In how many ways can ${n} people be seated in a row of ${n} chairs?`,
      ...mcq(r, ans, [n * n, fact(n - 1), 2 ** n, ans / 2]),
      solution: `${n} choices for the first chair, ${n - 1} for the next, and so on: ${n}! = ${ans}.` };
  }
  if (level === 2) {
    const m = r.int(4, 8); const w = r.int(3, 7);
    const a = r.int(1, Math.min(3, m)); const b = r.int(1, Math.min(3, w));
    const ans = nCr(m, a) * nCr(w, b);
    return { sig: `com|${m}|${w}|${a}|${b}`, stem: `A committee of ${a} men and ${b} women is to be formed from ${m} men and ${w} women. In how many ways can it be done?`,
      ...mcq(r, ans, [nCr(m + w, a + b), nCr(m, a) + nCr(w, b), ans * 2, fact(a + b)]),
      solution: `Choose the men: C(${m}, ${a}) = ${nCr(m, a)}. Choose the women: C(${w}, ${b}) = ${nCr(w, b)}. Together: ${nCr(m, a)} × ${nCr(w, b)} = ${ans}.` };
  }
  const word = r.pick(WORDS);
  const n = word.length;
  const vowels = [...word].filter((c) => 'AEIOU'.includes(c)).length;
  if (r.chance(0.5) && vowels >= 2) {
    const ans = fact(n - vowels + 1) * fact(vowels);
    return { sig: `vow|${word}`, stem: `In how many ways can the letters of the word ${word} be arranged so that the vowels always come together?`,
      ...mcq(r, ans, [fact(n), fact(n - vowels) * fact(vowels), fact(n - vowels + 1), ans * 2]),
      solution: `Treat the ${vowels} vowels as one block: ${n - vowels + 1} units arrange in ${n - vowels + 1}! = ${fact(n - vowels + 1)} ways; the vowels inside the block in ${vowels}! = ${fact(vowels)} ways. Total ${ans}.` };
  }
  const ans = fact(n) - 2 * fact(n - 1);
  const [x, y] = r.sample([...word], 2);
  return { sig: `apart|${word}|${[x, y].sort().join('')}`, stem: `In how many arrangements of the letters of ${word} are the letters ${x} and ${y} never next to each other?`,
    ...mcq(r, ans, [fact(n) - fact(n - 1), 2 * fact(n - 1), fact(n), fact(n - 2) * 2]),
    solution: `All arrangements: ${n}! = ${fact(n)}. With ${x} and ${y} together (as a block, in 2 orders): 2 × ${n - 1}! = ${2 * fact(n - 1)}. Never together: ${fact(n)} − ${2 * fact(n - 1)} = ${ans}.` };
}

// ---------------------------------------------------------------- data sufficiency
export const DS_OPTIONS = [
  'Statement I alone is sufficient, but Statement II alone is not',
  'Statement II alone is sufficient, but Statement I alone is not',
  'Both statements together are sufficient, but neither alone is',
  'Both statements together are not sufficient',
];
function sufficiency(r, level) {
  const pool = level === 1 ? ['oneA', 'oneB', 'greater'] : level === 2 ? ['sumdiff', 'div6', 'age', 'rank'] : ['dup', 'rect', 'sumdiff', 'speed'];
  const t = r.pick(pool);
  const x = r.int(3, 30); const y = r.int(2, 25);
  const k = r.int(2, 6);
  let stem; let s1; let s2; let ans; let why;
  switch (t) {
    case 'oneA':
      stem = 'What is the value of x?'; s1 = `${k}x = ${k * x}`; s2 = `x + y = ${x + y}`; ans = 0;
      why = `I gives x = ${x} directly. II has two unknowns, so it alone cannot fix x.`; break;
    case 'oneB':
      stem = 'What is the value of x?'; s1 = `x + y = ${x + y}`; s2 = `${k}x − ${2 * k} = ${k * x - 2 * k}`; ans = 1;
      why = `II gives ${k}x = ${k * x}, so x = ${x}. I alone has two unknowns.`; break;
    case 'greater': {
      const d = r.int(1, 9);
      stem = 'Is p greater than q?'; s1 = `p − q = ${d}`; s2 = `p + q = ${r.int(10, 60)}`; ans = 0;
      why = `I: p − q = ${d} > 0, so yes. II says nothing about which is larger.`; break;
    }
    case 'sumdiff':
      stem = 'What is the value of x?'; s1 = `x + y = ${x + y}`; s2 = `x − y = ${x - y}`; ans = 2;
      why = `Each statement alone has two unknowns. Together: adding them gives 2x = ${2 * x}, so x = ${x}.`; break;
    case 'div6': {
      stem = 'Is the whole number N divisible by 6?'; s1 = 'N is divisible by 3'; s2 = 'N is divisible by 2'; ans = 2;
      why = 'Divisible by 3 alone (e.g. 9) or by 2 alone (e.g. 4) does not settle it. Both together mean divisible by 6.'; break;
    }
    case 'age': {
      const diff = r.int(2, 15); const b = r.int(10, 50);
      stem = "What is Anil's age?"; s1 = `Anil is ${diff} years older than Bimal`; s2 = `Bimal is ${b} years old`; ans = 2;
      why = `I relates the two ages, II gives Bimal's; together Anil is ${b + diff}. Neither alone gives Anil's age.`; break;
    }
    case 'rank': {
      const top = r.int(5, 30); const bottom = r.int(5, 30);
      stem = 'How many students are in the class?'; s1 = `Ravi is ${ordinal(top)} from the top`; s2 = `Ravi is ${ordinal(bottom)} from the bottom`; ans = 2;
      why = `Together: ${top} + ${bottom} − 1 = ${top + bottom - 1} students. Either rank alone says nothing about the other end.`; break;
    }
    case 'dup':
      stem = 'What is the value of x?'; s1 = `x + y = ${x + y}`; s2 = `${k}x + ${k}y = ${k * (x + y)}`; ans = 3;
      why = `II is just I multiplied by ${k}, so together they are still one equation in two unknowns.`; break;
    case 'rect': {
      const l = r.int(5, 30); const w = r.int(2, l - 1);
      stem = 'What is the area of the rectangle?'; s1 = `Its perimeter is ${2 * (l + w)} cm`; s2 = `Its length is ${l} cm`; ans = 2;
      why = `I alone fits many rectangles; II alone lacks the width. Together: width = ${l + w} − ${l} = ${w}, area = ${l * w} cm².`; break;
    }
    case 'speed':
    default: {
      const d = r.int(4, 40) * 10;
      const at = r.int(5, 11);
      stem = 'What is the average speed of the train between the two stations?'; s1 = `The stations are ${d} km apart`; s2 = `The train leaves the first station at ${at} a.m.`; ans = 3;
      why = 'I gives the distance and II the departure time, but nothing gives the arrival time, so even together the speed is not fixed.'; break;
    }
  }
  return { sig: `${t}|${s1}|${s2}`, stem: `Question: ${stem}\nStatement I: ${s1}\nStatement II: ${s2}\nWhich of the following is correct?`, options: DS_OPTIONS.slice(), answer: ans,
    solution: `${why} So: ${DS_OPTIONS[ans].charAt(0).toLowerCase()}${DS_OPTIONS[ans].slice(1)}.` };
}
const ordinal = (n) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th'}`;

// ---------------------------------------------------------------- seating (linear row)
const PEOPLE = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
function perms(list) {
  if (list.length <= 1) return [list.slice()];
  const out = [];
  list.forEach((x, i) => { for (const p of perms([...list.slice(0, i), ...list.slice(i + 1)])) out.push([x, ...p]); });
  return out;
}
const CLUE_KINDS = {
  end: (P, a) => ({ text: `${a} sits at one of the ends.`, test: (s) => s.indexOf(a) === 0 || s.indexOf(a) === s.length - 1 }),
  imLeft: (P, a, b) => ({ text: `${a} sits immediately to the left of ${b}.`, test: (s) => s.indexOf(a) === s.indexOf(b) - 1 }),
  secondRight: (P, a, b) => ({ text: `${a} sits second to the right of ${b}.`, test: (s) => s.indexOf(a) === s.indexOf(b) + 2 }),
  notAdj: (P, a, b) => ({ text: `${a} does not sit next to ${b}.`, test: (s) => Math.abs(s.indexOf(a) - s.indexOf(b)) !== 1 }),
  leftOf: (P, a, b) => ({ text: `${a} sits somewhere to the left of ${b}.`, test: (s) => s.indexOf(a) < s.indexOf(b) }),
  oneBetween: (P, a, b) => ({ text: `Exactly one person sits between ${a} and ${b}.`, test: (s) => Math.abs(s.indexOf(a) - s.indexOf(b)) === 2 }),
  fromLeft: (P, a, b, s0) => {
    const k = s0.indexOf(a) + 1;
    const text = k === 1 ? `${a} sits at the extreme left end.` : k === s0.length ? `${a} sits at the extreme right end.` : `${a} is ${ordinal(k)} from the left end.`;
    return { text, test: (s) => s.indexOf(a) === k - 1 };
  },
};
function seating(r, level) {
  const n = level === 3 ? 6 : 5;
  const people = PEOPLE.slice(0, n);
  const truth = r.shuffle(people);
  const all = perms(people);
  const asks = [
    ['middle', n % 2 ? 'Who sits in the middle of the row?' : `Who sits ${ordinal(n / 2)} from the left end?`, (s) => s[n % 2 ? (n - 1) / 2 : n / 2 - 1]],
    ['leftEnd', 'Who sits at the extreme left end?', (s) => s[0]],
    ['rightEnd', 'Who sits at the extreme right end?', (s) => s[n - 1]],
    ['secondLeft', 'Who sits second from the left end?', (s) => s[1]],
  ];
  const [askId, askText, askFn] = r.pick(asks);
  const answer = askFn(truth);
  const clues = [];
  let cands = all;
  const kinds = level === 1 ? ['imLeft', 'end', 'fromLeft', 'leftOf', 'secondRight'] : ['imLeft', 'secondRight', 'notAdj', 'leftOf', 'oneBetween', 'end', 'fromLeft'];
  for (let tries = 0; tries < 200 && new Set(cands.map(askFn)).size > 1; tries++) {
    const kind = r.pick(kinds);
    const [a, b] = r.sample(people, 2);
    if (kind === 'fromLeft' && a === answer) continue;
    const c = CLUE_KINDS[kind](people, a, b, truth);
    if (!c.test(truth) || clues.some((x) => x.text === c.text)) continue;
    const next = cands.filter(c.test);
    if (next.length === cands.length) continue;
    clues.push(c);
    cands = next;
  }
  if (new Set(cands.map(askFn)).size !== 1) return null;
  // Drop clues the answer does not need, so every clue matters.
  for (let i = clues.length - 1; i >= 0; i--) {
    const rest = clues.filter((_, j) => j !== i);
    const left = all.filter((s) => rest.every((c) => c.test(s)));
    if (new Set(left.map(askFn)).size === 1) clues.splice(i, 1);
  }
  if (clues.length < level + 1) return null;
  const shown = r.shuffle(clues);
  const others = r.sample(people.filter((p) => p !== answer), 3);
  const opts = r.shuffle([answer, ...others]);
  const fit = all.filter((s) => clues.every((c) => c.test(s)));
  return { sig: `${truth.join('')}|${askId}|${shown.map((c) => c.text).join('')}`,
    stem: `${n} friends, ${people.slice(0, -1).join(', ')} and ${people[n - 1]}, sit in a row facing north.\n${shown.map((c, i) => `${i + 1}. ${c.text}`).join('\n')}\n${askText}`,
    options: opts, answer: opts.indexOf(answer),
    solution: `The clues allow ${fit.length === 1 ? 'one arrangement' : `${fit.length} arrangements`} (left to right): ${fit.slice(0, 3).map((s) => s.join(' ')).join('; ')}${fit.length > 3 ? '; …' : ''}. In ${fit.length === 1 ? 'it' : 'each'}, the answer is ${answer}.` };
}

// ---------------------------------------------------------------- directions
const DIRS = ['North', 'East', 'South', 'West'];
const TRIPLES = [[3, 4, 5], [6, 8, 10], [5, 12, 13], [8, 15, 17], [9, 12, 15], [12, 16, 20], [7, 24, 25], [15, 20, 25], [20, 21, 29], [9, 40, 41]];
function compass(dx, dy) {
  if (!dx && !dy) return 'at the starting point';
  const ns = dy > 0 ? 'North' : dy < 0 ? 'South' : '';
  const ew = dx > 0 ? 'East' : dx < 0 ? 'West' : '';
  return ns && ew ? `${ns}-${ew}` : ns || ew;
}
function directions(r, level) {
  const name = r.pick(['Meena', 'Arjun', 'Kabir', 'Sara', 'Imran', 'Tara']);
  const [a, b, c] = r.pick(TRIPLES);
  const f = r.int(1, 3);
  const [x, y] = [a * f, b * f];
  const start = r.int(0, 3);
  const turn = r.pick(['right', 'left']);
  const vec = (d) => [[0, 1], [1, 0], [0, -1], [-1, 0]][d];
  if (level === 1) {
    const d2 = (start + (turn === 'right' ? 1 : 3)) % 4;
    const [dx1, dy1] = vec(start); const [dx2, dy2] = vec(d2);
    const dx = dx1 * y + dx2 * x; const dy = dy1 * y + dy2 * x;
    const ans = `${c * f} km ${compass(dx, dy)}`;
    const opts = r.shuffle([ans, `${c * f} km ${compass(-dx, dy)}`, `${(a + b) * f} km ${compass(dx, dy)}`, `${c * f} km ${compass(dx, -dy)}`]);
    if (new Set(opts).size < 4) return null;
    return { sig: `${a}${b}|${f}|${start}|${turn}`, stem: `${name} walks ${y} km ${DIRS[start]}, turns ${turn} and walks ${x} km. How far and in which direction is ${name} from the start?`,
      options: opts, answer: opts.indexOf(ans),
      solution: `The two legs are at right angles: distance = √(${y}² + ${x}²) = ${c * f} km. Net movement: ${DIRS[start]} then ${DIRS[d2]}, so ${compass(dx, dy)} of the start.` };
  }
  // Level 2: three legs, the middle one at right angles and the last one walking back part
  // of the first. Level 3: four legs turning the same way (a square spiral), and the
  // question also asks which way the walker faces at the end.
  const e1 = r.int(2, 9);
  const e2 = r.int(2, 9);
  const sign = turn === 'right' ? 1 : 3;
  const lengths = level === 3 ? [y + e1, x + e2, e1, e2] : [y + e1, x, e1];
  let d = start;
  let px = 0;
  let py = 0;
  const legs = [];
  for (let i = 0; i < lengths.length; i++) {
    if (i) d = (d + sign) % 4;
    const [vx, vy] = vec(d);
    px += vx * lengths[i];
    py += vy * lengths[i];
    legs.push(i ? `turns ${turn} and walks ${lengths[i]} km` : `walks ${lengths[i]} km ${DIRS[d]}`);
  }
  const dist = Math.round(Math.sqrt(px * px + py * py));
  if (dist !== c * f) return null;
  const facing = DIRS[d];
  const ask = level === 3 ? `How far is ${name} from the start, and which way is ${name} facing now?` : `How far and in which direction is ${name} from the start?`;
  const ans = level === 3 ? `${dist} km, facing ${facing}` : `${dist} km ${compass(px, py)}`;
  const wrong = level === 3
    ? [`${dist} km, facing ${DIRS[(d + 2) % 4]}`, `${dist + e1} km, facing ${facing}`, `${dist} km, facing ${DIRS[(d + 1) % 4]}`]
    : [`${dist} km ${compass(-px, py)}`, `${(y + x + e1)} km ${compass(px, py)}`, `${dist} km ${compass(px, -py)}`];
  const opts = r.shuffle([ans, ...wrong]);
  if (new Set(opts).size < 4) return null;
  return { sig: `${lengths.join(',')}|${start}|${turn}|${level}`, stem: `${name} ${legs.join(', then ')}. ${ask}`, options: opts, answer: opts.indexOf(ans),
    solution: `Track east–west and north–south separately: the net shift is ${Math.abs(px)} km ${px >= 0 ? 'East' : 'West'} and ${Math.abs(py)} km ${py >= 0 ? 'North' : 'South'}, so the distance is √(${px * px} + ${py * py}) = ${dist} km${level === 3 ? `; after ${lengths.length - 1} ${turn} turns ${name} faces ${facing}` : `, ${compass(px, py)} of the start`}.` };
}

const GEN = { percentages, ratio, averages, tsd, work, numbers, interest, pnc, sufficiency, seating, directions };

// One question of a type and level from a seed. Retries internally when a draw does not
// give clean numbers; the same seed always gives the same question.
export function generate(type, level, seed) {
  const fn = GEN[type];
  if (!fn) throw new Error(`Unknown CSAT type "${type}"`);
  const lv = [1, 2, 3].includes(level) ? level : 1;
  const r = makeRng(`${type}|${lv}|${seed}`);
  for (let i = 0; i < 60; i++) {
    const q = fn(r, lv);
    if (q && q.options && q.options.length === 4 && new Set(q.options).size === 4 && q.answer >= 0) {
      return { ...q, type, level: lv, sig: `${type}|${lv}|${q.sig}`, letters: LETTERS };
    }
  }
  throw new Error(`Could not generate a ${type} question`);
}

// A run of n questions with no repeated question (by sig). types: list of type ids.
export function generateSet({ types, level, n, seed, avoid = new Set() }) {
  const out = [];
  const seen = new Set(avoid);
  const r = makeRng(`set|${seed}`);
  const order = r.shuffle(types);
  for (let i = 0; out.length < n && i < n * 30; i++) {
    const type = order[out.length % order.length];
    const lv = level === 'mixed' ? r.int(1, 3) : level;
    const q = generate(type, lv, `${seed}|${i}`);
    if (seen.has(q.sig)) continue;
    seen.add(q.sig);
    out.push(q);
  }
  return out;
}
