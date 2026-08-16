// Slovotoč service worker – cache-first for same-origin assets so the game
// works offline after the first visit.
const CACHE = 'slovotoc-v29';
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
  './assets/icon-192.png',
  './assets/icon-512.png',
  './assets/apple-touch-icon.png',
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

// Code and level data go network-first so a player never sits on a stale
// build (that is how a fixed word could still read as rejected); pictures,
// fonts and icons stay cache-first because they rarely change and are big.
// CSS belongs here too: leaving it out meant a layout fix only reached players
// one launch late, after the worker itself had rotated.
const FRESH = /\.(html|js|css|json|webmanifest)$|\/$/;

// A dead network fails fast, but a barely-alive one can hang for a minute.
// Waiting past this we serve the cached copy instead of a blank screen; the
// request itself still runs on, so the cache is refreshed for next time.
const NET_TIMEOUT_MS = 4000;

async function fresh(request) {
  const cached = caches.match(request);
  const network = fetch(request).then(res => {
    if (res && res.ok) caches.open(CACHE).then(c => c.put(request, res.clone()));
    return res;
  });
  const slow = new Promise(res => setTimeout(() => res(null), NET_TIMEOUT_MS));

  try {
    const won = await Promise.race([network, slow]);
    if (won && won.ok) return won;
    return (await cached) || (await network);
  } catch {
    const hit = await cached;
    if (hit) return hit;
    throw new Error('offline and nothing cached');
  }
}

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin || e.request.method !== 'GET') return;

  if (FRESH.test(url.pathname)) {
    e.respondWith(fresh(e.request));
    return;
  }

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
