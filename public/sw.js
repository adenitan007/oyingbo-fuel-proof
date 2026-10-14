// Offline support: app shell cached on first visit; register list falls back to last copy; photos cached once seen.
const SHELL = "fuel-shell-v6";
const DATA = "fuel-data-v4";
const SHELL_FILES = ["/", "/manifest.webmanifest", "/icon-192.png", "/icon-512.png", "/generator/", "/generator/manifest.webmanifest", "/generator/icon-192.png", "/generator/icon-512.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => ![SHELL, DATA].includes(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // Fonts: cache-first
  if (url.host === "fonts.googleapis.com" || url.host === "fonts.gstatic.com") {
    e.respondWith(caches.open(DATA).then(async (c) => (await c.match(req)) || fetch(req).then((r) => { c.put(req, r.clone()); return r; })));
    return;
  }
  if (url.origin !== location.origin) return;

  // Photos never change: cache-first
  if (url.pathname.startsWith("/api/photo/") || url.pathname.startsWith("/api/gen/photo/")) {
    const key = url.origin + url.pathname;
    e.respondWith(caches.open(DATA).then(async (c) => (await c.match(key)) || fetch(req).then((r) => { if (r.ok) c.put(key, r.clone()); return r; })));
    return;
  }

  // Register list: network first, fall back to last copy
  if (url.pathname === "/api/deliveries" || url.pathname === "/api/gen/entries") {
    const key = url.origin + url.pathname;
    e.respondWith(
      fetch(req).then((r) => { if (r.ok) { const cp = r.clone(); caches.open(DATA).then((c) => c.put(key, cp)); } return r; })
        .catch(() => caches.open(DATA).then((c) => c.match(key)).then((m) => m || new Response("[]", { headers: { "content-type": "application/json", "x-offline": "1" } })))
    );
    return;
  }
  if (url.pathname.startsWith("/api/")) return;

  // App shell: network first so updates arrive, cache when offline
  // Each app keeps its own page in the cache: "/" for locomotives, "/generator/" for generators.
  const pageKey = url.pathname.startsWith("/generator") ? "/generator/" : "/";
  const key = req.mode === "navigate" ? pageKey : req;
  e.respondWith(
    fetch(req).then((r) => { if (r.ok) { const cp = r.clone(); caches.open(SHELL).then((c) => c.put(key, cp)); } return r; })
      .catch(() => caches.open(SHELL).then((c) => c.match(key)))
  );
});
