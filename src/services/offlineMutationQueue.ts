export type QueuedMutation = { id: string; endpoint: string; init: RequestInit; createdAt: string; serverMutationId?: string; clientVersion: number; conflictStatus: 'queued' | 'conflict' | 'applied' | 'discarded' }
const STORAGE_KEY = 'urban-tanker-vendor-offline-mutations'

function readQueue(): QueuedMutation[] { try { return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]') as QueuedMutation[] } catch { return [] } }
function writeQueue(queue: QueuedMutation[]) { localStorage.setItem(STORAGE_KEY, JSON.stringify(queue)) }
export function queuedMutations() { return readQueue() }
export function retryQueuedMutation(id: string) { const queue = readQueue().map((item) => item.id === id ? { ...item, conflictStatus: 'queued' as const } : item); writeQueue(queue) }
export function discardQueuedMutation(id: string) { writeQueue(readQueue().filter((item) => item.id !== id)) }
export function enqueueMutation(mutation: Omit<QueuedMutation, 'id' | 'createdAt' | 'clientVersion' | 'conflictStatus'>) { const queue = readQueue(); const previous = queue.filter((item) => item.endpoint === mutation.endpoint).length; queue.push({ ...mutation, id: crypto.randomUUID(), createdAt: new Date().toISOString(), clientVersion: previous + 1, conflictStatus: 'queued' }); writeQueue(queue); return queue.length }
export function queuedMutationCount() { return readQueue().length }
function offlineMutationDetails(mutation: QueuedMutation) {
  const path = mutation.endpoint.split('?')[0]
  const segments = path.split('/').filter(Boolean)
  const entityId = segments.length > 2 && /^[0-9a-f-]{36}$/i.test(segments[2]) ? segments[2] : undefined
  return { mutationType: mutation.init.method?.toLowerCase() ?? 'mutation', entityType: segments[1] ?? 'unknown', entityId, payload: mutation.init.body ? JSON.parse(String(mutation.init.body)) as Record<string, unknown> : {} }
}

export async function flushMutationQueue(
  fetcher: (endpoint: string, init: RequestInit) => Promise<unknown>,
  registerMutation?: (mutation: { mutationType: string; entityType: string; entityId?: string; payload: Record<string, unknown>; clientVersion: number }) => Promise<{ id: string }>,
) {
  if (!navigator.onLine) return 0
  const queue = readQueue()
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
  writeQueue(remaining)
  return flushed
}
