// Network-first, same-origin app shell only. Never touches cross-origin (DexScreener, RugCheck, Jupiter, Google auth) or JSON data.
const CACHE = "ahl-v1";
const SHELL = ["./", "index.html", "app.css", "app.js", "manifest.webmanifest", "icons/icon-192.png", "icons/icon-512.png"];
self.addEventListener("install", (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener("activate", (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== location.origin) return; // cross-origin: browser handles it, never cached
  const scope = new URL(self.registration.scope).pathname;
  if (!u.pathname.startsWith(scope) || u.pathname.endsWith(".json") || /accounts\.google|oauth/.test(u.href)) return; // data + out-of-scope: network only
  e.respondWith(fetch(e.request).then((r) => { if (r.ok && r.type === "basic") { const cp = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, cp)); } return r; })
    .catch(() => caches.match(e.request, { ignoreSearch: true }).then((m) => m || (e.request.mode === "navigate" ? caches.match("index.html") : Response.error()))));
});
