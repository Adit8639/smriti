// Promise wrapper around the data worker.

let worker = null;
let seq = 0;
const waiting = new Map();

function start() {
  worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = (e) => {
    const { id, ok, result, error } = e.data;
    const w = waiting.get(id);
    if (!w) return;
    waiting.delete(id);
    if (ok) w.resolve(result);
    else w.reject(new Error(error));
  };
  worker.onerror = (e) => {
    const err = new Error(`Data worker failed: ${e.message || 'could not start'}`);
    for (const w of waiting.values()) w.reject(err);
    waiting.clear();
    worker = null;
  };
}

export function call(cmd, args) {
  if (!worker) start();
  return new Promise((resolve, reject) => {
    const id = ++seq;
    waiting.set(id, { resolve, reject });
    worker.postMessage({ id, cmd, args });
  });
}
