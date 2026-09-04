/* G Work — cache network-first.
   calendar.json sta in cache solo come riserva offline: con la rete
   non deve mai essere servita una copia vecchia. */

const CACHE = 'gwork-v1';

const SHELL = [
  './',
  'index.html',
  'styles.css',
  'app.js',
  'manifest.webmanifest',
  'icon-192.png',
  'icon-512.png'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      /* una risorsa mancante non deve far fallire l'installazione */
      .then(c => Promise.all(SHELL.map(u => c.add(u).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.map(k => (k === CACHE ? null : caches.delete(k)))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  /* app.js chiede calendar.json con ?t=... : in cache ne tengo una sola copia,
     sotto la chiave senza parametri. */
  const isCal = url.pathname.endsWith('/calendar.json');
  const key = isCal ? url.origin + url.pathname : req;

  e.respondWith(
    fetch(req)
      .then(res => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(key, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() =>
        caches.match(key, { ignoreSearch: true })
          .then(hit => hit || (req.mode === 'navigate' ? caches.match('index.html') : undefined))
          .then(hit => hit || Response.error())
      )
  );
});
