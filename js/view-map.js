// Map Lab (#/map): atoms with geo {lat, lon} become pins on offline outline maps of India
// (official boundary) and the world. Drills: locate (tap the map where it is), identify
// (name the pin), cluster (several pins at once: tap each by name). Current-affairs places
// sit on a "news" layer. Answers are logged as practice; the schedule is unchanged.

import { h, clear, toast } from './ui.js';
import { app, appendEvents, flushState, emit } from './store.js';
import { loadMap, mapView, pin, line, haversineKm, inView, project } from './maps.js';
import { importDemoFile } from './view-data.js';
import { quarantineStatus } from './rebuild.js';
import { filled } from './cloze.js';
import { ulid } from './ulid.js';
import { rng, freshSeed } from './rng.js';
import * as clock from './clock.js';
import { plural } from './util.js';

const TOL = { india: 150, world: 600 };
const ROUNDS = 10;
let cleanup = null;
export function leave() {
  document.body.classList.remove('focus');
  if (cleanup) { try { cleanup(); } catch (_) { /* ignore */ } }
  cleanup = null;
}

async function geoAtoms() {
  const ca = new Set();
  for (const x of await app.db.getAll('ca')) for (const id of x.atoms || []) ca.add(id);
  return (await app.db.getAll('atoms')).filter((a) => {
    if (!a.geo || !Number.isFinite(a.geo.lat) || !Number.isFinite(a.geo.lon)) return false;
    const q = quarantineStatus(a, app.state);
    return q === 'clear' || q === 'approved';
  }).map((a) => ({ atom: a, news: ca.has(a.id) || !!a.eventDate, name: String(a.answer) }));
}

export async function render(route) {
  const host = h('div', { class: 'map-host' });
  const [mode = '', which = 'india'] = (route.arg || '').split('/');
  const mapId = route.query.get('map') || which || 'india';
  const all = await geoAtoms();
  if (!all.length) {
    host.append(h('section', { class: 'card' }, h('h2', { text: 'Map Lab' }),
      h('p', { text: 'Atoms with a place (geo latitude and longitude) become pins here: national parks, Ramsar sites, rivers, straits, places in the news.' }),
      h('p', { class: 'small muted', text: 'None of your atoms carry a place yet. Packs add them with the atom field geo {lat, lon}.' }),
      h('button', { class: 'btn primary', type: 'button', onclick: () => importDemoFile('demo-places-dates.json') }, 'Load the demo places and dates')));
    return host;
  }
  const map = await loadMap(mapId === 'world' ? 'world' : 'india');
  const pool = all.filter((p) => inView(map, p.atom.geo.lat, p.atom.geo.lon));
  if (mode === 'locate' || mode === 'identify' || mode === 'cluster') { setTimeout(() => drill(host, map, pool, mode, route.query.get('layer') === 'news'), 0); return host; }
  return explore(host, map, all, pool, route.query.get('layer') === 'news');
}

function explore(host, map, all, pool, newsOnly) {
  const shown = newsOnly ? pool.filter((p) => p.news) : pool;
  const info = h('p', { class: 'small map-info', text: 'Tap a pin to see the fact.' });
  const v = mapView(map, { onTap: (t) => { const g = t.target.closest && t.target.closest('.map-pin'); if (g && g.dataset.id) { const p = shown.find((x) => x.atom.id === g.dataset.id); if (p) info.textContent = filled(p.atom); } } });
  for (const p of shown) { const g = pin(map, p.atom.geo.lat, p.atom.geo.lon, { kind: p.news ? 'news' : 'pin' }); g.dataset.id = p.atom.id; v.pins.append(g); }
  const other = map.id === 'india' ? 'world' : 'india';
  const enough = pool.length >= 4;
  host.append(h('div', { class: 'map-lab' },
    h('section', { class: 'card' },
      h('div', { class: 'row-between' }, h('h2', { text: `Map Lab: ${map.title}` }), h('a', { class: 'btn small', href: `#/map/explore/${other}` }, other === 'world' ? 'World map' : 'India map')),
      h('p', { class: 'small muted', text: `${plural(pool.length, 'place')} on this map (${pool.filter((p) => p.news).length} in the news), ${all.length} in all.` }),
      h('div', { class: 'button-row' },
        h('a', { class: `btn${enough ? ' primary' : ''}`, href: enough ? `#/map/locate/${map.id}` : null, 'aria-disabled': enough ? null : 'true' }, 'Locate drill'),
        h('a', { class: 'btn', href: enough ? `#/map/identify/${map.id}` : null, 'aria-disabled': enough ? null : 'true' }, 'Identify drill'),
        h('a', { class: 'btn', href: enough ? `#/map/cluster/${map.id}` : null, 'aria-disabled': enough ? null : 'true' }, 'Cluster drill')),
      !enough ? h('p', { class: 'small warn-text', text: 'Drills need at least four places on this map.' }) : null,
      h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: newsOnly ? true : null, onchange: (e) => { location.hash = `#/map/explore/${map.id}${e.target.checked ? '?layer=news' : ''}`; } }), h('span', { text: 'News layer only (places from current affairs)' }))),
    h('div', { class: 'map-frame' }, v.svg, h('div', { class: 'map-zoom' }, h('button', { class: 'btn small', type: 'button', 'aria-label': 'Zoom in', onclick: () => v.zoom(1.6) }, '+'), h('button', { class: 'btn small', type: 'button', 'aria-label': 'Zoom out', onclick: () => v.zoom(1 / 1.6) }, '−'), h('button', { class: 'btn small', type: 'button', onclick: () => v.reset() }, 'Reset'))),
    info,
    h('p', { class: 'tiny muted', text: `${map.source} India is shown with its official boundary.` })));
  return host;
}

async function drill(host, map, poolAll, mode, newsOnly) {
  const pool = newsOnly ? poolAll.filter((p) => p.news) : poolAll;
  if (pool.length < 4) { toast('Drills need at least four places on this map.', { kind: 'warn' }); location.hash = `#/map/explore/${map.id}`; return; }
  const r = rng(freshSeed(clock.now()));
  const sessionId = ulid(clock.now());
  await appendEvents([['session.started', { sessionId, kind: 'map' }]]);
  cleanup = () => appendEvents([['session.ended', { sessionId }]]).catch(() => {});
  document.body.classList.add('focus');
  const order = r.shuffle(pool);
  // Cluster rounds: groups of four places far enough apart that a tap cannot hit the
  // wrong pin.
  const groups = [];
  if (mode === 'cluster') {
    const left = order.slice();
    const far = (a, b) => { const pa = project(map, a.atom.geo.lat, a.atom.geo.lon); const pb = project(map, b.atom.geo.lat, b.atom.geo.lon); return Math.hypot(pa.x - pb.x, pa.y - pb.y) >= 36; };
    while (left.length >= 4 && groups.length < 3) {
      const g = [];
      for (let k = 0; k < left.length && g.length < 4; k++) if (g.every((x) => far(x, left[k]))) g.push(left[k]);
      if (g.length < 4) break;
      groups.push(g);
      for (const x of g) left.splice(left.indexOf(x), 1);
    }
    if (!groups.length) groups.push(order.slice(0, 4));
  }
  const rounds = mode === 'cluster' ? groups.length : Math.min(ROUNDS, pool.length);
  let i = 0;
  let right = 0;
  let total = 0;
  const log = async (p, correct, ms, extra = {}) => {
    total++;
    if (correct) right++;
    await appendEvents([['review.done', { atomId: p.atom.id, probeId: `map:${mode}:${p.atom.id}`, format: 'map', mode: 'practice', correct, partial: false, confidence: null, ms, target: null, suggested: null, rating: null, sessionId, response: extra }]]).catch(() => {});
  };
  const next = () => { i++; if (i < rounds) show(); else finish(); };
  const frameFor = (title, prompt, v, foot) => {
    clear(host).append(h('div', { class: 'rv map-drill' },
      h('div', { class: 'rv-head' }, h('button', { class: 'btn small', type: 'button', onclick: () => { location.hash = `#/map/explore/${map.id}`; } }, 'End'), h('div', { class: 'rv-title' }, h('strong', { text: title }), h('span', { class: 'rv-count', text: ` · ${i + 1} / ${rounds}` })), h('span')),
      h('div', { class: 'rv-body' }, prompt, h('div', { class: 'map-frame' }, v.svg, h('div', { class: 'map-zoom' }, h('button', { class: 'btn small', type: 'button', 'aria-label': 'Zoom in', onclick: () => v.zoom(1.6) }, '+'), h('button', { class: 'btn small', type: 'button', 'aria-label': 'Zoom out', onclick: () => v.zoom(1 / 1.6) }, '−')))),
      h('div', { class: 'rv-foot' }, foot)));
  };
  const show = () => {
    const t0 = performance.now();
    if (mode === 'locate') {
      const p = order[i];
      const verdict = h('p', { class: 'map-verdict', 'aria-live': 'polite' });
      const foot = h('div', { class: 'foot-row' }, h('p', { class: 'small muted', text: 'Tap the map where it is. Drag to pan, + to zoom.' }));
      let done = false;
      const v = mapView(map, {
        onTap: async (t) => {
          if (done) return;
          done = true;
          const km = Math.round(haversineKm({ lat: t.lat, lon: t.lon }, p.atom.geo));
          const ok = km <= TOL[map.id];
          v.pins.append(line(map, { lat: t.lat, lon: t.lon }, p.atom.geo), pin(map, t.lat, t.lon, { kind: 'guess' }), pin(map, p.atom.geo.lat, p.atom.geo.lon, { kind: 'answer', label: p.name }));
          verdict.textContent = `${ok ? 'Close enough' : 'Off'}: ${km} km away (within ${TOL[map.id]} km counts). ${filled(p.atom)}`;
          verdict.className = `map-verdict ${ok ? 'ok-text' : 'error-text'}`;
          await log(p, ok, Math.round(performance.now() - t0), { km });
          clear(foot).append(h('button', { class: 'btn primary grow', type: 'button', onclick: next }, i < rounds - 1 ? 'Next' : 'Finish'));
        },
      });
      frameFor('Locate', h('div', null, h('p', { class: 'question', text: `Where is ${p.name}?` }), verdict), v, foot);
    } else if (mode === 'identify') {
      const p = order[i];
      const others = r.sample(pool.filter((x) => x.name !== p.name), 3).map((x) => x.name);
      const opts = r.shuffle([p.name, ...others]);
      const v = mapView(map);
      v.pins.append(pin(map, p.atom.geo.lat, p.atom.geo.lon, { kind: 'answer', r: 7 }));
      const verdict = h('p', { class: 'map-verdict', 'aria-live': 'polite' });
      const foot = h('div', { class: 'opts map-opts' });
      opts.forEach((o) => foot.append(h('button', {
        class: 'opt', type: 'button',
        onclick: async () => {
          if (foot.dataset.done) return;
          foot.dataset.done = '1';
          const ok = o === p.name;
          [...foot.children].forEach((b, k) => { b.disabled = true; if (opts[k] === p.name) b.classList.add('right'); else if (opts[k] === o) b.classList.add('wrong'); });
          verdict.textContent = filled(p.atom);
          await log(p, ok, Math.round(performance.now() - t0), { choice: o });
          foot.append(h('button', { class: 'btn primary block-btn', type: 'button', onclick: next }, i < rounds - 1 ? 'Next' : 'Finish'));
        },
      }, h('span', { class: 'opt-text', text: o }))));
      frameFor('Identify', h('div', null, h('p', { class: 'question', text: 'Which place is marked?' }), verdict), v, foot);
    } else {
      // Cluster: four pins at once, numbered; tap the pin for each name in turn.
      const group = groups[i];
      const v = mapView(map, {
        onTap: async (t) => {
          const g = t.target.closest && t.target.closest('.map-pin');
          if (!g || !g.dataset.id || k >= group.length) return;
          const p = group[k];
          const ok = g.dataset.id === p.atom.id;
          g.classList.add(ok ? 'ok' : 'bad');
          await log(p, ok, Math.round(performance.now() - t0), { picked: g.dataset.id });
          k++;
          if (k < group.length) prompt.textContent = `Tap: ${group[k].name}`;
          else { prompt.textContent = 'Done: names shown.'; group.forEach((x) => v.pins.append(pin(map, x.atom.geo.lat, x.atom.geo.lon, { kind: 'answer', label: x.name }))); clear(foot).append(h('button', { class: 'btn primary grow', type: 'button', onclick: next }, i < rounds - 1 ? 'Next cluster' : 'Finish')); }
        },
      });
      let k = 0;
      r.shuffle(group).forEach((p, n) => { const g = pin(map, p.atom.geo.lat, p.atom.geo.lon, { kind: 'pin', label: String(n + 1), r: 7 }); g.dataset.id = p.atom.id; v.pins.append(g); });
      const prompt = h('p', { class: 'question', text: `Tap: ${group[0].name}` });
      const foot = h('div', { class: 'foot-row' }, h('p', { class: 'small muted', text: 'Four places at once: tap each one as it is named.' }));
      frameFor('Cluster', prompt, v, foot);
    }
  };
  const finish = async () => {
    cleanup = null;
    await appendEvents([['session.ended', { sessionId }]]).catch(() => {});
    flushState();
    document.body.classList.remove('focus');
    clear(host).append(h('div', { class: 'focus-frame' }, h('div', { class: 'card summary' }, h('h2', { text: 'Drill done' }),
      h('p', { class: 'big-number' }, h('strong', { text: `${right} / ${total}` }), ' right'),
      h('div', { class: 'button-row' }, h('button', { class: 'btn primary', type: 'button', onclick: () => emit('rerender') }, 'Again'), h('a', { class: 'btn', href: `#/map/explore/${map.id}` }, 'Map Lab')))));
  };
  show();
}
