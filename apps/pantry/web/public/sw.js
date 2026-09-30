/*
 * Pantry's service worker, the same as apps/fretwork's: enough to install the
 * app and open its shell with a flaky connection. It is served from public/ as
 * a plain file, so Vite leaves it alone and it can take the root scope.
 *
 * - Auth, the API and Firebase's reserved /__/ paths are never touched: they
 *   go straight to the network, so a session or API data is never served stale.
 * - Pages (navigations) are network first; the cached shell is the fallback.
 *   An online load always gets the latest deploy.
 * - /assets/ is content-hashed by Vite, so cache first. When a load brings a
 *   new shell (a deploy), cached assets it doesn't reference are dropped.
 * - Anything else from this origin (icons, the manifest) is network first with
 *   the cache as the fallback.
 */
const CACHE = "pantry-shell-v1";
const SHELL = "/";
const NETWORK_ONLY = ["/api/", "/auth/", "/__/"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll([SHELL, "/manifest.webmanifest"]))
      .catch(() => undefined)
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("pantry-") && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (NETWORK_ONLY.some((p) => url.pathname.startsWith(p))) return;

  if (req.mode === "navigate") {
    event.respondWith(shell(req));
  } else if (url.pathname.startsWith("/assets/")) {
    event.respondWith(cacheFirst(req));
  } else {
    event.respondWith(networkFirst(req));
  }
});

async function shell(req) {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(req);
    // The app uses hash routes, so every page is the same shell.
    if (res.ok && res.headers.get("content-type")?.includes("text/html")) {
      const html = await res.clone().text();
      const before = await cache.match(SHELL).then((r) => r?.text());
      await cache.put(SHELL, res.clone());
      // A new deploy: forget the old build's assets. Lazy chunks aren't linked
      // from the shell, so pruning on every load would refetch them each time.
      if (before !== undefined && before !== html) await pruneAssets(cache, html);
    }
    return res;
  } catch (err) {
    const cached = await cache.match(SHELL);
    if (cached) return cached;
    throw err;
  }
}

async function cacheFirst(req) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(req);
  if (cached) return cached;
  const res = await fetch(req);
  if (res.ok) await cache.put(req, res.clone());
  return res;
}

async function networkFirst(req) {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(req);
    if (res.ok) await cache.put(req, res.clone());
    return res;
  } catch (err) {
    const cached = await cache.match(req);
    if (cached) return cached;
    throw err;
  }
}

/** Drops cached /assets/ files that the newest shell no longer links. */
async function pruneAssets(cache, html) {
  const live = new Set(html.match(/\/assets\/[^"'\s)]+/g) ?? []);
  for (const req of await cache.keys()) {
    const path = new URL(req.url).pathname;
    if (path.startsWith("/assets/") && !live.has(path)) await cache.delete(req);
  }
}
