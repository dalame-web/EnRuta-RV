const CACHE = 'enruta-rv-v58';
const PRECACHE = [
  './', './index.html', './manifest.webmanifest',
  './data.js', './registro.js', './registro.css', './app-modal.js', './telefonemas-listado.js',
  './nube.js', './msal-browser.min.js',
  './icon-192.png', './icon-512.png', './informe-logo.png', './informe-decorativo.jpg',
  './carlito-regular.ttf', './carlito-bold.ttf'
];

self.addEventListener('install', e => {
  // Precache TOLERANTE a fallos: cada recurso por separado con su propio
  // catch. Si uno falla (p.ej. msal-browser.min.js ~275 KB con mala
  // cobertura en la tablet), NO se aborta la instalación entera — ese
  // recurso se cachea luego con el handler de fetch (network-first). Antes,
  // c.addAll fallaba con cualquier recurso caído y la instalación se
  // reintentaba una y otra vez, y cada reintento con éxito disparaba una
  // recarga de la página (perdiendo ventanas abiertas).
  e.waitUntil(
    caches.open(CACHE)
      .then(c => Promise.all(PRECACHE.map(u => c.add(u).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(ks =>
      Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  // Solo http(s): peticiones chrome-extension:// (de otras extensiones del
  // navegador) no las acepta la Cache API y no nos interesa interceptarlas.
  if (!e.request.url.startsWith('http')) return;
  e.respondWith(
    fetch(e.request).then(res => {
      if (res.ok && res.type === 'basic') {
        const clone = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, clone));
      }
      return res;
    }).catch(() =>
      caches.match(e.request).then(cached => cached || Response.error())
    )
  );
});
