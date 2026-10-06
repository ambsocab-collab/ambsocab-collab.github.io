/* Funciona sin conexión: la app entera se guarda en el dispositivo. Con conexión, se abre lo guardado y se trae la
   versión nueva para la siguiente vez. Los datos no pasan por aquí: viven en el dispositivo (IndexedDB). */
const VERSION = "hoja-campo-202610062354";
const APP = ["./", "index.html", "app.js", "modelo.js", "xlsx.js", "repo.js", "vendor/jszip.min.js", "manifest.webmanifest",
  "icons/icon-192.png", "icons/icon-512.png", "icons/icon-maskable-512.png", "icons/apple-touch-icon.png", "icons/favicon-32.png", "icons/logo.png"];
self.addEventListener("install", e => e.waitUntil(caches.open(VERSION).then(c => c.addAll(APP)).then(() => self.skipWaiting())));
self.addEventListener("activate", e => e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION && k !== FOTOS).map(k => caches.delete(k)))).then(() => self.clients.claim())));
const FOTOS = "hoja-campo-fotos";  // miniaturas de Drive vistas con conexión, para verlas sin ella (no se borra al actualizar)
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method === "GET" && url.hostname === "drive.google.com" && url.pathname === "/thumbnail") {
    e.respondWith(caches.open(FOTOS).then(async c => {
      const guardada = await c.match(e.request.url);
      if (guardada) return guardada;
      const r = await fetch(e.request.url, { mode: "no-cors", credentials: "include" });
      if (r.ok || r.type === "opaque") c.put(e.request.url, r.clone());
      return r;
    }));
    return;
  }
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  e.respondWith(caches.open(VERSION).then(async c => {
    const guardada = await c.match(e.request, { ignoreSearch: true });
    const red = fetch(e.request).then(r => { if (r.ok) c.put(e.request, r.clone()); return r; }).catch(() => guardada);
    return guardada || red;
  }));
});
