export type QueuedMutation = {
  id: string
  endpoint: string
  init: RequestInit
  createdAt: string
  serverMutationId?: string
  clientVersion: number
  conflictStatus: 'queued' | 'conflict' | 'applied' | 'discarded'
}

const STORAGE_KEY = 'urban-tanker-vendor-offline-mutations'
const DB_NAME = 'urban-tanker-outbox'
const STORE_NAME = 'mutations'
const SYNC_TAG = 'urban-tanker-outbox'
let queue = readLocalQueue()
let persistenceReady: Promise<void> = Promise.resolve()

function readLocalQueue(): QueuedMutation[] {
  if (typeof localStorage === 'undefined') return []
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]') as QueuedMutation[]
  } catch {
    return []
  }
}

function writeLocalQueue(value: QueuedMutation[]) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(value)) } catch { /* storage may be unavailable */ }
}

function idbAvailable() {
  return typeof indexedDB !== 'undefined'
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME, { keyPath: 'id' })
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function loadFromOutbox() {
  if (!idbAvailable()) return
  try {
    const db = await openDatabase()
    const records = await new Promise<QueuedMutation[]>((resolve, reject) => {
      const request = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).getAll()
      request.onsuccess = () => resolve(request.result as QueuedMutation[])
      request.onerror = () => reject(request.error)
    })
    if (records.length) {
      queue = records
      writeLocalQueue(queue)
    } else if (queue.length) {
      await saveOutbox(queue)
    }
    db.close()
  } catch { /* localStorage remains the safe fallback */ }
}

async function saveOutbox(records: QueuedMutation[]) {
  if (!idbAvailable()) return
  try {
    const db = await openDatabase()
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
  writeLocalQueue(queue)
  persistenceReady = persistenceReady.then(() => saveOutbox(queue))
  return persistenceReady
}

if (typeof window !== 'undefined') persistenceReady = loadFromOutbox()

function requestBackgroundSync() {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return
  void navigator.serviceWorker.ready.then((registration) => {
    const syncManager = (registration as ServiceWorkerRegistration & { sync?: { register: (tag: string) => Promise<void> } }).sync
    if (syncManager) return syncManager.register(SYNC_TAG)
  }).catch(() => { /* online event fallback still flushes the queue */ })
}

export function queuedMutations() { return [...queue] }
export function retryQueuedMutation(id: string) { queue = queue.map((item) => item.id === id ? { ...item, conflictStatus: 'queued' as const } : item); void persist(); requestBackgroundSync() }
export function discardQueuedMutation(id: string) { queue = queue.filter((item) => item.id !== id); void persist() }
export function enqueueMutation(mutation: Omit<QueuedMutation, 'id' | 'createdAt' | 'clientVersion' | 'conflictStatus'>) {
  const previous = queue.filter((item) => item.endpoint === mutation.endpoint).length
  queue = [...queue, { ...mutation, id: crypto.randomUUID(), createdAt: new Date().toISOString(), clientVersion: previous + 1, conflictStatus: 'queued' }]
  void persist()
  requestBackgroundSync()
  return queue.length
}
export function queuedMutationCount() { return queue.length }

function offlineMutationDetails(mutation: QueuedMutation) {
  const path = mutation.endpoint.split('?')[0]
  const segments = path.split('/').filter(Boolean)
  const entityId = segments.length > 2 && /^[0-9a-f-]{36}$/i.test(segments[2]) ? segments[2] : undefined
  let payload: Record<string, unknown> = {}
  try { payload = mutation.init.body ? JSON.parse(String(mutation.init.body)) as Record<string, unknown> : {} } catch { /* malformed payload will be rejected by the API */ }
  return { mutationType: mutation.init.method?.toLowerCase() ?? 'mutation', entityType: segments[1] ?? 'unknown', entityId, payload }
}

export async function flushMutationQueue(
  fetcher: (endpoint: string, init: RequestInit) => Promise<unknown>,
  registerMutation?: (mutation: { mutationType: string; entityType: string; entityId?: string; payload: Record<string, unknown>; clientVersion: number }) => Promise<{ id: string }>,
) {
  if (typeof navigator === 'undefined' || !navigator.onLine) return 0
  await persistenceReady
  let flushed = 0
  const remaining: QueuedMutation[] = []
  for (const mutation of queue) {
    try {
      let serverMutationId = mutation.serverMutationId
      if (!serverMutationId && registerMutation) {
        serverMutationId = (await registerMutation({ ...offlineMutationDetails(mutation), clientVersion: mutation.clientVersion })).id
        mutation.serverMutationId = serverMutationId
      }
      const init = { ...mutation.init, headers: { ...(mutation.init.headers ?? {}), ...(serverMutationId ? { 'x-offline-mutation-id': serverMutationId } : {}), 'x-client-version': String(mutation.clientVersion) } }
      await fetcher(mutation.endpoint, init)
      flushed += 1
    } catch {
      remaining.push({ ...mutation, conflictStatus: 'conflict' })
    }
  }
  queue = remaining
  await persist()
  return flushed
}
