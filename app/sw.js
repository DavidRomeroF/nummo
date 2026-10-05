// Service worker: guarda los archivos de la app para que funcione sin conexión.
// Nunca toca tus datos (viven cifrados en IndexedDB) ni hace peticiones a otros dominios.
// La versión y la lista de archivos las genera tools/release.py: no las edites a mano.

// @generated-start
const VERSION = 'd69429b7ffc8';
const ASSETS = ["./", "css/app.css", "icons/apple-touch-icon.png", "icons/icon-192.png", "icons/icon-512.png", "icons/icon-maskable-512.png", "icons/icon.svg", "index.html", "js/core/backup.js", "js/core/catalog.js", "js/core/color.js", "js/core/crypto.js", "js/core/dates.js", "js/core/finance.js", "js/core/idb.js", "js/core/ids.js", "js/core/model.js", "js/core/money.js", "js/core/recurring.js", "js/core/store.js", "js/core/text.js", "js/core/vault.js", "js/main.js", "js/theme-boot.js", "js/ui/charts.js", "js/ui/components.js", "js/ui/dom.js", "js/ui/format.js", "js/ui/icon-data.js", "js/ui/icons.js", "js/ui/pinpad.js", "js/ui/pwa.js", "js/ui/restore.js", "js/ui/router.js", "js/ui/session.js", "js/ui/sheet.js", "js/ui/shell.js", "js/ui/theme.js", "js/ui/toast.js", "js/views/about.js", "js/views/accounts.js", "js/views/appearance.js", "js/views/backup.js", "js/views/budgets.js", "js/views/categories.js", "js/views/debt-forms.js", "js/views/debts.js", "js/views/home.js", "js/views/more.js", "js/views/movement-form.js", "js/views/movements.js", "js/views/recurring.js", "js/views/screens.js", "js/views/security.js", "js/views/shared.js", "js/views/stats.js", "manifest.webmanifest"];
// @generated-end

const CACHE = `dinero-${VERSION}`;
const SHELL = new URL('./', self.registration.scope).href;

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // cache: 'reload' evita copiar versiones antiguas de la caché HTTP del navegador.
    await cache.addAll(ASSETS.map((url) => new Request(url, { cache: 'reload' })));
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key.startsWith('dinero-') && key !== CACHE).map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

// La página pide activar la versión nueva cuando la persona pulsa «Actualizar».
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || !url.href.startsWith(self.registration.scope)) return;

  if (request.mode === 'navigate') {
    // La app es una sola página: cualquier navegación dentro del alcance abre el armazón guardado.
    event.respondWith((async () => (await caches.match(SHELL, { cacheName: CACHE })) ?? fetch(request))());
    return;
  }
  event.respondWith((async () => (await caches.match(request, { cacheName: CACHE, ignoreSearch: true })) ?? fetch(request))());
});
