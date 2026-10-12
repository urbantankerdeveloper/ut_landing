export type QueuedMutation = { id: string; endpoint: string; init: RequestInit; createdAt: string }
const STORAGE_KEY = 'urban-tanker-vendor-offline-mutations'

function readQueue(): QueuedMutation[] { try { return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]') as QueuedMutation[] } catch { return [] } }
function writeQueue(queue: QueuedMutation[]) { localStorage.setItem(STORAGE_KEY, JSON.stringify(queue)) }
export function enqueueMutation(mutation: Omit<QueuedMutation, 'id' | 'createdAt'>) { const queue = readQueue(); queue.push({ ...mutation, id: crypto.randomUUID(), createdAt: new Date().toISOString() }); writeQueue(queue); return queue.length }
export function queuedMutationCount() { return readQueue().length }
export async function flushMutationQueue(fetcher: (endpoint: string, init: RequestInit) => Promise<unknown>) { if (!navigator.onLine) return 0; const queue = readQueue(); let flushed = 0; const remaining: QueuedMutation[] = []; for (const mutation of queue) { try { await fetcher(mutation.endpoint, mutation.init); flushed += 1 } catch { remaining.push(mutation) } } writeQueue(remaining); return flushed }
