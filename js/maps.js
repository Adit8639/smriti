// Offline outline maps (vendor/maps, pre-projected from Natural Earth; India in its official
// boundary) and the pins drawn on them from atoms' geo {lat, lon}.

const SVG = 'http://www.w3.org/2000/svg';
const cache = new Map();

export async function loadMap(id) {
  if (!cache.has(id)) {
    cache.set(id, fetch(new URL(`vendor/maps/${id}.json`, document.baseURI)).then((r) => {
      if (!r.ok) throw new Error(`map ${id}: HTTP ${r.status}`);
      return r.json();
    }));
  }
  return cache.get(id);
}

export function project(map, lat, lon) {
  const p = map.proj;
  return { x: (lon - p.lon0) * p.k * p.s, y: (p.latTop - lat) * p.s };
}
export function unproject(map, x, y) {
  const p = map.proj;
  return { lat: p.latTop - y / p.s, lon: p.lon0 + x / (p.k * p.s) };
}
export const inView = (map, lat, lon) => { const { x, y } = project(map, lat, lon); return x >= 0 && y >= 0 && x <= map.w && y <= map.h; };

export function haversineKm(a, b) {
  const R = 6371;
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

const el = (tag, attrs = {}) => {
  const e = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined) e.setAttribute(k, String(v));
  return e;
};

// The base map as an SVG with zoom and pan. onTap({x, y, lat, lon}) fires on a tap (not a
// drag). Returns {svg, pins (group), zoom(f), point(evt)}.
export function mapView(map, { onTap = null, labels = false } = {}) {
  const svg = el('svg', { viewBox: `0 0 ${map.w} ${map.h}`, class: 'map-svg', role: 'img', 'aria-label': `${map.title} outline map` });
  svg.append(el('rect', { x: 0, y: 0, width: map.w, height: map.h, class: 'map-sea' }));
  const base = el('g', { class: 'map-base' });
  for (const c of map.countries || []) base.append(el('path', { d: c.d, class: c.id === 'IND' ? 'map-land india' : 'map-land' }));
  for (const n of map.neighbours || []) base.append(el('path', { d: n.d, class: 'map-land' }));
  if (map.outline) base.append(el('path', { d: map.outline, class: 'map-land india' }));
  if (map.states) base.append(el('path', { d: map.states, class: 'map-states' }));
  for (const r of map.rivers || []) base.append(el('path', { d: r.d, class: 'map-river' }));
  if (labels && map.labels) for (const l of map.labels) if (l.area > 30000) { const t = el('text', { x: l.x, y: l.y, class: 'map-label', 'text-anchor': 'middle' }); t.textContent = l.name; base.append(t); }
  svg.append(base);
  const pins = el('g', { class: 'map-pins' });
  svg.append(pins);
  let vb = { x: 0, y: 0, w: map.w, h: map.h };
  const apply = () => svg.setAttribute('viewBox', `${vb.x} ${vb.y} ${vb.w} ${vb.h}`);
  const point = (evt) => {
    const pt = svg.createSVGPoint();
    pt.x = evt.clientX;
    pt.y = evt.clientY;
    const m = svg.getScreenCTM();
    return m ? pt.matrixTransform(m.inverse()) : { x: 0, y: 0 };
  };
  const zoom = (f, cx = vb.x + vb.w / 2, cy = vb.y + vb.h / 2) => {
    const w = Math.min(map.w, Math.max(map.w / 6, vb.w / f));
    const hgt = (w / map.w) * map.h;
    vb = { x: Math.max(0, Math.min(map.w - w, cx - w / 2)), y: Math.max(0, Math.min(map.h - hgt, cy - hgt / 2)), w, h: hgt };
    apply();
  };
  let drag = null;
  svg.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY, vb: { ...vb }, moved: false }; svg.setPointerCapture(e.pointerId); });
  svg.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 6) drag.moved = true;
    if (drag.moved && vb.w < map.w) {
      const scale = vb.w / svg.clientWidth;
      vb.x = Math.max(0, Math.min(map.w - vb.w, drag.vb.x - dx * scale));
      vb.y = Math.max(0, Math.min(map.h - vb.h, drag.vb.y - dy * scale));
      apply();
    }
  });
  svg.addEventListener('pointerup', (e) => {
    const d = drag;
    drag = null;
    if (!d || d.moved || !onTap) return;
    const p = point(e);
    // Pointer capture retargets pointerup to the svg: find what is really under the finger.
    const under = document.elementFromPoint(e.clientX, e.clientY) || e.target;
    onTap({ x: p.x, y: p.y, ...unproject(map, p.x, p.y), target: under });
  });
  svg.addEventListener('wheel', (e) => { e.preventDefault(); const p = point(e); zoom(e.deltaY < 0 ? 1.4 : 1 / 1.4, p.x, p.y); }, { passive: false });
  return { svg, pins, zoom, point, reset: () => { vb = { x: 0, y: 0, w: map.w, h: map.h }; apply(); } };
}

// A pin at an atom's place. kind: 'pin' | 'news' | 'answer' | 'guess'.
export function pin(map, lat, lon, { kind = 'pin', label = null, r = 6 } = {}) {
  const { x, y } = project(map, lat, lon);
  const g = el('g', { class: `map-pin ${kind}`, transform: `translate(${x},${y})` });
  g.append(el('circle', { r: r * 1.9, class: 'pin-hit' }), el('circle', { r, class: 'pin-dot' }));
  if (label) { const t = el('text', { x: r + 3, y: 4, class: 'pin-label' }); t.textContent = label; g.append(t); }
  return g;
}

export function line(map, a, b) {
  const p = project(map, a.lat, a.lon);
  const q = project(map, b.lat, b.lon);
  return el('line', { x1: p.x, y1: p.y, x2: q.x, y2: q.y, class: 'map-miss-line' });
}
