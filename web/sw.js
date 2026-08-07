// Slovotoč service worker – cache-first for same-origin assets so the game
// works offline after the first visit.
const CACHE = 'slovotoc-v16';
const CORE = [
  './',
  './index.html',
  './css/style.css',
  './js/main.js',
  './js/wheel.js',
  './js/grid.js',
  './js/state.js',
  './js/leaderboard.js',
  './js/audio.js',
  './js/confetti.js',
  './data/levels.json',
  './assets/icon.svg',
  './assets/fonts/nunito-latin.woff2',
  './assets/fonts/nunito-latin-ext.woff2',
  './manifest.webmanifest',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin || e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request).then(hit =>
      hit ||
      fetch(e.request).then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
        return res;
      })
    )
  );
});
