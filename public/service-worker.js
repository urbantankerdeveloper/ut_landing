const CACHE = 'urban-tanker-shell-v4'
const STATIC_PATHS = new Set(['/manifest.json', '/robots.txt', '/sitemap.xml', '/assets/urban-tanker-hero.jpg'])
const PRECACHE = ['/', ...STATIC_PATHS]

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting()))
})

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))).then(() => self.clients.claim()))
})

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return
  const requestUrl = new URL(event.request.url)
  if (requestUrl.origin !== self.location.origin) return
  if (event.request.mode === 'navigate') {
    const networkResponse = fetch(event.request)
    event.waitUntil(networkResponse.then((response) => response.ok ? caches.open(CACHE).then((cache) => cache.put('/', response.clone())) : undefined).catch(() => undefined))
    event.respondWith(networkResponse.catch(async () => (await caches.match(event.request)) ?? (await caches.match('/')) ?? Response.error()))
    return
  }
  const fileName = requestUrl.pathname.split('/').at(-1) ?? ''
  const immutableAsset = requestUrl.pathname.startsWith('/assets/') && /[-.][a-zA-Z0-9_-]{8,}\./.test(fileName)
  if (immutableAsset) {
    const networkResponse = fetch(event.request)
    event.waitUntil(networkResponse.then((response) => response.ok ? caches.open(CACHE).then((cache) => cache.put(event.request, response.clone())) : undefined).catch(() => undefined))
    event.respondWith(caches.match(event.request).then((cached) => cached ?? networkResponse))
    return
  }
  if (!STATIC_PATHS.has(requestUrl.pathname)) return
  const networkResponse = fetch(event.request)
  event.waitUntil(networkResponse.then((response) => response.ok ? caches.open(CACHE).then((cache) => cache.put(event.request, response.clone())) : undefined).catch(() => undefined))
  event.respondWith(networkResponse.catch(async () => (await caches.match(event.request)) ?? Response.error()))
})

self.addEventListener('push', (event) => {
  let data = null
  try { data = event.data?.json() ?? null } catch { data = null }
  const message = data && typeof data === 'object' ? data : { title: 'Urban Tanker update', body: 'You have a new booking update.' }
  event.waitUntil(self.registration.showNotification(message.title ?? 'Urban Tanker update', { body: message.body ?? message.detail ?? '', icon: '/manifest.json', data: { url: message.url ?? '/' } }))
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
