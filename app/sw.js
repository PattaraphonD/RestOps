// Service worker: caches the app shell so it opens instantly and works without signal.
// Data calls go to the network (the Apps Script URL is never cached).
const CACHE = 'resto-ops-v2.1.0';
const SHELL = [
  './', './index.html', './config.js', './manifest.webmanifest', './css/app.css',
  './js/costing.js', './js/pricing.js', './js/core.js', './js/i18n.js', './js/app.js', './js/api.js', './js/ui.js', './js/charts.js', './js/demo.js',
  './js/views/home.js', './js/views/stock.js', './js/views/sales.js', './js/views/menu.js', './js/views/more.js',
  './js/views/purchasing.js', './js/views/recipe-lines.js', './js/views/production.js', './js/views/channels.js', './js/views/pricing-view.js', './js/views/analysis.js', './js/views/promotions.js', './js/views/promo-builder.js', './js/views/sop.js', './js/views/close.js', './js/views/profit-board.js', './js/views/categories.js',
  './icons/icon.svg', './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  // Network first (so updates arrive), fall back to cache when offline.
  e.respondWith(
    fetch(e.request).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
      return res;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || caches.match('./index.html')))
  );
});
