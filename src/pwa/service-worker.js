// Template for dist/service-worker.js. The build fills in the two constants below (see serviceWorkerShell in vite.config.ts),
// so the shell list always matches the index.html that was deployed and every deploy gets new cache names.
const SHELL_URLS = []
const BUILD_ID = 'development'
const SHELL_CACHE = `urban-tanker-shell-${BUILD_ID}`
const ASSET_CACHE = `urban-tanker-assets-${BUILD_ID}`
// Lazily loaded route chunks are cached as they are used. Only the newest entries are kept.
const ASSET_CACHE_LIMIT = 80
const NETWORK_FIRST_PATHS = new Set(['/manifest.json', '/robots.txt', '/sitemap.xml'])

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL_URLS.map((url) => new Request(url, { cache: 'reload' })))).then(() => self.skipWaiting()))
})

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith('urban-tanker-') && key !== SHELL_CACHE && key !== ASSET_CACHE).map((key) => caches.delete(key)))).then(() => self.clients.claim()))
})

async function trimAssetCache(cache) {
  const keys = await cache.keys()
  await Promise.all(keys.slice(0, Math.max(0, keys.length - ASSET_CACHE_LIMIT)).map((key) => cache.delete(key)))
}

async function handleNavigation(request) {
  const cache = await caches.open(SHELL_CACHE)
  try {
    const response = await fetch(request)
    if (response.ok) cache.put('/', response.clone()).catch(() => undefined)
    return response
  } catch {
    return (await cache.match('/')) ?? Response.error()
  }
}

function handleAsset(event) {
  return caches.open(ASSET_CACHE).then(async (cache) => {
    const cached = await cache.match(event.request)
    if (cached) return cached
    const response = await fetch(event.request)
    if (response.ok) event.waitUntil(cache.put(event.request, response.clone()).then(() => trimAssetCache(cache)).catch(() => undefined))
    return response
  })
}

async function handleNetworkFirst(request) {
  const cache = await caches.open(SHELL_CACHE)
  try {
    const response = await fetch(request)
    if (response.ok) cache.put(request, response.clone()).catch(() => undefined)
    return response
  } catch {
    return (await cache.match(request)) ?? Response.error()
  }
}

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return
  const requestUrl = new URL(event.request.url)
  if (requestUrl.origin !== self.location.origin) return
  if (event.request.mode === 'navigate') return event.respondWith(handleNavigation(event.request))
  if (requestUrl.pathname.startsWith('/assets/')) return event.respondWith(handleAsset(event))
  if (NETWORK_FIRST_PATHS.has(requestUrl.pathname)) event.respondWith(handleNetworkFirst(event.request))
})

self.addEventListener('push', (event) => {
  let data = null
  try { data = event.data?.json() ?? null } catch { data = null }
  const message = data && typeof data === 'object' ? data : { title: 'Urban Tanker update', body: 'You have a new booking update.' }
  event.waitUntil(self.registration.showNotification(message.title ?? 'Urban Tanker update', { body: message.body ?? message.detail ?? '', icon: '/urban-tanker-mark-192.png', badge: '/urban-tanker-badge-96.png', data: { url: message.url ?? '/' } }))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  let target
  try { target = new URL(event.notification.data?.url ?? '/', self.location.origin) } catch { return }
  if (target.origin !== self.location.origin) return
  event.waitUntil(clients.openWindow(target.href))
})

self.addEventListener('sync', (event) => {
  if (event.tag !== 'urban-tanker-outbox') return
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
    clients.forEach((client) => client.postMessage({ type: 'urban-tanker-sync' }))
  }))
})
