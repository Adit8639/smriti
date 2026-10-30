// IndexedDB wrapper. Works in the page, the data worker and the /tests page (which uses
// throwaway database names so it never touches real data).

export const DB_NAME = 'smriti';
export const DB_VERSION = 1;

// [name, keyPath, indexes as [indexName, keyPath, multiEntry]]
const STORE_DEFS = [
  ['settings', 'key', []],
  ['profiles', 'id', []],
  ['nodes', 'id', [['_pack', '_pack'], ['parent', 'parent']]],
  ['packs', 'id', []],
  ['atoms', 'id', [['_pack', '_pack'], ['nodes', 'nodes', true]]],
  ['probes', 'id', [['_pack', '_pack'], ['atoms', 'atoms', true]]],
  ['pyqs', 'id', [['_pack', '_pack'], ['nodes', 'nodes', true]]],
  ['ca', 'id', [['_pack', '_pack'], ['anchors', 'anchors', true]]],
  ['answers', 'id', [['_pack', '_pack'], ['paper', 'paper']]],
  ['notes', 'id', [['_pack', '_pack'], ['node', 'node']]],
  ['sources', 'id', []],
  ['events', 'id', [['ts', 'ts'], ['type', 'type'], ['deviceId', 'deviceId']]],
  ['cache', 'key', []],
];

export const STORES = STORE_DEFS.map((d) => d[0]);
// Stores filled from content packs; every record carries _pack (pack id) and _v (pack version).
export const CONTENT_STORES = ['nodes', 'atoms', 'probes', 'pyqs', 'ca', 'answers', 'notes'];

const req = (r) => new Promise((resolve, reject) => {
  r.onsuccess = () => resolve(r.result);
  r.onerror = () => reject(r.error);
});

export function openDB(name = DB_NAME) {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(name, DB_VERSION);
    r.onupgradeneeded = () => {
      const idb = r.result;
      for (const [store, keyPath, indexes] of STORE_DEFS) {
        if (idb.objectStoreNames.contains(store)) continue;
        const os = idb.createObjectStore(store, { keyPath });
        for (const [iname, ipath, multiEntry] of indexes) os.createIndex(iname, ipath, { multiEntry: !!multiEntry });
      }
    };
    r.onsuccess = () => {
      const idb = r.result;
      // Another tab opened a newer schema: close so its upgrade can proceed.
      idb.onversionchange = () => idb.close();
      resolve(new DB(idb, name));
    };
    r.onerror = () => reject(r.error);
    r.onblocked = () => reject(new Error('The database is blocked by another open SMRITI tab. Close other tabs and reload.'));
  });
}

export function deleteDB(name) {
  return new Promise((resolve, reject) => {
    const r = indexedDB.deleteDatabase(name);
    r.onsuccess = () => resolve();
    r.onerror = () => reject(r.error);
    r.onblocked = () => resolve();
  });
}

export class DB {
  constructor(idb, name) {
    this.idb = idb;
    this.name = name;
  }

  // Runs fn(stores, tx) synchronously inside one transaction and resolves with fn's return
  // value once the transaction has committed. fn must only queue requests (no awaits).
  tx(names, mode, fn, durability = 'default') {
    return new Promise((resolve, reject) => {
      const list = [].concat(names);
      let t;
      try {
        t = this.idb.transaction(list, mode, { durability });
      } catch (e) {
        reject(e);
        return;
      }
      let result;
      t.oncomplete = () => resolve(result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error || new Error('Transaction aborted'));
      const stores = {};
      for (const n of list) stores[n] = t.objectStore(n);
      try {
        result = fn(stores, t);
      } catch (e) {
        try { t.abort(); } catch (_) { /* already finished */ }
        reject(e);
      }
    });
  }

  get(store, key) {
    return req(this.idb.transaction(store).objectStore(store).get(key));
  }

  getAll(store) {
    return req(this.idb.transaction(store).objectStore(store).getAll());
  }

  getAllByIndex(store, index, key) {
    return req(this.idb.transaction(store).objectStore(store).index(index).getAll(key));
  }

  count(store) {
    return req(this.idb.transaction(store).objectStore(store).count());
  }

  put(store, value, durability) {
    return this.tx(store, 'readwrite', (s) => { s[store].put(value); }, durability);
  }

  putMany(store, values) {
    return this.tx(store, 'readwrite', (s) => { for (const v of values) s[store].put(v); });
  }

  delete(store, key) {
    return this.tx(store, 'readwrite', (s) => { s[store].delete(key); });
  }

  // [[primaryKey, indexKey], ...] without loading record values.
  keyPairs(store, index) {
    return new Promise((resolve, reject) => {
      const out = [];
      const r = this.idb.transaction(store).objectStore(store).index(index).openKeyCursor();
      r.onsuccess = () => {
        const c = r.result;
        if (!c) { resolve(out); return; }
        out.push([c.primaryKey, c.key]);
        c.continue();
      };
      r.onerror = () => reject(r.error);
    });
  }

  close() {
    this.idb.close();
  }
}

// Deletes every record whose index value equals key, inside an already-open transaction.
export function deleteByIndex(objectStore, index, key) {
  const r = objectStore.index(index).openKeyCursor(IDBKeyRange.only(key));
  r.onsuccess = () => {
    const c = r.result;
    if (!c) return;
    objectStore.delete(c.primaryKey);
    c.continue();
  };
}
