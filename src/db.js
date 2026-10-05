/* Personal Admin — IndexedDB storage. Everything lives in this browser profile on this device. */
(function (g) {
  'use strict';

  const DB_NAME = 'personal-admin';
  const STORES = ['items', 'people', 'files', 'settings'];
  // Files shared to the app from Android's Share menu wait here until the app picks them up.
  const ALL_STORES = [...STORES, 'shared'];
  let dbPromise;

  function open() {
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 2);
        req.onupgradeneeded = () => {
          const db = req.result;
          for (const s of ALL_STORES) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: s === 'settings' ? 'key' : 'id' });
        };
        req.onsuccess = () => {
          // Let a newer version (e.g. an updated service worker) upgrade the database.
          req.result.onversionchange = () => { req.result.close(); dbPromise = null; };
          resolve(req.result);
        };
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

  /* With the app lock on, these stores hold encrypted records ({ id, _enc }). The cipher is
     set after unlocking and lives only in memory. Plain records are still read as-is, so a
     half-finished encryption (e.g. the app was closed mid-way) never loses anything. */
  const SEALED = new Set(['items', 'people', 'files']);
  let cipher = null;
  const setCipher = (c) => { cipher = c; };
  const isEncrypted = (row) => !!(row && row._enc);
  async function openRow(store, row) {
    if (!isEncrypted(row)) return row;
    if (!cipher) throw new Error('locked');
    return cipher.open(store, row);
  }

  const getAllRaw = (s) => run(s, 'readonly', (os) => os.getAll());
  const putRaw = (s, v) => run(s, 'readwrite', (os) => os.put(v));
  const getAll = async (s) => Promise.all((await getAllRaw(s)).map((r) => openRow(s, r)));
  const get = async (s, id) => openRow(s, await run(s, 'readonly', (os) => os.get(id)));
  const put = async (s, v) => putRaw(s, cipher && SEALED.has(s) ? await cipher.seal(s, v) : v);
  const del = (s, id) => run(s, 'readwrite', (os) => os.delete(id));
  const clear = (s) => run(s, 'readwrite', (os) => os.clear());

  async function getSetting(key, fallback) {
    const row = await get('settings', key);
    return row ? row.value : fallback;
  }
  const setSetting = (key, value) => put('settings', { key, value });

  g.PADB = { getAll, get, put, del, clear, getSetting, setSetting, STORES, SEALED, setCipher, getAllRaw, putRaw, isEncrypted };
})(globalThis);
