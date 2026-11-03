import { supabase } from '../supabase.js'

// Audit rows are queued and written as multi-row inserts, flushed every second or at 100 rows.
// The queue is bounded: above MAX_QUEUE the oldest rows are dropped and counted. flushAuditQueue() runs on shutdown.
export type AuditRow = {
  actor_id: string
  action: string
  entity_type: string
  entity_id: string | null
  metadata: Record<string, unknown>
}

const MAX_QUEUE = 5000
const FLUSH_ROWS = 100
const FLUSH_INTERVAL_MS = 1000
const MAX_BATCHES_PER_DRAIN = 50

const queue: AuditRow[] = []
let dropped = 0
let timer: NodeJS.Timeout | null = null
let drainChain: Promise<void> = Promise.resolve()

export function auditQueueDepth() {
  return queue.length
}

export function enqueueAuditRow(row: AuditRow) {
  if (queue.length >= MAX_QUEUE) {
    queue.shift()
    dropped += 1
  }
  queue.push(row)
  if (queue.length >= FLUSH_ROWS) {
    void flushAuditQueue()
    return
  }
  if (!timer) {
    timer = setInterval(() => { void flushAuditQueue() }, FLUSH_INTERVAL_MS)
    timer.unref()
  }
}

async function drainOnce() {
  for (let batches = 0; batches < MAX_BATCHES_PER_DRAIN && queue.length > 0; batches += 1) {
    const batch = queue.splice(0, FLUSH_ROWS)
    try {
      const { error } = await supabase.from('audit_logs').insert(batch)
      if (error) console.warn(JSON.stringify({ event: 'audit.batch_write_failed', rows: batch.length, error: error.message }))
    } catch (error) {
      console.warn(JSON.stringify({ event: 'audit.batch_write_failed', rows: batch.length, error: error instanceof Error ? error.message : String(error) }))
    }
  }
  if (dropped > 0) {
    console.warn(JSON.stringify({ event: 'audit.queue_overflow', dropped }))
    dropped = 0
  }
}

// Calls are serialized, so a shutdown flush waits for any batch already in flight.
export function flushAuditQueue(): Promise<void> {
  drainChain = drainChain.then(drainOnce, drainOnce)
  return drainChain
}

export function stopAuditBatcher() {
  if (timer) clearInterval(timer)
  timer = null
}
