const APP_VERSION = '{{APP_ASSET_VERSION}}';
const SHELL_CACHE = `morse-news-shell-${APP_VERSION}`;
const DATA_CACHE = 'morse-news-data';
const NETWORK_TIMEOUT_MS = 4000;
const OFFLINE_HEADER = 'X-Morse-News-Offline';
const HISTORY_DAYS = 7;
const HISTORY_MAX_SETS = 40;

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
    const isLatest = !url.searchParams.has('index') || url.searchParams.get('index') === '0';
    event.respondWith(networkFirst(request, DATA_CACHE, url.pathname + url.search, {
      onFresh: isLatest ? (response) => event.waitUntil(saveHeadlineHistory(response)) : null,
    }));
    return;
  }
  if (url.pathname.startsWith('/api/') || url.pathname === '/sw.js') return;

  event.respondWith(cacheFirst(request));
});

async function networkFirst(request, cacheName, cacheKey, { onFresh = null } = {}) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetchWithTimeout(request, NETWORK_TIMEOUT_MS);
    if (response.ok) {
      await cache.put(cacheKey, response.clone());
      onFresh?.(response.clone());
    }
    return response;
  } catch (error) {
    const cached = await cache.match(cacheKey);
    if (!cached) throw error;
    return markOffline(cached);
  }
}

// Archive indexes are relative to the latest set, so the whole recent history
// is re-saved together whenever a fresh latest set arrives.
async function saveHeadlineHistory(latestResponse) {
  try {
    const latest = await latestResponse.json();
    const cutoff = new Date(latest.fetchedAt).getTime() - HISTORY_DAYS * 24 * 60 * 60 * 1000;
    let responses = [];
    try {
      let hasPrevious = Boolean(latest.archive?.hasPrevious);
      for (let index = 1; hasPrevious && index <= HISTORY_MAX_SETS; index += 1) {
        // no-store keeps these out of the HTTP cache; this cache is the only saved copy.
        const response = await fetch(`/api/headlines?index=${index}`, { cache: 'no-store' });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const payload = await response.clone().json();
        if (new Date(payload.fetchedAt).getTime() < cutoff) break;
        responses.push([`/api/headlines?index=${index}`, response]);
        hasPrevious = Boolean(payload.archive?.hasPrevious);
      }
    } catch (error) {
      // A partial history could be misaligned with the new latest set; drop it.
      console.warn('Could not download headline history; clearing saved history', error);
      responses = [];
    }

    const cache = await caches.open(DATA_CACHE);
    const keep = new Set(['/api/headlines', '/api/headlines?index=0', ...responses.map(([key]) => key)]);
    await Promise.all(responses.map(([key, response]) => cache.put(key, response)));
    const stale = (await cache.keys()).filter((request) => {
      const url = new URL(request.url);
      return !keep.has(url.pathname + url.search);
    });
    await Promise.all(stale.map((request) => cache.delete(request)));
  } catch (error) {
    console.warn('Could not save headline history for offline use', error);
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
