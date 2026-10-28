/* Falar service worker — офлайн-оболочка + быстрые загрузки.
   Стратегия: stale-while-revalidate для своих GET-ресурсов (мгновенно из кеша, обновление в фоне),
   API и сторонние запросы не трогаем. Версию кеша бампать при значимых изменениях SW. */
const CACHE = 'falar-shell-v2';
const SHELL = ['/', '/index.html', '/app.js', '/content.js', '/styles.css', '/icon.svg', '/manifest.webmanifest'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  let url;
  try { url = new URL(req.url); } catch (_) { return; }
  if (url.origin !== self.location.origin) return;     // сторонние (шрифты, umami) — мимо
  if (url.pathname.startsWith('/api/')) return;         // API — всегда сеть, не кешируем
  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(req);
      const network = fetch(req).then((res) => {
        if (res && res.status === 200 && res.type === 'basic') cache.put(req, res.clone());
        return res;
      }).catch(() => cached);
      return cached || network;     // мгновенно из кеша, обновление в фоне; офлайн → кеш
    })
  );
});
