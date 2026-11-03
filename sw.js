const CACHE = "pixel-music-v1";
const ASSETS = [
  "./index.html",
  "./css/app.css",
  "./js/app.js",
  "./js/db.js",
  "./js/format.js",
  "./js/ids.js",
  "./js/library.js",
  "./js/playlists.js",
  "./js/queue.js",
  "./js/soundcloud.js",
  "./js/soundcloud-client.js",
  "./js/tags.js",
  "./manifest.json",
  "./fonts/PressStart2P-Regular.woff2",
  "./fonts/Silkscreen-Regular.woff2",
  "./icons/icon-32.png",
  "./icons/icon-180.png",
  "./icons/apple-touch-icon.png",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

async function fromCacheOrNetwork(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const fresh = await fetch(request);
  if (fresh.ok) {
    const cache = await caches.open(CACHE);
    cache.put(request, fresh.clone());
  }
  return fresh;
}

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin) return;
  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put("./index.html", copy));
          return response;
        })
        .catch(() => caches.match("./index.html").then((cached) => cached || caches.match("./"))),
    );
    return;
  }
  event.respondWith(fromCacheOrNetwork(event.request));
});
