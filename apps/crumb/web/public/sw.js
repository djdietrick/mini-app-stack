/*
 * Crumb's service worker: a copy of fretwork's (keep the caching in step with
 * it), plus Web Push: showing reminders and opening the app on a tap. It is
 * served from public/ as a plain file, so Vite leaves it alone and it can
 * take the root scope.
 *
 * - Auth, the API and Firebase's reserved /__/ paths are never touched: they
 *   go straight to the network, so a session or a run is never served stale.
 * - Pages (navigations) are network first; the cached shell is the fallback.
 *   An online load always gets the latest deploy.
 * - /assets/ is content-hashed by Vite, so cache first. When a load brings a
 *   new shell (a deploy), cached assets it doesn't reference are dropped.
 * - Anything else from this origin (icons, the manifest) is network first
 *   with the cache as the fallback.
 * - A push carries { title, body, url, tag } from src/domain/reminders.ts;
 *   `url` is a hash route, opened in an existing window when there is one.
 */
const CACHE = "crumb-shell-v1";
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
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("crumb-") && k !== CACHE).map((k) => caches.delete(k))))
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

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : "" };
  }
  event.waitUntil(
    self.registration.showNotification(data.title || "Crumb", {
      body: data.body || "",
      tag: data.tag,
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      data: { url: data.url || "#/" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(`/${event.notification.data?.url ?? ""}`, self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(async (windows) => {
      for (const w of windows) {
        if (new URL(w.url).origin !== self.location.origin) continue;
        await w.focus();
        // Only the hash changes, so this is a route change, not a reload.
        if ("navigate" in w) await w.navigate(target).catch(() => undefined);
        return;
      }
      await self.clients.openWindow(target);
    }),
  );
});

// The browser rotated the subscription (it may, at any time): subscribe again
// with the same key and tell the server, with this origin's session cookie.
self.addEventListener("pushsubscriptionchange", (event) => {
  const key = event.oldSubscription?.options?.applicationServerKey;
  if (!key) return;
  event.waitUntil(
    self.registration.pushManager
      .subscribe({ userVisibleOnly: true, applicationServerKey: key })
      .then((sub) =>
        fetch("/api/push/subscriptions", {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(sub.toJSON()),
        }),
      )
      .catch(() => undefined),
  );
});
