// Small inline-SVG charts for the dashboard: line (with an optional band and reference
// line), stacked bars, horizontal bars, a heat grid and a dot plot. Thin marks, recessive
// axes, colours from CSS roles (validated categorical slots, one-hue sequential bins),
// a tooltip on hover or tap, and a table view for every chart.

import { h, clear } from './ui.js';

const NS = 'http://www.w3.org/2000/svg';
function s(tag, attrs = {}, ...kids) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined) el.setAttribute(k, String(v));
  for (const k of kids.flat()) if (k) el.append(k);
  return el;
}
const fmtN = (v) => (v === null || v === undefined ? '—' : Number.isInteger(v) ? String(v) : String(Math.round(v * 10) / 10));
// A round axis maximum: 1, 2, 2.5 or 5 times a power of ten.
export function niceMax(v) {
  if (!(v > 0)) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}
// Which x labels to print: evenly spaced, and the last one only when it has room.
const labelAt = (i, n, max = 6) => {
  const step = Math.ceil(n / max);
  if (i % step === 0) return true;
  return i === n - 1 && (n - 1) % step >= step / 2;
};

function frame({ title, desc, table }) {
  const tip = h('div', { class: 'viz-tip', hidden: true, role: 'status' });
  const box = h('div', { class: 'viz' }, tip);
  const wrap = h('figure', { class: 'viz-figure' }, title ? h('figcaption', { class: 'viz-title', text: title }) : null, desc ? h('p', { class: 'small muted viz-desc', text: desc }) : null, box,
    table ? h('details', { class: 'viz-table' }, h('summary', { text: 'Show as a table' }), table) : null);
  const show = (x, y, text) => {
    tip.textContent = text;
    tip.hidden = false;
    const bw = box.clientWidth || 300;
    tip.style.left = `${Math.max(4, Math.min(bw - 160, x - 70))}px`;
    tip.style.top = `${Math.max(0, y - 44)}px`;
  };
  const hide = () => { tip.hidden = true; };
  box.addEventListener('pointerleave', hide);
  return { wrap, box, show, hide };
}

function table(head, rows) {
  return h('table', { class: 'counts-table compact' }, h('thead', null, h('tr', null, head.map((x) => h('th', { text: x })))),
    h('tbody', null, rows.map((r) => h('tr', null, r.map((c, i) => (i ? h('td', { text: c }) : h('th', { text: c })))))));
}

// A rounded-top bar (4px data end) anchored on the baseline.
function barPath(x, y, w, hgt, r = 4) {
  if (hgt <= 0) return '';
  const rr = Math.min(r, w / 2, hgt);
  return `M${x},${y + hgt}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + hgt}Z`;
}

// points: [{label, value}] (value may be null). opts: {yMax, unit, ref: {value, label}, band: {lo, hi, label}, fmt}
export function lineChart(points, { title, desc, yMax = null, unit = '', ref = null, band = null, fmt = fmtN, height = 170 } = {}) {
  const W = 340; const H = height; const L = 34; const R = 10; const T = 12; const B = 24;
  const vals = points.map((p) => p.value).filter((v) => v !== null && v !== undefined);
  const max = yMax ?? niceMax(Math.max(1, ...vals, ref ? ref.value : 0, band ? band.hi : 0) * 1.05);
  const x = (i) => L + (points.length <= 1 ? (W - L - R) / 2 : (i * (W - L - R)) / (points.length - 1));
  const y = (v) => T + (H - T - B) * (1 - v / max);
  const f = frame({ title, desc, table: table(['', `Value${unit ? ` (${unit})` : ''}`], points.map((p) => [p.label, p.value === null ? '—' : fmt(p.value)])) });
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, class: 'viz-svg', role: 'img', 'aria-label': title || 'Line chart' });
  for (const t of [0, 0.5, 1]) svg.append(s('line', { x1: L, x2: W - R, y1: y(max * t), y2: y(max * t), class: t ? 'viz-grid' : 'viz-axis' }), s('text', { x: L - 4, y: y(max * t) + 3, class: 'viz-tick', 'text-anchor': 'end' }, fmt(max * t)));
  if (band) svg.append(s('rect', { x: L, width: W - L - R, y: y(band.hi), height: Math.max(1, y(band.lo) - y(band.hi)), class: 'viz-band' }), s('text', { x: W - R - 2, y: y(band.hi) - 3, class: 'viz-tick', 'text-anchor': 'end' }, band.label || ''));
  if (ref) svg.append(s('line', { x1: L, x2: W - R, y1: y(ref.value), y2: y(ref.value), class: 'viz-ref' }), s('text', { x: L + 2, y: y(ref.value) - 3, class: 'viz-tick' }, ref.label || ''));
  let d = '';
  let pen = false;
  points.forEach((p, i) => {
    if (p.value === null || p.value === undefined) { pen = false; return; }
    d += `${pen ? 'L' : 'M'}${x(i)},${y(p.value)}`;
    pen = true;
  });
  svg.append(s('path', { d, class: 'viz-line' }));
  points.forEach((p, i) => { if (p.value !== null && p.value !== undefined) svg.append(s('circle', { cx: x(i), cy: y(p.value), r: 4, class: 'viz-dot' })); });
  const step = points.length > 1 ? (W - L - R) / (points.length - 1) : W - L - R;
  points.forEach((p, i) => {
    if (labelAt(i, points.length)) svg.append(s('text', { x: x(i), y: H - 8, class: 'viz-tick', 'text-anchor': 'middle' }, p.short || p.label));
    const hit = s('rect', { x: x(i) - step / 2, y: 0, width: step, height: H, class: 'viz-hit' });
    const on = () => { const rect = f.box.getBoundingClientRect(); const sx = rect.width / W; f.show(x(i) * sx, y(p.value ?? 0) * sx, `${p.label}: ${p.value === null || p.value === undefined ? 'no data' : `${fmt(p.value)}${unit ? ` ${unit}` : ''}`}`); };
    hit.addEventListener('pointerenter', on);
    hit.addEventListener('click', on);
    svg.append(hit);
  });
  f.box.append(svg);
  return f.wrap;
}

// series: [{id, label}] in fixed slot order; data: [{label, values: {id: n}}]
export function stackedBars(series, data, { title, desc, height = 180 } = {}) {
  const W = 340; const H = height; const L = 30; const R = 8; const T = 10; const B = 24;
  const totals = data.map((d) => series.reduce((a, sr) => a + (d.values[sr.id] || 0), 0));
  const max = Math.max(1, ...totals);
  const bw = Math.max(6, ((W - L - R) / data.length) * 0.62);
  const xAt = (i) => L + ((i + 0.5) * (W - L - R)) / data.length - bw / 2;
  const y = (v) => T + (H - T - B) * (1 - v / max);
  const f = frame({ title, desc, table: table(['', ...series.map((x) => x.label), 'Total'], data.map((d, i) => [d.label, ...series.map((x) => String(d.values[x.id] || 0)), String(totals[i])])) });
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, class: 'viz-svg', role: 'img', 'aria-label': title || 'Stacked bars' });
  svg.append(s('line', { x1: L, x2: W - R, y1: y(0), y2: y(0), class: 'viz-axis' }), s('text', { x: L - 4, y: y(max) + 3, class: 'viz-tick', 'text-anchor': 'end' }, String(max)), s('line', { x1: L, x2: W - R, y1: y(max), y2: y(max), class: 'viz-grid' }));
  data.forEach((d, i) => {
    let acc = 0;
    series.forEach((sr, k) => {
      const v = d.values[sr.id] || 0;
      if (!v) return;
      const y0 = y(acc + v);
      const hgt = y(acc) - y0 - (acc ? 2 : 0);
      const top = series.slice(k + 1).every((x) => !(d.values[x.id] || 0));
      svg.append(top ? s('path', { d: barPath(xAt(i), y0, bw, hgt), class: `viz-fill-${k + 1}` }) : s('rect', { x: xAt(i), y: y0, width: bw, height: Math.max(0, hgt), class: `viz-fill-${k + 1}` }));
      acc += v;
    });
    if (labelAt(i, data.length)) svg.append(s('text', { x: xAt(i) + bw / 2, y: H - 8, class: 'viz-tick', 'text-anchor': 'middle' }, d.short || d.label));
    const hit = s('rect', { x: xAt(i) - 4, y: 0, width: bw + 8, height: H, class: 'viz-hit' });
    const on = () => { const rect = f.box.getBoundingClientRect(); const sx = rect.width / W; f.show((xAt(i) + bw / 2) * sx, y(totals[i]) * sx, `${d.label}: ${series.map((x) => `${x.label} ${d.values[x.id] || 0}`).join(' · ')}`); };
    hit.addEventListener('pointerenter', on);
    hit.addEventListener('click', on);
    svg.append(hit);
  });
  f.box.append(svg);
  const legend = h('div', { class: 'viz-legend' }, series.map((sr, k) => h('span', { class: 'viz-key' }, h('span', { class: `viz-swatch viz-bg-${k + 1}`, 'aria-hidden': 'true' }), sr.label)));
  f.wrap.insertBefore(legend, f.box);
  return f.wrap;
}

// rows: [{label, value}] horizontal bars, longest first.
export function hBars(rows, { title, desc, unit = '' } = {}) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  const f = frame({ title, desc, table: table(['', unit || 'Value'], rows.map((r) => [r.label, String(r.value)])) });
  f.box.append(h('div', { class: 'hbars' }, rows.map((r) => h('div', { class: 'hbar-row' },
    h('span', { class: 'hbar-label small', text: r.label }),
    h('span', { class: 'hbar-track' }, h('span', { class: 'hbar-fill', style: `width:${Math.max(2, (r.value / max) * 100)}%` })),
    h('span', { class: 'hbar-value small', text: String(r.value) })))));
  return f.wrap;
}

// Predicted recall bins for the heat grid (sequential, one hue).
export const HEAT_BINS = [[0, 0.2, 'under 20%'], [0.2, 0.4, '20–40%'], [0.4, 0.6, '40–60%'], [0.6, 0.8, '60–80%'], [0.8, 1.01, '80% or more']];
export const binOf = (r) => HEAT_BINS.findIndex(([lo, hi]) => r >= lo && r < hi);

// rows: [{title, cells: [{id, title, R, W, atoms}]}]; onPick(cell) opens a topic.
export function heatGrid(rows, { title, desc, onPick = null } = {}) {
  const f = frame({ title, desc, table: table(['Subject', 'Topic', 'PYQ weight', 'Recall on exam day'], rows.flatMap((r) => r.cells.map((c) => [r.title, c.title, String(c.W), `${Math.round(c.R * 100)}%`]))) });
  f.box.append(h('div', { class: 'heat' }, rows.map((r) => h('div', { class: 'heat-row' },
    h('span', { class: 'heat-label small', text: r.title }),
    h('span', { class: 'heat-cells' }, r.cells.map((c) => {
      const b = c.R > 0 ? binOf(c.R) : -1;
      const btn = h('button', { class: `heat-cell ${b < 0 ? 'heat-none' : `heat-${b + 1}`}`, type: 'button', 'aria-label': `${c.title}: recall ${Math.round(c.R * 100)}% on exam day, PYQ weight ${c.W}`, style: `--w:${Math.min(1.6, 0.8 + c.W / 10)}` });
      btn.addEventListener('pointerenter', () => { const rect = f.box.getBoundingClientRect(); const br = btn.getBoundingClientRect(); f.show(br.left - rect.left + 10, br.top - rect.top, `${c.title}: ${Math.round(c.R * 100)}% recall on exam day · weight ${c.W}`); });
      btn.addEventListener('click', () => { if (onPick) onPick(c); });
      return btn;
    }))))));
  const legend = h('div', { class: 'viz-legend' }, h('span', { class: 'viz-key' }, h('span', { class: 'viz-swatch heat-none', 'aria-hidden': 'true' }), 'not started'),
    HEAT_BINS.map(([, , label], i) => h('span', { class: 'viz-key' }, h('span', { class: `viz-swatch heat-${i + 1}`, 'aria-hidden': 'true' }), label)));
  f.wrap.insertBefore(legend, f.box);
  return f.wrap;
}

// Calibration: accuracy per confidence band against what that confidence should mean.
export function calibrationDots(bands, { title, desc } = {}) {
  const W = 340; const H = 170; const L = 34; const R = 10; const T = 12; const B = 26;
  const xs = bands.map((_, i) => L + ((i + 0.5) * (W - L - R)) / bands.length);
  const y = (v) => T + (H - T - B) * (1 - v);
  const f = frame({ title, desc, table: table(['Confidence', 'Answers', 'Accuracy', 'Expected'], bands.map((b) => [b.label, String(b.n), b.acc === null ? '—' : `${Math.round(b.acc * 100)}%`, `${Math.round(b.expect * 100)}%`])) });
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, class: 'viz-svg', role: 'img', 'aria-label': title || 'Calibration' });
  for (const t of [0, 0.25, 0.5, 0.75, 1]) svg.append(s('line', { x1: L, x2: W - R, y1: y(t), y2: y(t), class: t ? 'viz-grid' : 'viz-axis' }), s('text', { x: L - 4, y: y(t) + 3, class: 'viz-tick', 'text-anchor': 'end' }, `${t * 100}%`));
  bands.forEach((b, i) => {
    svg.append(s('line', { x1: xs[i] - 22, x2: xs[i] + 22, y1: y(b.expect), y2: y(b.expect), class: 'viz-ref' }));
    if (b.acc !== null) svg.append(s('circle', { cx: xs[i], cy: y(b.acc), r: 6, class: 'viz-dot big' }), s('text', { x: xs[i] + 10, y: y(b.acc) + 4, class: 'viz-label' }, `${Math.round(b.acc * 100)}%`));
    svg.append(s('text', { x: xs[i], y: H - 8, class: 'viz-tick', 'text-anchor': 'middle' }, `${b.label} (${b.n})`));
  });
  f.box.append(svg);
  return f.wrap;
}

export { clear };
