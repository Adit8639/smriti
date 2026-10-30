// Boot, routing, bottom navigation, banners and keyboard shortcuts.

import { h, clear, icon, toast, closeSheet, closeLayers, canShareFiles } from './ui.js';
import { app, initStore, loadProfiles, loadNodes, loadDerived, applyDerived, subscribe, getSetting, setSetting, flushState } from './store.js';
import { seedProfiles } from './profiles.js';
import { registerSW, onPwaChange, pwa, applyUpdate, promptInstall, requestPersist } from './pwa.js';
import { call } from './data.js';
import * as clock from './clock.js';
import { daysBetween, localDate, formatDate } from './util.js';
import * as library from './view-library.js';
import * as quarantine from './view-quarantine.js';
import * as dataView from './view-data.js';
import * as settings from './view-settings.js';
import * as today from './view-today.js';
import * as review from './view-review.js';
import * as leech from './view-leech.js';
import * as learn from './view-learn.js';
import * as notes from './view-notes.js';
import * as booklet from './view-booklet.js';
import * as sources from './view-sources.js';
import * as reader from './view-reader.js';
import * as labs from './view-labs.js';
import * as lab from './view-lab.js';
import * as mock from './view-mock.js';
import * as csat from './view-csat.js';
import * as progress from './view-progress.js';
import * as more from './view-more.js';
import * as mains from './view-mains.js';
import * as caView from './view-ca.js';
import * as intake from './view-intake.js';

const ROUTES = {
  today: { view: today, title: 'Today', nav: 'today' },
  review: { view: review, title: 'Review', nav: 'today' },
  practice: { view: review, title: 'Practice', nav: 'library' },
  quarantine: { view: quarantine, title: 'Quarantine', nav: 'today' },
  leeches: { view: leech, title: 'Leeches', nav: 'today' },
  rebuild: { view: leech, title: 'Rebuild', nav: 'today' },
  library: { view: library, title: 'Library', nav: 'library' },
  node: { view: library, title: 'Topic', nav: 'library' },
  learn: { view: learn, title: 'Learn Loop', nav: 'library' },
  notes: { view: notes, title: 'Notes', nav: 'library' },
  booklet: { view: booklet, title: 'Booklet', nav: 'library' },
  labs: { view: labs, title: 'Labs', nav: 'labs' },
  lab: { view: lab, title: 'Prelims Lab', nav: 'labs' },
  mock: { view: mock, title: 'Mock', nav: 'labs' },
  csat: { view: csat, title: 'CSAT Gym', nav: 'labs' },
  mains: { view: mains, title: 'Mains Studio', nav: 'labs' },
  ca: { view: caView, title: 'CA–Static Bridge', nav: 'labs' },
  intake: { view: intake, title: 'Intake', nav: 'labs' },
  triage: { view: intake, title: 'Triage', nav: 'labs' },
  progress: { view: progress, title: 'Progress', nav: 'progress' },
  more: { view: more, title: 'More', nav: 'more' },
  sources: { view: sources, title: 'Sources', nav: 'more' },
  reader: { view: reader, title: 'Reader', nav: 'more' },
  data: { view: dataView, title: 'Data', nav: 'more' },
  settings: { view: settings, title: 'Settings', nav: 'more' },
};

const NAV = [
  ['today', 'Today', 'today'],
  ['library', 'Library', 'library'],
  ['labs', 'Labs', 'labs'],
  ['progress', 'Progress', 'progress'],
  ['more', 'More', 'more'],
];

const BACKUP_DAYS = 7;
let dismissedInstall = false;
const bootProblems = [];

function parseRoute() {
  const raw = location.hash.replace(/^#\/?/, '');
  const [path, query = ''] = raw.split('?');
  const [name, ...rest] = path.split('/');
  const route = ROUTES[name] ? name : 'today';
  return { name: route, arg: rest.length ? decodeURIComponent(rest.join('/')) : null, query: new URLSearchParams(query) };
}

function renderNav() {
  const nav = document.getElementById('nav');
  clear(nav);
  const current = ROUTES[parseRoute().name].nav;
  const q = app.derived.summary ? app.derived.summary.quarantine : 0;
  for (const [route, label, ic] of NAV) {
    nav.append(h('a', { href: `#/${route}`, class: `nav-item${current === route ? ' active' : ''}`, 'aria-current': current === route ? 'page' : null },
      icon(ic),
      h('span', { class: 'nav-label', text: label }),
      route === 'today' && q ? h('span', { class: 'nav-badge', text: String(q), 'aria-label': `${q} atoms waiting in Quarantine` }) : null));
  }
}

let renderSeq = 0;
let lastPath = null;
let lastView = null;
async function render() {
  const r = parseRoute();
  const def = ROUTES[r.name];
  const main = document.getElementById('view');
  const seq = ++renderSeq;
  const path = `${r.name}/${r.arg || ''}?${r.query}`;
  const moved = path !== lastPath;
  lastPath = path;
  // A view that holds a session or timers gets a chance to wrap up when you leave it.
  if (moved && lastView && lastView.leave) lastView.leave();
  if (moved) closeLayers();
  lastView = def.view;
  document.getElementById('view-title').textContent = def.title;
  renderNav();
  try {
    const frag = await def.view.render(r);
    if (seq !== renderSeq) return;
    clear(main).append(frag);
    if (moved && !r.query.get('focus')) window.scrollTo(0, 0);
  } catch (e) {
    if (seq !== renderSeq) return;
    clear(main).append(h('div', { class: 'card error' }, h('h2', { text: 'Something went wrong' }), h('p', { text: e.message })));
    console.error(e);
  }
}

function backupBanner() {
  const mine = app.state.devices[app.device.deviceId];
  const last = mine && mine.lastExportTs;
  const since = last ?? app.firstRunAt;
  const days = daysBetween(localDate(since), localDate(clock.now()));
  if (days <= BACKUP_DAYS) return null;
  const text = last ? `Last backup from this device was ${days} days ago.` : `No backup from this device yet (${days} days since first use).`;
  return h('div', { class: 'banner warn' }, h('span', { text: `${text} Your progress lives only in this browser.` }),
    h('button', { class: 'btn small', onclick: () => dataView.exportNow(canShareFiles()) }, 'Back up now'));
}

function renderBanners() {
  const box = clear(document.getElementById('banners'));
  if (pwa.updateReady) {
    box.append(h('div', { class: 'banner info' }, h('span', { text: 'A new version of SMRITI is ready.' }),
      h('button', { class: 'btn small primary', onclick: applyUpdate }, 'Reload to update')));
  }
  if (clock.getOffset()) {
    const days = Math.round(clock.getOffset() / 86400000);
    box.append(h('div', { class: 'banner test' }, h('span', { text: `Test clock on: app date is ${formatDate(localDate(clock.now()))} (${days >= 0 ? '+' : ''}${days} days). New events get this time.` }),
      h('a', { class: 'btn small', href: '#/settings' }, 'Change')));
  }
  if (pwa.swError) box.append(h('div', { class: 'banner error' }, h('span', { text: pwa.swError })));
  for (const p of bootProblems) box.append(h('div', { class: 'banner error' }, h('span', { text: p })));
  if (app.device) {
    const b = backupBanner();
    if (b) box.append(b);
  }
  if (pwa.canInstall && !pwa.installed && !dismissedInstall) {
    box.append(h('div', { class: 'banner info' }, h('span', { text: 'Install SMRITI for one-tap, offline use.' }),
      h('button', { class: 'btn small primary', onclick: async () => { const r = await promptInstall(); if (r === 'accepted') toast('Installed.'); } }, 'Install'),
      h('button', { class: 'btn small', onclick: () => { dismissedInstall = true; renderBanners(); } }, 'Not now')));
  }
}

function renderNet() {
  const el = document.getElementById('net');
  el.textContent = navigator.onLine ? '' : 'Offline';
  el.hidden = navigator.onLine;
}

function isTyping(e) {
  const t = e.target;
  return t && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName));
}

function onKey(e) {
  if (e.key === 'Escape') { if (closeSheet()) e.preventDefault(); return; }
  if (isTyping(e) || e.ctrlKey || e.metaKey || e.altKey || document.body.classList.contains('sheet-open')) return;
  if (document.body.classList.contains('focus')) return;
  if (e.key === '/') {
    e.preventDefault();
    if (parseRoute().name !== 'library') location.hash = '#/library';
    setTimeout(() => { const s = document.getElementById('lib-search'); if (s) s.focus(); }, 60);
  } else if (e.key === 'j' || e.key === 'k') {
    const items = [...document.querySelectorAll('#view [data-nav]')];
    if (!items.length) return;
    e.preventDefault();
    const i = items.indexOf(document.activeElement);
    const next = e.key === 'j' ? (i < 0 ? 0 : Math.min(items.length - 1, i + 1)) : (i < 0 ? 0 : Math.max(0, i - 1));
    items[next].focus();
    items[next].scrollIntoView({ block: 'nearest' });
  }
}

async function firstRunStorage() {
  const before = await getSetting('persist');
  const granted = await requestPersist();
  await setSetting('persist', { granted, at: Date.now() });
  if (!before) {
    if (granted === true) toast('Storage is persistent: the browser will not clear it under storage pressure.', { kind: 'ok', ms: 6000 });
    else if (granted === false) toast('Storage is best-effort for now. Installing SMRITI usually makes it persistent; see Settings.', { kind: 'warn', ms: 8000 });
    else toast('This browser cannot make storage persistent; export backups regularly.', { kind: 'warn', ms: 8000 });
  }
}

async function boot() {
  registerSW();
  onPwaChange(renderBanners);
  window.addEventListener('online', renderNet);
  window.addEventListener('offline', renderNet);
  renderNet();
  document.addEventListener('keydown', onKey);

  try {
    await initStore();
  } catch (e) {
    clear(document.getElementById('view')).append(h('div', { class: 'card error' },
      h('h2', { text: 'Storage is unavailable' }),
      h('p', { text: `SMRITI keeps everything in this browser's IndexedDB, which could not be opened: ${e.message}. Private/incognito windows and some browser settings block it.` })));
    return;
  }

  await loadProfiles();
  // Load bundled profiles: blocking on first run (the library needs them), background later.
  const seed = seedProfiles(app.db, document.baseURI).then(async (problems) => {
    bootProblems.push(...problems.map((p) => `Profile not loaded — ${p}`));
    const before = app.profiles.map((p) => `${p.id}@${p.version}`).join();
    await loadProfiles();
    if (app.profiles.map((p) => `${p.id}@${p.version}`).join() !== before) {
      await call('search.reset');
      await applyDerived(await call('refresh'));
    }
    renderBanners();
  }).catch((e) => {
    if (!app.profiles.length) bootProblems.push(`Exam profiles could not be loaded (${e.message}). Connect once to finish setup.`);
  });
  if (!app.profiles.length) await seed;

  await loadNodes();
  try {
    await loadDerived();
  } catch (e) {
    bootProblems.push(`Could not rebuild the cache: ${e.message}`);
  }

  // 'derived' = content or caches changed (imports, uninstalls, exports): redraw the view,
  // except during a focus-mode session, which manages its own screen.
  subscribe((what) => {
    const focus = document.body.classList.contains('focus');
    // During a focus-mode session the bar and banners are hidden: skip redrawing them per answer.
    if (!focus || what !== 'state') { renderNav(); renderBanners(); }
    if (what === 'rerender' || (what === 'derived' && !focus)) render();
  });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushState(); });
  window.addEventListener('hashchange', render);
  renderBanners();
  await render();
  firstRunStorage();
}

boot();
