// Service worker registration, "Reload to update", install prompt and storage status.

export const pwa = {
  updateReady: false,
  canInstall: false,
  installed: matchMedia('(display-mode: standalone)').matches,
  swError: null,
};

const listeners = new Set();
export const onPwaChange = (fn) => listeners.add(fn);
const changed = () => { for (const fn of listeners) fn(); };

let waiting = null;
let reloadOnChange = false;
let deferredPrompt = null;

export async function registerSW() {
  if (!('serviceWorker' in navigator)) {
    pwa.swError = 'This browser has no service worker support, so the app cannot work offline.';
    changed();
    return;
  }
  try {
    const reg = await navigator.serviceWorker.register('./sw.js');
    const markReady = (w) => { waiting = w; pwa.updateReady = true; changed(); };
    const watch = (w) => {
      if (!w) return;
      w.addEventListener('statechange', () => {
        if (w.state === 'installed' && navigator.serviceWorker.controller) markReady(w);
      });
    };
    if (reg.waiting && navigator.serviceWorker.controller) markReady(reg.waiting);
    watch(reg.installing);
    reg.addEventListener('updatefound', () => watch(reg.installing));
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloadOnChange) location.reload();
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') reg.update().catch(() => {});
    });
  } catch (e) {
    pwa.swError = `Offline cache could not start: ${e.message}`;
    changed();
  }
}

export function applyUpdate() {
  reloadOnChange = true;
  if (waiting) waiting.postMessage({ type: 'SKIP_WAITING' });
  // If the new worker activated in another tab already, a plain reload picks it up.
  setTimeout(() => location.reload(), 3000);
}

// Version string of the service worker controlling this page, or null.
export function swVersion() {
  const c = navigator.serviceWorker && navigator.serviceWorker.controller;
  if (!c) return Promise.resolve(null);
  return new Promise((resolve) => {
    const ch = new MessageChannel();
    const t = setTimeout(() => resolve(null), 1500);
    ch.port1.onmessage = (e) => { clearTimeout(t); resolve(e.data && e.data.version); };
    c.postMessage({ type: 'GET_VERSION' }, [ch.port2]);
  });
}

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  pwa.canInstall = true;
  changed();
});

window.addEventListener('appinstalled', () => {
  deferredPrompt = null;
  pwa.canInstall = false;
  pwa.installed = true;
  changed();
});

export async function promptInstall() {
  if (!deferredPrompt) return null;
  deferredPrompt.prompt();
  const choice = await deferredPrompt.userChoice;
  deferredPrompt = null;
  pwa.canInstall = false;
  changed();
  return choice.outcome;
}

export async function storageInfo() {
  const s = navigator.storage;
  const est = s && s.estimate ? await s.estimate() : null;
  const persisted = s && s.persisted ? await s.persisted() : null;
  return { usage: est ? est.usage : null, quota: est ? est.quota : null, persisted };
}

export async function requestPersist() {
  const s = navigator.storage;
  if (!s || !s.persist) return null;
  return s.persist();
}
