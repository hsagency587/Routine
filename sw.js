/* G Work — cache network-first.
   calendar.json sta in cache solo come riserva offline: con la rete
   non deve mai essere servita una copia vecchia. */

const CACHE = 'gwork-v1';

/* Il calendario non e` piu` un file del sito: sta su un altro dominio. Senza
   questa eccezione il service worker lo lascerebbe passare senza guardarlo, e
   offline resteremmo senza eventi. Il battito invece non si mette mai in
   cache: una risposta vecchia direbbe che il ponte e` vivo quando non lo e`. */
const CAL_URL = 'https://raw.githubusercontent.com/hsagency587/Routine/dati/calendar.json';

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
  const isCal = (url.origin + url.pathname) === CAL_URL;
  if (url.origin !== self.location.origin && !isCal) return;

  /* In cache del calendario ne tengo una copia sola, sotto la chiave pulita. */
  const key = isCal ? CAL_URL : req;

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
