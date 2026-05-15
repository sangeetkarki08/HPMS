/*
  HPMS Service Worker
  ───────────────────
  Caches the app shell so the app loads with no network.
  When online, fetches the latest assets in the background.

  Bump CACHE_VERSION whenever you change the cached files
  to force clients to fetch fresh copies.
*/

const CACHE_VERSION = 'hpms-v2';
const APP_SHELL = [
  './',
  './index.html',
  './cpms.html',
  './config.js',
  './app/cloud-sync.js',
  './app/icon.svg',
  './manifest.webmanifest',
  // Vendored libs so the PWA works fully offline (no CDN dependency)
  './vendor/chart.umd.min.js',
  './vendor/bootstrap-icons.css',
  './vendor/fonts/bootstrap-icons.woff2',
  './vendor/fonts/bootstrap-icons.woff'
];

// Install: pre-cache the app shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then(cache => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

// Activate: delete old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Fetch strategy:
//   - Supabase API calls: network-only (don't cache cloud data)
//   - Everything else: stale-while-revalidate (instant load from cache,
//     fresh copy fetched in background for next visit)
self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  if (req.method !== 'GET') return;

  // Never cache Supabase API calls — always go to network
  if (url.hostname.endsWith('.supabase.co') || url.hostname.endsWith('.supabase.in')) {
    return;
  }

  event.respondWith(
    caches.open(CACHE_VERSION).then(async (cache) => {
      const cached = await cache.match(req);
      const networkFetch = fetch(req).then((res) => {
        if (res && res.status === 200 && res.type !== 'opaque') {
          cache.put(req, res.clone()).catch(() => {});
        }
        return res;
      }).catch(() => cached);
      return cached || networkFetch;
    })
  );
});
