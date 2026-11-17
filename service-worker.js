// service-worker.js — PocketLedger v3.0 Offline-First Service Worker
// Supports GitHub Pages subdirectories (relative paths './') and safe cache upgrades without touching IndexedDB.

const SHELL_CACHE = 'pocketledger-shell-v3.0.0';
const OCR_RUNTIME_CACHE = 'pocketledger-ocr-runtime-v3.0.0';

const SHELL_ASSETS = [
  './',
  './index.html',
  './offline.html',
  './manifest.json',
  './css/style.css',
  './css/responsive.css',
  './js/calculations.js',
  './js/budgets.js',
  './js/rollover.js',
  './js/receipt-scanner.js',
  './js/database.js',
  './js/accounts.js',
  './js/categories.js',
  './js/transactions.js',
  './js/analytics.js',
  './js/backup.js',
  './js/settings.js',
  './js/app.js',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
  './assets/icons/maskable-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.map((key) => {
          if (key !== SHELL_CACHE && key !== OCR_RUNTIME_CACHE) {
            return caches.delete(key);
          }
          return null;
        })
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const clone = res.clone();
          caches.open(SHELL_CACHE).then((cache) => cache.put('./index.html', clone));
          return res;
        })
        .catch(async () => {
          const cachedIndex = await caches.match('./index.html');
          return cachedIndex || caches.match('./offline.html');
        })
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      const fetched = fetch(request)
        .then((networkRes) => {
          if (networkRes && networkRes.status === 200) {
            const copy = networkRes.clone();
            caches.open(OCR_RUNTIME_CACHE).then((cache) => cache.put(request, copy));
          }
          return networkRes;
        })
        .catch(() => cached);
      return cached || fetched;
    })
  );
});
