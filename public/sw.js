/*
 * Service worker do Visitas Locação.
 * Cache SOMENTE de arquivos estáticos públicos (JS/CSS do build, ícones) e da página offline.
 * Nunca armazena respostas de API, páginas autenticadas ou dados de clientes.
 */
const VERSION = "v3";
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

// ── Lembretes (Web Push): conteúdo só com contagens, sem dados de clientes ──
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }
  const title = data.title || "Visitas Locação";
  const safe = (u) => (typeof u === "string" && u.startsWith("/") && !u.startsWith("//") ? u : null);
  // atalhos (Android/Chrome); no iPhone são ignorados e a notificação abre o link principal
  const actions = Array.isArray(data.actions)
    ? data.actions.filter((a) => a && typeof a.action === "string" && typeof a.title === "string" && safe(a.url)).slice(0, 3)
    : [];
  const actionUrls = {};
  for (const a of actions) actionUrls[a.action] = safe(a.url);
  const tasks = [
    self.registration.showNotification(title, {
      body: data.body || "Você tem visitas aguardando resultado.",
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      tag: data.tag || "lembrete",
      renotify: false,
      actions: actions.map((a) => ({ action: a.action, title: a.title })),
      data: { url: safe(data.url) || "/pendencias", actionUrls },
    }),
  ];
  if (typeof data.badge === "number" && self.navigator && "setAppBadge" in self.navigator) {
    tasks.push((data.badge > 0 ? self.navigator.setAppBadge(data.badge) : self.navigator.clearAppBadge()).catch(() => undefined));
  }
  event.waitUntil(Promise.all(tasks));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const d = event.notification.data || {};
  const url = (event.action && d.actionUrls && d.actionUrls[event.action]) || d.url || "/pendencias";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if ("focus" in c) {
          c.navigate(url);
          return c.focus();
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
