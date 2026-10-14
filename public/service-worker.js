const CACHE = 'urban-tanker-shell-v2'
const PRECACHE = ['/', '/manifest.json', '/robots.txt', '/sitemap.xml', '/assets/urban-tanker-hero.jpg']

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
  if (requestUrl.pathname.startsWith('/api/')) return
  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request).then((response) => { const copy = response.clone(); caches.open(CACHE).then((cache) => cache.put('/', copy)); return response }).catch(() => caches.match('/')))
    return
  }
  event.respondWith(caches.match(event.request).then((cached) => cached ?? fetch(event.request).then((response) => { const copy = response.clone(); caches.open(CACHE).then((cache) => cache.put(event.request, copy)); return response })))
})

self.addEventListener('push', (event) => {
  const data = event.data?.json() ?? { title: 'Urban Tanker update', body: 'You have a new booking update.' }
  event.waitUntil(self.registration.showNotification(data.title ?? 'Urban Tanker update', { body: data.body ?? data.detail ?? '', icon: '/manifest.json', data: { url: data.url ?? '/' } }))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  event.waitUntil(clients.openWindow(event.notification.data?.url ?? '/'))
})

self.addEventListener('sync', (event) => {
  if (event.tag !== 'urban-tanker-outbox') return
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
    clients.forEach((client) => client.postMessage({ type: 'urban-tanker-sync' }))
  }))
})
