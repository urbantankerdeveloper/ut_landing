import { useAuthStore } from '../stores/authStore'

export type QueuedMutation = {
  id: string
  endpoint: string
  init: RequestInit
  createdAt: string
  serverMutationId?: string
  clientVersion: number
  conflictStatus: 'queued' | 'conflict' | 'applied' | 'discarded'
}

const STORAGE_PREFIX = 'urban-tanker-vendor-offline-mutations'
const DB_PREFIX = 'urban-tanker-outbox'
const STORE_NAME = 'mutations'
const SYNC_TAG = 'urban-tanker-outbox'
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000
let loadedOwner: string | null = null
let queue: QueuedMutation[] = []
let persistenceReady: Promise<void> = Promise.resolve()
let inFlightFlush: Promise<number> | null = null

function currentOwner() {
  return useAuthStore.getState().user?.username ?? 'anonymous'
}

function storageKey(owner: string) { return `${STORAGE_PREFIX}:${owner}` }

function databaseName(owner: string) { return `${DB_PREFIX}:${owner}` }

function withinRetention(mutation: QueuedMutation) {
  const createdAt = Date.parse(mutation.createdAt)
  return Number.isFinite(createdAt) && Date.now() - createdAt < RETENTION_MS
}

function readLocalQueue(owner: string): QueuedMutation[] {
  if (typeof localStorage === 'undefined') return []
  try {
    return (JSON.parse(localStorage.getItem(storageKey(owner)) ?? '[]') as QueuedMutation[]).filter(withinRetention)
  } catch {
    return []
  }
}

function writeLocalQueue(owner: string, value: QueuedMutation[]) {
  try { localStorage.setItem(storageKey(owner), JSON.stringify(value)) } catch { /* storage may be unavailable */ }
}

function idbAvailable() {
  return typeof indexedDB !== 'undefined'
}

function openDatabase(name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, 1)
    request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME, { keyPath: 'id' })
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function loadFromOutbox(owner: string) {
  if (!idbAvailable()) return
  try {
    const db = await openDatabase(databaseName(owner))
    const records = await new Promise<QueuedMutation[]>((resolve, reject) => {
      const request = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).getAll()
      request.onsuccess = () => resolve(request.result as QueuedMutation[])
      request.onerror = () => reject(request.error)
    })
    if (loadedOwner !== owner) { db.close(); return }
    const retained = records.filter(withinRetention)
    if (retained.length) {
      queue = retained
      writeLocalQueue(owner, queue)
    } else if (queue.length) {
      await saveOutbox(owner, queue)
    }
    db.close()
  } catch { /* localStorage remains the safe fallback */ }
}

async function saveOutbox(owner: string, records: QueuedMutation[]) {
  if (!idbAvailable()) return
  try {
    const db = await openDatabase(databaseName(owner))
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite')
      transaction.objectStore(STORE_NAME).clear()
      records.forEach((record) => transaction.objectStore(STORE_NAME).put(record))
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
    })
    db.close()
  } catch { /* localStorage remains the safe fallback */ }
}

function persist() {
  const owner = loadedOwner ?? 'anonymous'
  const snapshot = queue
  writeLocalQueue(owner, snapshot)
  persistenceReady = persistenceReady.then(() => saveOutbox(owner, snapshot))
  return persistenceReady
}

function syncOwner() {
  const owner = currentOwner()
  if (owner === loadedOwner) return
  loadedOwner = owner
  queue = readLocalQueue(owner)
  persistenceReady = typeof window === 'undefined' ? Promise.resolve() : loadFromOutbox(owner)
}

function requestBackgroundSync() {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return
  void navigator.serviceWorker.ready.then((registration) => {
    const syncManager = (registration as ServiceWorkerRegistration & { sync?: { register: (tag: string) => Promise<void> } }).sync
    if (syncManager) return syncManager.register(SYNC_TAG)
  }).catch(() => { /* online event fallback still flushes the queue */ })
}

export function queuedMutations() { syncOwner(); return [...queue] }
export function clearOfflineQueue() { syncOwner(); queue = []; void persist() }
export function retryQueuedMutation(id: string) { syncOwner(); queue = queue.map((item) => item.id === id ? { ...item, conflictStatus: 'queued' as const } : item); void persist(); requestBackgroundSync() }
export function discardQueuedMutation(id: string) { syncOwner(); queue = queue.filter((item) => item.id !== id); void persist() }
export function enqueueMutation(mutation: Omit<QueuedMutation, 'id' | 'createdAt' | 'clientVersion' | 'conflictStatus'>) {
  syncOwner()
  const previous = queue.filter((item) => item.endpoint === mutation.endpoint).length
  queue = [...queue, { ...mutation, id: crypto.randomUUID(), createdAt: new Date().toISOString(), clientVersion: previous + 1, conflictStatus: 'queued' }]
  void persist()
  requestBackgroundSync()
  return queue.length
}
export function queuedMutationCount() { syncOwner(); return queue.length }

function offlineMutationDetails(mutation: QueuedMutation) {
  const path = mutation.endpoint.split('?')[0]
  const segments = path.split('/').filter(Boolean)
  const entityId = segments.length > 2 && /^[0-9a-f-]{36}$/i.test(segments[2]) ? segments[2] : undefined
  let payload: Record<string, unknown> = {}
  try { payload = mutation.init.body ? JSON.parse(String(mutation.init.body)) as Record<string, unknown> : {} } catch { /* malformed payload will be rejected by the API */ }
  return { mutationType: mutation.init.method?.toLowerCase() ?? 'mutation', entityType: segments[1] ?? 'unknown', entityId, payload }
}

export function flushMutationQueue(
  fetcher: (endpoint: string, init: RequestInit) => Promise<unknown>,
  registerMutation?: (mutation: { mutationType: string; entityType: string; entityId?: string; payload: Record<string, unknown>; clientVersion: number }) => Promise<{ id: string }>,
) {
  inFlightFlush ??= runFlush(fetcher, registerMutation).finally(() => { inFlightFlush = null })
  return inFlightFlush
}

async function runFlush(
  fetcher: (endpoint: string, init: RequestInit) => Promise<unknown>,
  registerMutation?: (mutation: { mutationType: string; entityType: string; entityId?: string; payload: Record<string, unknown>; clientVersion: number }) => Promise<{ id: string }>,
) {
  if (typeof navigator === 'undefined' || !navigator.onLine) return 0
  syncOwner()
  await persistenceReady
  const owner = loadedOwner
  const sent = new Set<string>()
  const failed = new Set<string>()
  const serverIds = new Map<string, string>()
  let flushed = 0
  for (const mutation of queue.filter(withinRetention)) {
    if (loadedOwner !== owner) break
    try {
      let serverMutationId = mutation.serverMutationId
      if (!serverMutationId && registerMutation) {
        serverMutationId = (await registerMutation({ ...offlineMutationDetails(mutation), clientVersion: mutation.clientVersion })).id
        serverIds.set(mutation.id, serverMutationId)
      }
      const init = { ...mutation.init, headers: { ...(mutation.init.headers ?? {}), ...(serverMutationId ? { 'x-offline-mutation-id': serverMutationId } : {}), 'x-client-version': String(mutation.clientVersion) } }
      await fetcher(mutation.endpoint, init)
      sent.add(mutation.id)
      flushed += 1
    } catch {
      failed.add(mutation.id)
    }
  }
  if (loadedOwner !== owner) return flushed
  queue = queue
    .filter((item) => !sent.has(item.id) && withinRetention(item))
    .map((item) => ({
      ...item,
      ...(serverIds.has(item.id) ? { serverMutationId: serverIds.get(item.id) } : {}),
      ...(failed.has(item.id) ? { conflictStatus: 'conflict' as const } : {}),
    }))
  await persist()
  return flushed
}
