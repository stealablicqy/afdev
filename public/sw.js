/* AF Hub app-shell cache plus an opt-in-or-on-by-default shield for known tracker requests initiated by AF Hub itself.
   It does not proxy traffic, inspect TLS, or protect other browser tabs/apps. */
const CACHE = 'af-hub-desync-inspired-v10';
const SHELL = [
  './', './index.html', './css/app.css', './css/desync-inspired.css', './css/af-music.css','./css/browser.css',
  './js/supabase-client.js', './js/db.js', './js/games.js', './js/music.js', './js/app.js',
  './assets/af-mark.svg', './assets/tab-calc.svg', './assets/tab-notes.svg',
  './assets/tab-calendar.svg', './assets/covers/2048.svg', './assets/covers/chess.svg',
  './assets/covers/coolmath.svg', './assets/covers/crazygames.svg', './assets/covers/guess-tab.svg',
  './assets/covers/itch.svg', './assets/covers/memory.svg', './assets/covers/poki.svg',
  './assets/covers/scratch.svg', './assets/covers/sprint.svg', './assets/covers/words.svg',
  './manifest.webmanifest'
];
const SHIELD_KEY = new URL('__afhub_shield_state__', self.registration.scope).href;
const TRACKER_HOSTS = [
  'doubleclick.net', 'googlesyndication.com', 'googleadservices.com',
  'google-analytics.com', 'connect.facebook.net', 'facebook.net',
  'hotjar.com', 'clarity.ms', 'taboola.com', 'outbrain.com', 'adnxs.com'
];
let shieldEnabled = true;

function isTracker(hostname) {
  const host = hostname.toLowerCase();
  return TRACKER_HOSTS.some(domain => host === domain || host.endsWith('.' + domain));
}
async function readShieldState() {
  try {
    const cache = await caches.open(CACHE);
    const stored = await cache.match(SHIELD_KEY);
    if (stored) shieldEnabled = (await stored.text()) !== 'off';
  } catch { /* Keep safe default if storage is unavailable. */ }
  return shieldEnabled;
}
async function writeShieldState(enabled) {
  shieldEnabled = !!enabled;
  const cache = await caches.open(CACHE);
  await cache.put(SHIELD_KEY, new Response(shieldEnabled ? 'on' : 'off', {headers:{'Content-Type':'text/plain'}}));
}

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    await caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('af-hub-') && key !== CACHE).map(key => caches.delete(key))));
    await readShieldState();
    await self.clients.claim();
  })());
});
self.addEventListener('message', event => {
  const data = event.data || {};
  if (data.type === 'AFHUB_SHIELD' && typeof data.enabled === 'boolean') {
    event.waitUntil(writeShieldState(data.enabled));
  }
});
// Paths owned by a proxy lane. This worker is registered at scope "/" so it can
// cache the hub shell, which means it also sees every proxied page — including
// Rammerhead's, now that engine shares the hub origin. Those responses belong to
// the engine, not the app shell: caching one would pin a proxied page in the
// hub cache, and the offline fallback below would answer a proxied navigation
// with index.html. Hand them straight back to the browser.
const PROXY_ROUTES = new Set([
  '/hammerhead.js', '/worker-hammerhead.js', '/transport-worker.js', '/task.js',
  '/iframe-task.js', '/messaging', '/rammerhead.js', '/api/shuffleDict', '/syncLocalStorage'
]);
const PROXY_PREFIXES = ['/scramjet/', '/uv/', '/baremux/', '/transport/', '/wisp/'];
const PROXY_SESSION = /^\/[0-9a-f]{32}(?:[/!]|$)/;

function isProxyPath(pathname) {
  if (PROXY_ROUTES.has(pathname)) return true;
  if (PROXY_SESSION.test(pathname)) return true;
  return PROXY_PREFIXES.some(prefix => pathname.startsWith(prefix));
}

function asHtml(body) {
  return new Response(body, {
    status: 200,
    headers: {'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store'}
  });
}

// Static CDNs that refuse to serve text/html (jsDelivr is one) hand documents
// back as text/plain, which renders as source instead of a page. The app is
// hosted on one of those CDNs, so it boots from index.svg and every navigation
// lands here: fetch the file, and re-wrap anything that came back as plain text.
async function serveDocument(request) {
  const url = new URL(request.url);
  const target = url.pathname.endsWith('/')
    ? new Request(new URL(url.pathname + 'index.html', url).href, {headers: request.headers})
    : request;

  let response;
  try {
    response = await fetch(target, {redirect: 'follow'});
  } catch {
    const shell = await caches.match('./index.html');
    return shell ? asHtml(await shell.text()) : Response.error();
  }

  if (response.status === 404) {
    // SPA and synthetic routes: index.svg navigates to /app, the app itself uses
    // hash routes, so an unknown document path falls back to the shell.
    const shell = await caches.match('./index.html');
    if (shell) return asHtml(await shell.text());
    return response;
  }

  const type = (response.headers.get('content-type') || '').toLowerCase();
  if (response.ok && (type.startsWith('text/plain') || type.startsWith('application/octet-stream'))) {
    return asHtml(await response.text());
  }
  return response;
}

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  if (url.origin === self.location.origin && isProxyPath(url.pathname)) return;

  if (request.mode === 'navigate' && url.origin === self.location.origin) {
    event.respondWith(serveDocument(request));
    return;
  }

  // Only block known ad/analytics host resources. Never block navigations, documents,
  // frames, media streams, or same-origin app files.
  if (request.mode !== 'navigate' && request.destination !== 'document' &&
      request.destination !== 'iframe' && request.destination !== 'video' &&
      request.destination !== 'audio' && request.destination !== 'track' &&
      url.origin !== self.location.origin && isTracker(url.hostname)) {
    event.respondWith((async () => {
      if (await readShieldState()) {
        return new Response('', {status:200, headers:{'Content-Type':'text/plain','Access-Control-Allow-Origin':'*','Cache-Control':'no-store','X-AFHub-Blocked':'tracker'}});
      }
      return fetch(request);
    })());
    return;
  }

  if (url.origin !== self.location.origin || url.pathname.includes('/api/')) return;
  // App files are network-first so a deploy is visible on the next reload; the
  // cache is only the offline fallback. Cache-first here used to pin an old
  // music.js in Chromebook profiles until the cache name was bumped.
  event.respondWith((async () => {
    try {
      const response = await fetch(request);
      if (response.ok && ['script','style','document','image'].includes(request.destination)) {
        const copy = response.clone();
        caches.open(CACHE).then(cache => cache.put(request, copy));
      }
      return response;
    } catch {
      const cached = await caches.match(request);
      if (cached) return cached;
      if (request.mode === 'navigate') return caches.match('./index.html');
      throw new Error('Offline asset is not cached');
    }
  })());
});
