// Service worker van de V3-weergave (/v3/): maakt haar installeerbaar en houdt de
// schil bij de hand als het netwerk even wegvalt. Gegevens komen nooit uit deze
// cache: alles naar Supabase (andere herkomst) gaat gewoon door.
const CACHE = "jarvis-v3-schil-v1";
const SCHIL = ["/v3/", "/v3/manifest.webmanifest", "/icon-192.png", "/icon-512.png", "/icon-maskable-512.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SCHIL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== self.location.origin) return;
  // Netwerk eerst (de pagina verandert bij elke uitrol); de cache als vangnet.
  e.respondWith(
    fetch(e.request)
      .then((antwoord) => { if (antwoord.ok) { const kopie = antwoord.clone(); e.waitUntil(caches.open(CACHE).then((c) => c.put(e.request, kopie))); } return antwoord; })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then((hit) => hit ?? (e.request.mode === "navigate" ? caches.match("/v3/") : Response.error()))),
  );
});
