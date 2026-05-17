// InjectLog — service worker.
// Caches the app shell for offline use. Patient + injection data live in
// IndexedDB, not in the cache. Bump CACHE to invalidate the shell after
// a code change.

const CACHE = 'injectlog-v3';
const SHELL = ['./', './index.html', './manifest.json', './injectlog_icon.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL).catch(() => {})));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request).then(r => r || fetch(e.request))
  );
});
