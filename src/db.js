/* Personal Admin — IndexedDB storage. Everything lives in this browser profile on this device. */
(function (g) {
  'use strict';

  const DB_NAME = 'personal-admin';
  const STORES = ['items', 'people', 'files', 'settings'];
  let dbPromise;

  function open() {
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => {
          const db = req.result;
          for (const s of STORES) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: s === 'settings' ? 'key' : 'id' });
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }
    return dbPromise;
  }

  async function run(store, mode, fn) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, mode);
      const os = tx.objectStore(store);
      const req = fn(os);
      tx.oncomplete = () => resolve(req && 'result' in req ? req.result : undefined);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }

  const getAll = (s) => run(s, 'readonly', (os) => os.getAll());
  const get = (s, id) => run(s, 'readonly', (os) => os.get(id));
  const put = (s, v) => run(s, 'readwrite', (os) => os.put(v));
  const del = (s, id) => run(s, 'readwrite', (os) => os.delete(id));
  const clear = (s) => run(s, 'readwrite', (os) => os.clear());

  async function getSetting(key, fallback) {
    const row = await get('settings', key);
    return row ? row.value : fallback;
  }
  const setSetting = (key, value) => put('settings', { key, value });

  g.PADB = { getAll, get, put, del, clear, getSetting, setSetting, STORES };
})(globalThis);
