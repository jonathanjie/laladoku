/**
 * Laladoku service worker.
 *
 * The app shell and the whole level bank (about 90 KB) are precached, so the
 * game works fully offline after the first visit. Other requests (fonts) use
 * the cache first and fill it on first use.
 *
 * Bump VERSION whenever a shipped file changes, so players get the update.
 */
const VERSION = 'laladoku-v5';
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/app.css',
  './js/app.js',
  './js/audio.js',
  './js/board-view.js',
  './js/engine.js',
  './js/explain.js',
  './js/game.js',
  './js/generator.js',
  './js/install.js',
  './js/theme.js',
  './js/lala.js',
  './js/levels.js',
  './js/quickplay-worker.js',
  './js/store.js',
  './levels/index.json',
  './levels/examples.json',
  './levels/chunk-0.json',
  './levels/chunk-1.json',
  './levels/chunk-2.json',
  './levels/chunk-3.json',
  './levels/chunk-4.json',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  // Own files: network first, revalidated with the server (a cheap 304 when
  // nothing changed), so a fresh deploy shows at once; fall back to the cache
  // when offline.
  if (url.origin === self.location.origin) {
    event.respondWith(
      fetch(request, { cache: 'no-cache' })
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(VERSION).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => caches.match(request, { ignoreSearch: true })),
    );
    return;
  }

  // Fonts: cache first.
  event.respondWith(
    caches.match(request).then((cached) => cached || fetch(request).then((response) => {
      const copy = response.clone();
      caches.open(VERSION).then((cache) => cache.put(request, copy));
      return response;
    })),
  );
});
