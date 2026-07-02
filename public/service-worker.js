const CACHE_VERSION = 'v3';
const SHELL_CACHE = `pyp-shell-${CACHE_VERSION}`;
const PAGE_CACHE = `pyp-pages-${CACHE_VERSION}`;
const STATIC_CACHE = `pyp-static-${CACHE_VERSION}`;

const APP_SHELL = [
  '/',
  '/index.html',
  '/landing.html',
  '/questions.html',
  '/app.html',
  '/share.html',
  '/about',
  '/about.html',
  '/methodology',
  '/methodology.html',
  '/faq',
  '/faq.html',
  '/offline.html',
  '/manifest.json',
  '/js/pyp-core.js',
  '/js/pyp-pwa.js',
  '/icons/icon-192.svg',
  '/icons/icon-512.svg'
];

const NEVER_CACHE_PATHS = [
  '/.netlify/functions/'
];

function isNeverCacheRequest(request, url) {
  if (request.method !== 'GET') return true;
  if (NEVER_CACHE_PATHS.some(path => url.pathname.startsWith(path))) return true;
  if (url.pathname.includes('/auth/v1/') || url.pathname.includes('/rest/v1/')) return true;
  return false;
}

function isStaticAsset(url) {
  return /\.(?:css|js|svg|png|jpg|jpeg|webp|ico|woff2?)$/i.test(url.pathname);
}

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then(cache => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  const allowed = new Set([SHELL_CACHE, PAGE_CACHE, STATIC_CACHE]);
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => !allowed.has(key)).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  if (isNeverCacheRequest(event.request, url)) {
    event.respondWith(fetch(event.request));
    return;
  }

  if (event.request.mode === 'navigate') {
    event.respondWith(networkFirstPage(event.request));
    return;
  }

  if (url.origin === self.location.origin && isStaticAsset(url)) {
    event.respondWith(cacheFirst(event.request, STATIC_CACHE));
    return;
  }

  event.respondWith(fetch(event.request).catch(() => caches.match(event.request)));
});

async function networkFirstPage(request) {
  const cache = await caches.open(PAGE_CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) await cache.put(request, response.clone());
    return response;
  } catch {
    return (await cache.match(request))
      || (await caches.match(request))
      || (await caches.match('/offline.html'))
      || (await caches.match('/index.html'));
  }
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) await cache.put(request, response.clone());
  return response;
}
