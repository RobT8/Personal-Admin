/* Personal Admin — service worker for the installed phone app.
   - Keeps the app working offline (it only ever caches its own files).
   - Receives files and text shared from Android's Share menu.
   - Checks reminders in the background (Periodic Background Sync, Chrome on Android). */
'use strict';
importScripts('core.js', 'db.js');

const VERSION = '__VERSION__';
const CACHE = `personal-admin-${VERSION}`;
const ASSETS = __ASSETS__;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)));
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

// The page asks the waiting worker to take over when the user taps "Update"
self.addEventListener('message', (e) => {
  if (e.data === 'skip-waiting') self.skipWaiting();
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;

  if (e.request.method === 'POST' && url.pathname.endsWith('/share-target')) {
    e.respondWith(receiveShare(e.request));
    return;
  }
  if (e.request.method !== 'GET') return;

  // Cache first (the app is versioned, so a new deploy installs a new cache)
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(e.request, { ignoreSearch: true });
    if (hit) return hit;
    try {
      return await fetch(e.request);
    } catch (err) {
      // Offline and not cached: any page in the app's scope gets the app itself
      if (e.request.mode === 'navigate') return (await cache.match('./')) || Response.error();
      throw err;
    }
  })());
});

// Fallback for a body formData() rejects (e.g. text in a legacy encoding): pull out the text fields by hand.
async function textFieldsFromRaw(request) {
  const boundary = (/boundary=(?:"([^"]+)"|([^;]+))/i.exec(request.headers.get('content-type') || '') || []).slice(1).find(Boolean);
  if (!boundary) return '';
  const body = new TextDecoder('windows-1252').decode(await request.arrayBuffer());
  return body.split(`--${boundary}`)
    .map((part) => /name="(title|text|url)"\r?\n\r?\n([\s\S]*?)\r?\n?$/.exec(part))
    .filter(Boolean).map((m) => m[2].trim()).filter(Boolean).join('\n');
}

async function receiveShare(request) {
  try {
    const backup = request.clone();
    let fd = null;
    try { fd = await request.formData(); } catch { /* handled below */ }
    const files = fd ? fd.getAll('files').filter((f) => f && typeof f !== 'string' && f.size) : [];
    const text = fd
      ? ['title', 'text', 'url'].map((k) => fd.get(k)).filter((v) => typeof v === 'string' && v.trim()).join('\n')
      : await textFieldsFromRaw(backup);
    if (files.length || text) {
      await PADB.put('shared', {
        id: PACore.uid(),
        at: Date.now(),
        text,
        // Store as Blobs with their names; File objects survive IndexedDB in Chrome, but be explicit
        files: files.map((f) => ({ name: f.name || 'shared-file', type: f.type || '', blob: f })),
      });
    }
  } catch (err) {
    // Still open the app, even if reading the share failed
  }
  return Response.redirect(new URL('./#/inbox', self.registration.scope).href, 303);
}

/* ---------- reminders in the background ---------- */
self.addEventListener('periodicsync', (e) => {
  if (e.tag === 'reminders') e.waitUntil(checkReminders());
});

async function checkReminders() {
  const notify = await PADB.getSetting('notify', false);
  if (!notify) return;
  const items = await PADB.getAll('items');
  const defaultOffsets = await PADB.getSetting('defaultOffsets', [30, 7, 1]);
  const notified = await PADB.getSetting('notified', []);
  const { notifications, keys } = PACore.dueNotifications(items, { defaultOffsets }, notified);
  for (const n of notifications) {
    await self.registration.showNotification(n.title, { body: n.body, tag: n.tag, icon: 'icon-192.png', badge: 'icon-192.png', data: { itemId: n.itemId } });
  }
  if (keys.length) await PADB.setSetting('notified', [...notified, ...keys].slice(-500));
}

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const target = new URL(e.notification.data && e.notification.data.itemId ? `./#/item/${e.notification.data.itemId}` : './#/dashboard', self.registration.scope).href;
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const w of wins) {
      if ('focus' in w) { await w.focus(); if ('navigate' in w) await w.navigate(target); return; }
    }
    await self.clients.openWindow(target);
  })());
});
