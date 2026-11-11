/* ProfitLens service worker — shell caching only, API responses are NEVER cached. */
const VERSION = "v4";
const SHELL_CACHE = `profitlens-shell-${VERSION}`;
const STATIC_CACHE = `profitlens-static-${VERSION}`;
const HASHED_ASSET = /[.-][0-9a-f]{8,}\.[a-z0-9]+$/i;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(["/", "/index.html", "/manifest.json"]))
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== SHELL_CACHE && k !== STATIC_CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);

  // SECURITY: API calls (financial data, auth, payments) are always network-only.
  if (url.pathname.startsWith("/api/")) return;

  // App shell: network-first so deploys are picked up, cache as offline fallback.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(SHELL_CACHE).then((c) => c.put("/index.html", copy));
          return res;
        })
        .catch(() => caches.match("/index.html"))
    );
    return;
  }

  // Only same-origin static assets may be cached. Hashed build assets: cache-first
  // (immutable). Everything else: network-first with cache fallback.
  if (url.origin === self.location.origin) {
    const isHashAsset = HASHED_ASSET.test(url.pathname);
    const isPublicAsset = url.pathname.startsWith("/icons/") || url.pathname === "/manifest.json";
    if (isHashAsset || isPublicAsset) {
      event.respondWith(
        caches.match(request).then(
          (hit) =>
            hit ||
            fetch(request).then((res) => {
              const copy = res.clone();
              caches.open(STATIC_CACHE).then((c) => c.put(request, copy));
              return res;
            })
        )
      );
    } else {
      event.respondWith(
        fetch(request)
          .then((res) => {
            const copy = res.clone();
            caches.open(SHELL_CACHE).then((c) => c.put(request, copy));
            return res;
          })
          .catch(() => caches.match(request))
      );
    }
  }
});
