const APP_VERSION = '{{APP_ASSET_VERSION}}';
const SHELL_CACHE = `morse-news-shell-${APP_VERSION}`;
const DATA_CACHE = 'morse-news-data';
const NETWORK_TIMEOUT_MS = 4000;
const OFFLINE_HEADER = 'X-Morse-News-Offline';

const PAGE_PATHS = new Map([
  ['/', '/'],
  ['/index.html', '/'],
  ['/reference', '/reference'],
  ['/reference.html', '/reference'],
]);

const SHELL_URLS = [
  '/',
  '/reference',
  `/styles.css?v=${APP_VERSION}`,
  `/app.js?v=${APP_VERSION}`,
  `/reference.js?v=${APP_VERSION}`,
  '/morse-timing.js',
  '/playback-state.js',
  '/pwa.js',
  '/manifest.webmanifest',
  '/icons/icon.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    await cache.addAll(SHELL_URLS.map((url) => new Request(url, { cache: 'reload' })));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names
      .filter((name) => name.startsWith('morse-news-shell-') && name !== SHELL_CACHE)
      .map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate' && PAGE_PATHS.has(url.pathname)) {
    event.respondWith(networkFirst(request, SHELL_CACHE, PAGE_PATHS.get(url.pathname)));
    return;
  }
  if (url.pathname === '/api/headlines') {
    event.respondWith(networkFirst(request, DATA_CACHE, url.pathname + url.search));
    return;
  }
  if (url.pathname.startsWith('/api/') || url.pathname === '/sw.js') return;

  event.respondWith(cacheFirst(request));
});

async function networkFirst(request, cacheName, cacheKey) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetchWithTimeout(request, NETWORK_TIMEOUT_MS);
    if (response.ok) await cache.put(cacheKey, response.clone());
    return response;
  } catch (error) {
    const cached = await cache.match(cacheKey);
    if (!cached) throw error;
    return markOffline(cached);
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(SHELL_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (response.ok) await cache.put(request, response.clone());
  return response;
}

function fetchWithTimeout(request, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(request, { signal: controller.signal }).finally(() => clearTimeout(timer));
}

async function markOffline(response) {
  const headers = new Headers(response.headers);
  headers.set(OFFLINE_HEADER, '1');
  return new Response(await response.blob(), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
