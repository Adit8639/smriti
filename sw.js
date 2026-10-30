// SMRITI service worker: versioned, cache-first app shell. Bump VERSION on every release
// (it must equal APP_VERSION in js/version.js); the page then shows "Reload to update".

const VERSION = '1.0.0';
const CACHE = `smriti-shell-${VERSION}`;

/* ASSETS:START */
const ASSETS = [
  './',
  './index.html',
  './app.css',
  './manifest.webmanifest',
  './sw.js',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './js/app.js',
  './js/backup.js',
  './js/clock.js',
  './js/data.js',
  './js/db.js',
  './js/derived.js',
  './js/events.js',
  './js/integrity.js',
  './js/packs.js',
  './js/profiles.js',
  './js/pwa.js',
  './js/rebuild.js',
  './js/schema.js',
  './js/search.js',
  './js/store.js',
  './js/tree.js',
  './js/ui.js',
  './js/ulid.js',
  './js/util.js',
  './js/version.js',
  './js/view-data.js',
  './js/view-library.js',
  './js/view-quarantine.js',
  './js/view-settings.js',
  './js/worker.js',
  './vendor/minisearch/minisearch.js',
  './profiles/index.json',
  './profiles/cse-2028.json',
  './profiles/capf-ac-2027.json',
  './packs/demo/index.json',
  './packs/demo/demo-polity-syllabus.json',
  './packs/demo/demo-polity.json',
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

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    try {
      return await fetch(req);
    } catch (err) {
      if (req.mode === 'navigate') {
        const shell = await cache.match(url.pathname.endsWith('/tests/') ? './tests/index.html' : './index.html');
        if (shell) return shell;
      }
      throw err;
    }
  })());
});
