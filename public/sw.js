/*
 * Service worker do Visitas Locação.
 * Cache SOMENTE de arquivos estáticos públicos (JS/CSS do build, ícones) e da página offline.
 * Nunca armazena respostas de API, páginas autenticadas ou dados de clientes.
 */
const VERSION = "v1";
const STATIC_CACHE = `static-${VERSION}`;
const PRECACHE = ["/offline.html", "/icons/icon-192.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(STATIC_CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== STATIC_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "LOGOUT") {
    // mantém apenas o shell estático; não há dados pessoais em cache
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== STATIC_CACHE).map((k) => caches.delete(k))));
  }
});

function isStaticAsset(url) {
  return url.origin === self.location.origin && (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/"));
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return; // nunca intercepta API

  if (isStaticAsset(url)) {
    // arquivos com hash no nome: cache-first
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok && res.type === "basic") {
              const copy = res.clone();
              caches.open(STATIC_CACHE).then((c) => c.put(req, copy));
            }
            return res;
          }),
      ),
    );
    return;
  }

  if (req.mode === "navigate") {
    // páginas sempre da rede (autenticadas, não cacheadas); sem rede → página offline estática
    event.respondWith(fetch(req).catch(() => caches.match("/offline.html")));
  }
});
