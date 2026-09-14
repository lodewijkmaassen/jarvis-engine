// Service worker van de Jarvis-app: maakt haar installeerbaar en houdt de
// schil (pagina, iconen, manifest) bij de hand als het netwerk even wegvalt.
// Gegevens komen nooit uit deze cache: alles naar Supabase gaat gewoon door.
const CACHE = "jarvis-schil-v1";
const SCHIL = ["/", "/index.html", "/manifest.webmanifest", "/icon-192.png", "/icon-512.png"];

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
      .then((antwoord) => { if (antwoord.ok) caches.open(CACHE).then((c) => c.put(e.request, antwoord.clone())); return antwoord; })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then((hit) => hit ?? (e.request.mode === "navigate" ? caches.match("/index.html") : Response.error()))),
  );
});
