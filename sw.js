// VistoriaPro — Service Worker v3
// Suporte: Tile Cache, App Shell, Background Sync, Periodic Sync, Push Notifications

const TILE_CACHE = 'vistoria-tiles-v1';
const APP_CACHE  = 'vistoria-app-v1';
const MAX_TILES  = 3000;

const APP_SHELL = [
  './index.html',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js',
];

const BLANK_TILE = 'iVBORw0KGgoAAAANSUhEUgAAAQAAAAEAAQMAAABmvDolAAAAA1BMVEWSkpLsOLEWAAAAH0lEQVR42u3BAQ0AAADCoPdP7WsIoAAAAAAAAAAAeQMBxAABagrXmgAAAABJRU5ErkJggg==';

// ── INSTALL ───────────────────────────────────────────────
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(APP_CACHE)
      .then(cache => cache.addAll(APP_SHELL).catch(err => console.warn('App shell parcial:', err)))
      .then(() => self.skipWaiting())
  );
});

// ── ACTIVATE ──────────────────────────────────────────────
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== TILE_CACHE && k !== APP_CACHE).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// ── FETCH (Tile cache + App shell) ────────────────────────
self.addEventListener('fetch', e => {
  const url = e.request.url;
  if (e.request.method !== 'GET') return;

  // Tiles OSM: cache-first, fallback cinza offline
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

  // App shell: cache-first
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(resp => {
        if (resp && resp.ok && !url.includes('chrome-extension')) {
          caches.open(APP_CACHE).then(c => c.put(e.request, resp.clone()));
        }
        return resp;
      }).catch(() => caches.match('./index.html'));
    })
  );
});

// ── BACKGROUND SYNC ───────────────────────────────────────
// Sincroniza vistorias pendentes quando a conexão é restaurada
self.addEventListener('sync', e => {
  console.log('[SW] Background sync:', e.tag);

  if (e.tag === 'sync-vistorias') {
    e.waitUntil(syncVistorias());
  }
  if (e.tag === 'sync-fotos') {
    e.waitUntil(syncFotos());
  }
});

async function syncVistorias() {
  // Notifica o cliente que está online e pode sincronizar
  const clients = await self.clients.matchAll();
  clients.forEach(client => {
    client.postMessage({ type: 'SYNC_VISTORIAS', status: 'online' });
  });
  console.log('[SW] syncVistorias executado');
}

async function syncFotos() {
  const clients = await self.clients.matchAll();
  clients.forEach(client => {
    client.postMessage({ type: 'SYNC_FOTOS', status: 'online' });
  });
  console.log('[SW] syncFotos executado');
}

// ── PERIODIC BACKGROUND SYNC ──────────────────────────────
// Executa periodicamente para verificar atualizações do app
self.addEventListener('periodicsync', e => {
  console.log('[SW] Periodic sync:', e.tag);

  if (e.tag === 'update-tiles') {
    e.waitUntil(atualizarTileCache());
  }
  if (e.tag === 'check-app-update') {
    e.waitUntil(verificarAtualizacaoApp());
  }
});

async function atualizarTileCache() {
  // Mantém o cache de tiles saudável removendo entradas antigas
  const cache = await caches.open(TILE_CACHE);
  const keys = await cache.keys();
  if (keys.length > MAX_TILES * 0.9) {
    const toDelete = keys.slice(0, Math.floor(keys.length * 0.1));
    await Promise.all(toDelete.map(k => cache.delete(k)));
    console.log('[SW] Cache de tiles limpo:', toDelete.length, 'tiles removidos');
  }
}

async function verificarAtualizacaoApp() {
  try {
    const cache = await caches.open(APP_CACHE);
    const resp = await fetch('./index.html', { cache: 'no-cache' });
    if (resp && resp.ok) {
      await cache.put('./index.html', resp);
      console.log('[SW] App atualizado via periodic sync');
    }
  } catch (err) {
    console.warn('[SW] Não foi possível verificar atualização:', err);
  }
}

// ── PUSH NOTIFICATIONS ────────────────────────────────────
self.addEventListener('push', e => {
  let data = { title: 'VistoriaPro', body: 'Notificação do sistema', icon: './icons/icon-192.png', badge: './icons/icon-96.png' };

  if (e.data) {
    try { data = { ...data, ...e.data.json() }; }
    catch { data.body = e.data.text(); }
  }

  const options = {
    body: data.body,
    icon: data.icon,
    badge: data.badge,
    vibrate: [100, 50, 100],
    data: { url: data.url || './', timestamp: Date.now() },
    actions: data.actions || [
      { action: 'abrir',    title: 'Abrir app' },
      { action: 'dispensar', title: 'Dispensar' }
    ],
    tag: data.tag || 'vistoriapro-notif',
    renotify: true,
    requireInteraction: false
  };

  e.waitUntil(
    self.registration.showNotification(data.title, options)
  );
});

// Clique na notificação
self.addEventListener('notificationclick', e => {
  e.notification.close();

  if (e.action === 'dispensar') return;

  const targetUrl = (e.notification.data && e.notification.data.url) || './';

  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
      // Se o app já está aberto, foca nele
      for (const client of clients) {
        if (client.url.includes('vistoriapro') && 'focus' in client) {
          return client.focus();
        }
      }
      // Senão abre uma nova janela
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
    })
  );
});

// Fechar notificação
self.addEventListener('notificationclose', e => {
  console.log('[SW] Notificação fechada:', e.notification.tag);
});

// Mensagens do cliente principal
self.addEventListener('message', e => {
  if (e.data && e.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  if (e.data && e.data.type === 'GET_CACHE_SIZE') {
    getCacheSize().then(size => {
      e.source.postMessage({ type: 'CACHE_SIZE', size });
    });
  }
});

async function getCacheSize() {
  let total = 0;
  const tileKeys = await (await caches.open(TILE_CACHE)).keys();
  total += tileKeys.length;
  return { tiles: tileKeys.length, max: MAX_TILES };
}
