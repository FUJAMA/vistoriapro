// VistoriaPro — Service Worker v2
const TILE_CACHE = 'vistoria-tiles-v1';
const APP_CACHE  = 'vistoria-app-v1';
const MAX_TILES  = 3000;

// Arquivos do app para cache offline
const APP_SHELL = [
  './vistoria-app.html',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  'https://fonts.googleapis.com/css2?family=Rajdhani:wght@400;500;600;700&family=DM+Sans:wght@300;400;500;600&display=swap',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js',
];

// Tile cinza 256x256 para fallback offline
const BLANK_TILE = 'iVBORw0KGgoAAAANSUhEUgAAAQAAAAEAAQMAAABmvDolAAAAA1BMVEWSkpLsOLEWAAAAH0lEQVR42u3BAQ0AAADCoPdP7WsIoAAAAAAAAAAAeQMBxAABagrXmgAAAABJRU5ErkJggg==';

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(APP_CACHE)
      .then(cache => cache.addAll(APP_SHELL).catch(err => console.warn('App shell cache parcial:', err)))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys
        .filter(k => k !== TILE_CACHE && k !== APP_CACHE)
        .map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = e.request.url;

  // ── Tiles OSM: cache-first, fallback cinza offline ───────────────────────
  if (url.includes('tile.openstreetmap.org')) {
    e.respondWith(
      caches.open(TILE_CACHE).then(async cache => {
        const cached = await cache.match(e.request);
        if (cached) return cached;
        try {
          const resp = await fetch(e.request.clone());
          if (resp && resp.ok) {
            const keys = await cache.keys();
            if (keys.length >= MAX_TILES) await cache.delete(keys[0]);
            cache.put(e.request, resp.clone());
          }
          return resp;
        } catch {
          const bytes = Uint8Array.from(atob(BLANK_TILE), c => c.charCodeAt(0));
          return new Response(bytes, { headers: { 'Content-Type': 'image/png' } });
        }
      })
    );
    return;
  }

  // ── App shell: cache-first ────────────────────────────────────────────────
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(resp => {
        if (resp && resp.ok && !url.includes('chrome-extension')) {
          caches.open(APP_CACHE).then(c => c.put(e.request, resp.clone()));
        }
        return resp;
      }).catch(() => caches.match('./vistoria-app.html'));
    })
  );
});
