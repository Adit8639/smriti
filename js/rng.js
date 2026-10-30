// Seeded random numbers (mulberry32). Generated questions, mocks and bootstraps take a seed,
// so the same seed always gives the same output on every device.

import { fnv1a } from './util.js';

export function rng(seed) {
  let a = (typeof seed === 'number' && Number.isFinite(seed) ? seed : parseInt(fnv1a(String(seed)), 16)) >>> 0;
  if (!a) a = 0x9e3779b9;
  const next = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const r = {
    next,
    // Whole number from lo to hi, both included.
    int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)),
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    chance: (p) => next() < p,
    shuffle(arr) {
      const out = arr.slice();
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
      }
      return out;
    },
    // k distinct items (fewer if the list is shorter).
    sample: (arr, k) => r.shuffle(arr).slice(0, k),
  };
  return r;
}

// A fresh seed for a new generated item: time plus a counter, so two taps in the same
// millisecond still differ.
let seq = 0;
export const freshSeed = (now = Date.now()) => `${now.toString(36)}-${(seq++).toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;
