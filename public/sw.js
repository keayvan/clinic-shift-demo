/* Service worker: caches the whole app so it opens instantly and works offline.
   Bump VERSION on every release; the app then shows "نسخه جدید آماده است". */
const VERSION = "2.12.0";
const CACHE = "clinic-shift-" + VERSION;
const ASSETS = ["./", "index.html", "styles.css", "nlu.js", "platform.js", "patform.js", "lab.js", "app.js", "implant.js", "manifest.webmanifest", "changelog.json",
  "fonts/Vazirmatn-wght.woff2", "vendor/html2pdf.bundle.min.js", "vendor/xlsx.full.min.js",
  "icons/icon-192.png", "icons/icon-512.png", "icons/maskable-512.png", "icons/apple-touch-icon.png", "icons/favicon-64.png"];
self.addEventListener("install", e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS))); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("message", e => { if (e.data === "skip") self.skipWaiting(); });
self.addEventListener("fetch", e => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== location.origin || /\/(api|admin)(\/|$)/.test(u.pathname)) return;
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(hit => hit || fetch(e.request).then(r => {
    if (r.ok && r.type === "basic") { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
    return r;
  }).catch(() => caches.match("index.html"))));
});
