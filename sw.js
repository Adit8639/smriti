// SMRITI service worker: versioned, cache-first app shell. Bump VERSION on every release
// (it must equal APP_VERSION in js/version.js); the page then shows "Reload to update".

const VERSION = '1.6.0';
const CACHE = `smriti-shell-${VERSION}`;

/* ASSETS:START */
const ASSETS = [
  './',
  './index.html',
  './app.css',
  './manifest.webmanifest',
  './sw.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/icon.svg',
  './js/anki.js',
  './js/app.js',
  './js/backup.js',
  './js/calib.js',
  './js/charts.js',
  './js/clock.js',
  './js/cloze.js',
  './js/confusion.js',
  './js/csat.js',
  './js/dash.js',
  './js/data.js',
  './js/db.js',
  './js/derived.js',
  './js/dictate.js',
  './js/embed-worker.js',
  './js/embed.js',
  './js/events.js',
  './js/fsrs.js',
  './js/intake.js',
  './js/integrity.js',
  './js/labdata.js',
  './js/links.js',
  './js/mains-flows.js',
  './js/mains-ui.js',
  './js/mains.js',
  './js/maps.js',
  './js/mission.js',
  './js/mockgen.js',
  './js/packs.js',
  './js/pdf.js',
  './js/probe-ui.js',
  './js/probes.js',
  './js/profiles.js',
  './js/pwa.js',
  './js/pyq.js',
  './js/queue.js',
  './js/rebuild.js',
  './js/rng.js',
  './js/schema.js',
  './js/search.js',
  './js/session.js',
  './js/sheets.js',
  './js/sources.js',
  './js/store.js',
  './js/study.js',
  './js/tree.js',
  './js/ui.js',
  './js/ulid.js',
  './js/util.js',
  './js/version.js',
  './js/view-booklet.js',
  './js/view-ca.js',
  './js/view-commute.js',
  './js/view-csat.js',
  './js/view-data.js',
  './js/view-health.js',
  './js/view-intake.js',
  './js/view-lab.js',
  './js/view-labs.js',
  './js/view-learn.js',
  './js/view-leech.js',
  './js/view-library.js',
  './js/view-mains.js',
  './js/view-map.js',
  './js/view-mission.js',
  './js/view-mock.js',
  './js/view-more.js',
  './js/view-notes.js',
  './js/view-progress.js',
  './js/view-quarantine.js',
  './js/view-reader.js',
  './js/view-review.js',
  './js/view-settings.js',
  './js/view-sources.js',
  './js/view-timeline.js',
  './js/view-today.js',
  './js/view-weekly.js',
  './js/weights.js',
  './js/worker.js',
  './vendor/minisearch/minisearch.js',
  './vendor/ts-fsrs/ts-fsrs.umd.js',
  './vendor/pdfjs/pdf.min.mjs',
  './vendor/pdfjs/pdf.worker.min.mjs',
  './vendor/pdfjs/standard_fonts/FoxitDingbats.pfb',
  './vendor/pdfjs/standard_fonts/FoxitFixed.pfb',
  './vendor/pdfjs/standard_fonts/FoxitFixedBold.pfb',
  './vendor/pdfjs/standard_fonts/FoxitFixedBoldItalic.pfb',
  './vendor/pdfjs/standard_fonts/FoxitFixedItalic.pfb',
  './vendor/pdfjs/standard_fonts/FoxitSerif.pfb',
  './vendor/pdfjs/standard_fonts/FoxitSerifBold.pfb',
  './vendor/pdfjs/standard_fonts/FoxitSerifBoldItalic.pfb',
  './vendor/pdfjs/standard_fonts/FoxitSerifItalic.pfb',
  './vendor/pdfjs/standard_fonts/FoxitSymbol.pfb',
  './vendor/pdfjs/standard_fonts/LiberationSans-Bold.ttf',
  './vendor/pdfjs/standard_fonts/LiberationSans-BoldItalic.ttf',
  './vendor/pdfjs/standard_fonts/LiberationSans-Italic.ttf',
  './vendor/pdfjs/standard_fonts/LiberationSans-Regular.ttf',
  './vendor/pdfjs/wasm/jbig2.wasm',
  './vendor/pdfjs/wasm/openjpeg.wasm',
  './vendor/pdfjs/wasm/qcms_bg.wasm',
  './vendor/pdfjs/iccs/CGATS001Compat-v2-micro.icc',
  './vendor/maps/india.json',
  './vendor/maps/world.json',
  './profiles/capf-ac-2027.json',
  './profiles/cse-2028.json',
  './profiles/index.json',
  './packs/demo/demo-places-dates.json',
  './packs/demo/demo-polity-syllabus.json',
  './packs/demo/demo-polity.json',
  './packs/demo/demo-source.pdf',
  './packs/demo/index.json',
  './tests/',
  './tests/index.html',
  './tests/tests.js',
  './tests/fixtures.js',
];
/* ASSETS:END */

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // cache: 'reload' skips the HTTP cache so a new version never mixes in stale files.
    await cache.addAll(ASSETS.map((u) => new Request(u, { cache: 'reload' })));
    // The very first install takes over at once; later versions wait for "Reload to update".
    if (!self.registration.active) await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith('smriti-shell-') && key !== CACHE) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  const msg = event.data || {};
  if (msg.type === 'SKIP_WAITING') self.skipWaiting();
  else if (msg.type === 'GET_VERSION' && event.ports[0]) event.ports[0].postMessage({ version: VERSION });
});

// Large files loaded only on first use (the topic-matching model and its runtime) live in
// a cache that outlasts app updates, so they are downloaded once.
const LAZY = 'smriti-lazy-v1';
const isLazy = (path) => path.includes('/vendor/ort/') || path.includes('/vendor/minilm/');

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (isLazy(url.pathname)) {
    event.respondWith((async () => {
      const lazy = await caches.open(LAZY);
      const hit = await lazy.match(req, { ignoreSearch: true });
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) await lazy.put(req, res.clone());
      return res;
    })());
    return;
  }
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    try {
      const res = await fetch(req);
      // Anything else pdf.js asks for under /vendor/pdfjs/ is kept for offline use.
      if (res.ok && url.pathname.includes('/vendor/pdfjs/')) cache.put(req, res.clone());
      return res;
    } catch (err) {
      if (req.mode === 'navigate') {
        const shell = await cache.match(url.pathname.endsWith('/tests/') ? './tests/index.html' : './index.html');
        if (shell) return shell;
      }
      throw err;
    }
  })());
});
