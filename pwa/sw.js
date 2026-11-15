/* BOOPS web app service worker: makes /app/ work with no internet after the first visit.
 *
 * tools/build-site.mjs fills in the three placeholders below when it builds dist-site/app/.
 * Do not register this file from web/ directly: the Android and iOS apps load web/ from their
 * own bundles and do not need it.
 *
 * Two caches:
 *   shell  - everything the dashboard and the camera page need, saved on install (about 3 MB).
 *   vendor - the MediaPipe face model (about 18 MB), saved the first time the camera check uses it.
 * Each cache name carries a hash of its files, so a new deploy gets a fresh cache and the old one
 * is deleted. A new version waits until the page asks it to take over (the "Update ready" notice).
 */

const SHELL_VERSION = "__BOOPS_SHELL_VERSION__";
const VENDOR_VERSION = "__BOOPS_VENDOR_VERSION__";
const PRECACHE = __BOOPS_PRECACHE__; // paths relative to this file, e.g. "./", "app.js"

const SHELL_CACHE = `boops-shell-${SHELL_VERSION}`;
const VENDOR_CACHE = `boops-vendor-${VENDOR_VERSION}`;
const SCOPE = new URL("./", self.location).href;
const VENDOR_PREFIX = new URL("vendor/", SCOPE).href;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) =>
      // cache: "reload" skips the browser's HTTP cache so we never save a stale copy.
      cache.addAll(PRECACHE.map((p) => new Request(new URL(p, SCOPE), { cache: "reload" })))
    )
  );
  // No skipWaiting() here: a new version waits for the page's "Reload" button (see pwa.js).
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k.startsWith("boops-") && k !== SHELL_CACHE && k !== VENDOR_CACHE)
            .map((k) => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});

/** "/app/index.html" and "/app/" are the same page; we store it under "/app/". */
function shellKey(url) {
  const u = new URL(url);
  u.search = "";
  u.hash = "";
  if (u.pathname.endsWith("/index.html")) u.pathname = u.pathname.slice(0, -"index.html".length);
  return u.href;
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  // Only plain GETs inside /app/. Everything else (the HEAD probe for a local API, POSTs,
  // other origins) goes to the network as usual and fails quietly when offline.
  if (req.method !== "GET" || !req.url.startsWith(SCOPE)) return;

  if (req.url.startsWith(VENDOR_PREFIX)) {
    event.respondWith(vendorFirst(req));
    return;
  }
  event.respondWith(shellFirst(req));
});

/** Shell files: answer from the cache, fall back to the network (and keep a copy). */
async function shellFirst(req) {
  const cache = await caches.open(SHELL_CACHE);
  const key = req.mode === "navigate" ? shellKey(req.url) : req.url;
  const hit = await cache.match(key, { ignoreSearch: req.mode === "navigate" });
  if (hit) return hit;
  try {
    const res = await fetch(req);
    if (res.ok && res.type === "basic" && !res.redirected) cache.put(key, res.clone());
    return res;
  } catch (err) {
    // Offline and not cached: for a page, show the dashboard rather than a browser error.
    if (req.mode === "navigate") {
      const home = await cache.match(SCOPE);
      if (home) return home;
    }
    throw err;
  }
}

/** MediaPipe files: same idea, in their own cache so app updates do not re-download 18 MB. */
async function vendorFirst(req) {
  const cache = await caches.open(VENDOR_CACHE);
  const hit = await cache.match(req.url);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok && res.type === "basic") cache.put(req.url, res.clone());
  return res;
}
