import { supabase } from '../supabase.js'
import { config } from '../config.js'
import { logger } from '../lib/logger.js'
import { databasePool } from '../database.js'
import { runAnalyticsRetentionSweep } from '../routes/analytics.js'
import { runPaymentReconciliationSweep } from './paymentReconciliation.js'
export async function runReminderSweep() { const cutoff = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(); const { count, error } = await supabase.from('bookings').select('id', { count: 'exact', head: true }).eq('status', 'accepted').lte('scheduled_for', cutoff); if (error) throw new Error(`Reminder sweep failed: ${error.message}`); return count ?? 0 }
export async function runDocumentExpirySweep() { const cutoff = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10); const { count, error } = await supabase.from('documents').select('id', { count: 'exact', head: true }).lte('expires_on', cutoff); if (error) throw new Error(`Document expiry sweep failed: ${error.message}`); return count ?? 0 }
export async function runStorageCleanupSweep() {
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
  const { data, error: scanError } = await supabase.from('documents').select('id,object_key,created_at').eq('verification', 'rejected').lt('created_at', cutoff).limit(100)
  if (scanError) throw new Error(`Storage cleanup sweep failed: ${scanError.message}`)
  const batch = data ?? []
  if (batch.length === 0) return { scanned: 0, removed: 0, failed: 0, failures: [] as string[] }
  // Removing an object that is already gone is not an error, so a successful remove means every row in the batch can go.
  const { error: removeError } = await supabase.storage.from('urban-tanker-documents').remove(batch.map((document) => document.object_key))
  if (removeError) return { scanned: batch.length, removed: 0, failed: batch.length, failures: batch.map((document) => document.id) }
  const ids = batch.map((document) => document.id)
  const { error: deleteError } = await supabase.from('documents').delete().in('id', ids)
  if (deleteError) return { scanned: batch.length, removed: 0, failed: batch.length, failures: ids }
  return { scanned: batch.length, removed: batch.length, failed: 0, failures: [] as string[] }
}
const JOBS_LOCK_KEY = 728341
// Several API instances can share one database; the advisory lock makes sure only one of them runs the sweeps per cycle.
// In production the sweeps do not run without the lock, so two instances can never both run them.
async function withJobsLock(task: () => Promise<unknown>) { if (!databasePool) { if (config.NODE_ENV === 'production') throw new Error('Background jobs need SUPABASE_DB_URL for the advisory lock in production'); return task() } const client = await databasePool.connect(); try { const { rows } = await client.query<{ locked: boolean }>('select pg_try_advisory_lock($1) as locked', [JOBS_LOCK_KEY]); if (!rows[0]?.locked) return; try { await task() } finally { await client.query('select pg_advisory_unlock($1)', [JOBS_LOCK_KEY]) } } finally { client.release() } }
const sweeps = { reminders: runReminderSweep, documentExpiry: runDocumentExpirySweep, storageCleanup: runStorageCleanupSweep, analyticsRetention: runAnalyticsRetentionSweep, paymentReconciliation: runPaymentReconciliationSweep }
export function startBackgroundJobs() {
  const run = async () => {
    try {
      await withJobsLock(async () => {
        const names = Object.keys(sweeps) as Array<keyof typeof sweeps>
        const results = await Promise.allSettled(names.map((name) => sweeps[name]()))
        results.forEach((result, index) => {
          if (result.status === 'rejected') logger.error('background_jobs.job_failed', { job: names[index], error: result.reason instanceof Error ? result.reason.message : String(result.reason) })
        })
      })
    } catch (error) {
      logger.error('background_jobs.failed', { error: error instanceof Error ? error.message : String(error) })
    }
  }
  const timer = setInterval(() => { void run() }, 15 * 60 * 1000); timer.unref(); return () => clearInterval(timer)
}
