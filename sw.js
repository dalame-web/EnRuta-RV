const CACHE = 'enruta-rv-vDEV3';
const PRECACHE = [
  './', './index.html', './manifest.webmanifest',
  './data.js', './registro.js', './registro.css', './app-modal.js', './telefonemas-listado.js',
  './nube.js', './msal-browser.min.js',
  './icon-192.png', './icon-512.png', './informe-logo.png', './informe-decorativo.jpg',
  './carlito-regular.ttf', './carlito-bold.ttf'
];

self.addEventListener('install', e => {
  // Aplica el SW nuevo en cuanto termina de instalar (sin esperar a un
  // banner "Actualizar" — no existe tal UI). El controllerchange en
  // index.html recarga la página sola cuando esto ocurre.
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
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
