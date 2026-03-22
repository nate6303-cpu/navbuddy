// NavBuddy Service Worker
// Cache-first strategy: app shell cached on install, served offline instantly.
// Network-first for OSM tiles (map tiles) — fall back to cache if offline.
// CDN assets (Leaflet, fonts) cached on first fetch.

const VERSION      = 'navbuddy-v4.1';
const SHELL_CACHE  = VERSION + '-shell';
const TILE_CACHE   = VERSION + '-tiles';
const CDN_CACHE    = VERSION + '-cdn';

// App shell — everything needed to run fully offline
const SHELL_ASSETS = [
  './',
  './index.html',
];

// CDN assets to cache on first use
const CDN_HOSTS = [
  'cdnjs.cloudflare.com',
  'fonts.googleapis.com',
  'fonts.gstatic.com',
];

// ── Install: cache the app shell ─────────────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then(cache => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting())
  );
});

// ── Activate: remove old caches ──────────────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k.startsWith('navbuddy-') && k !== SHELL_CACHE && k !== TILE_CACHE && k !== CDN_CACHE)
          .map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// ── Fetch: route requests ────────────────────────────────────────────────
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // OSM map tiles — network first, fall back to tile cache
  if (url.hostname.endsWith('tile.openstreetmap.org')) {
    event.respondWith(networkFirstTile(event.request));
    return;
  }

  // CDN assets (Leaflet JS/CSS, Google Fonts) — cache first
  if (CDN_HOSTS.some(h => url.hostname === h || url.hostname.endsWith('.' + h))) {
    event.respondWith(cacheFirstCDN(event.request));
    return;
  }

  // Time API calls — always network, never cache
  if (url.hostname === 'worldtimeapi.org' || url.hostname === 'timeapi.io') {
    event.respondWith(fetch(event.request).catch(() =>
      new Response(JSON.stringify({error:'offline'}), {headers:{'Content-Type':'application/json'}})
    ));
    return;
  }

  // App shell (same origin) — cache first, network fallback
  if (url.origin === self.location.origin) {
    event.respondWith(cacheFirstShell(event.request));
    return;
  }

  // Everything else — network only
  event.respondWith(fetch(event.request));
});

// ── Strategy: cache-first (shell) ────────────────────────────────────────
async function cacheFirstShell(request) {
  const cached = await caches.match(request, { cacheName: SHELL_CACHE, ignoreSearch: true });
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(SHELL_CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    // Return the root index as fallback for any navigation request
    const fallback = await caches.match('./', { cacheName: SHELL_CACHE, ignoreSearch: true });
    return fallback || new Response('NavBuddy is offline and not yet cached.', { status: 503 });
  }
}

// ── Strategy: cache-first (CDN) ──────────────────────────────────────────
async function cacheFirstCDN(request) {
  const cached = await caches.match(request, { cacheName: CDN_CACHE });
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CDN_CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return new Response('', { status: 503 });
  }
}

// ── Strategy: network-first (tiles) ──────────────────────────────────────
async function networkFirstTile(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(TILE_CACHE);
      // Limit tile cache size — evict oldest when over 500 tiles (~50MB)
      cache.put(request, response.clone());
      trimTileCache();
    }
    return response;
  } catch {
    const cached = await caches.match(request, { cacheName: TILE_CACHE });
    return cached || new Response('', { status: 503 });
  }
}

// Keep tile cache under 500 entries
async function trimTileCache() {
  const cache = await caches.open(TILE_CACHE);
  const keys  = await cache.keys();
  if (keys.length > 500) {
    // Delete oldest 50
    for (let i = 0; i < 50; i++) await cache.delete(keys[i]);
  }
}
