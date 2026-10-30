// Confusion detection: when a wrong option, pairing or position belongs to another atom,
// that pair of atoms is logged. Only confident mappings count, so noise never creates
// contrast cards.

import { normalize, overlap, filled } from './cloze.js';
import { pairKey } from './rebuild.js';

const MIN_OVERLAP = 0.5;

// Best atom for a piece of text: exact answer match first, then word overlap.
function mapText(text, atoms) {
  const t = normalize(text);
  if (!t) return null;
  let best = null;
  let bestScore = 0;
  for (const a of atoms) {
    const ans = normalize(a.answer);
    if (ans && (ans === t || (ans.length >= 4 && t.includes(ans)))) return a;
    const sc = overlap(text, filled(a));
    if (sc > bestScore) { bestScore = sc; best = a; }
  }
  return bestScore >= MIN_OVERLAP ? best : null;
}

// Atom for each pair/item: by position when the probe lists one atom per pair, else by text.
function mapList(list, probeAtoms, textOf) {
  if (probeAtoms.length === list.length) return probeAtoms.slice();
  return list.map((x) => mapText(textOf(x), probeAtoms));
}

// probe: the probe shown; response: what was answered; target: the atom under review.
// atomsById: Map of atoms that can be blamed (the probe's atoms, the target's confusables,
// atoms of the same topic). Returns [{a, b, via}] with distinct pairs.
export function detectConfusions(probe, response, target, atomsById) {
  const out = [];
  const seen = new Set();
  const add = (x, y, via) => {
    if (!x || !y || x.id === y.id) return;
    const k = pairKey(x.id, y.id);
    if (seen.has(k)) return;
    seen.add(k);
    out.push({ a: x.id, b: y.id, via });
  };
  const probeAtoms = (probe.atoms || []).map((id) => atomsById.get(id)).filter(Boolean);

  if (['identify', 'pyq'].includes(probe.format) && probe.options && Number.isInteger(response.choice) && response.choice !== probe.answer) {
    const pool = [...atomsById.values()].filter((a) => a.id !== target.id);
    const picked = mapText(probe.options[response.choice], pool);
    if (picked) add(target, picked, 'option');
  }

  if ((probe.format === 'match' || probe.format === 'contrast') && Array.isArray(response.pairing) && !probe.options) {
    const owners = mapList(probe.pairs, probeAtoms, (p) => `${p[0]} ${p[1]}`);
    response.pairing.forEach((j, i) => {
      const wrong = j !== null && j !== i && probe.pairs[j] && probe.pairs[j][1] !== probe.pairs[i][1];
      if (wrong && owners[i] && owners[j]) add(owners[i], owners[j], 'pair');
    });
  }

  if (probe.format === 'order' && Array.isArray(response.order)) {
    const owners = mapList(probe.items, probeAtoms, (x) => x);
    response.order.forEach((item, pos) => {
      if (item !== pos && owners[item] && owners[pos]) add(owners[item], owners[pos], 'position');
    });
  }
  return out;
}
