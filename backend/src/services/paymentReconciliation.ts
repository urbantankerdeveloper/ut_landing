import { supabase } from '../supabase.js'
import { logger } from '../lib/logger.js'
import { epochSecondsToIso, extractPaymentDetails, type RazorpayPaymentEntity } from './paymentDetails.js'

// Notes an admin should look at. Kept in one place so the admin filter and the writers agree.
export const ATTENTION_NOTES = ['amount_mismatch', 'authorized_not_captured', 'captured_after_cod_switch', 'auto_refund_in_progress', 'auto_refunded_after_cod_switch'] as const

const RECONCILE_AFTER_MS = 15 * 60 * 1000
// Orders still unpaid after this long are abandoned; the sweep stops re-checking them.
const RECHECK_WINDOW_MS = 24 * 60 * 60 * 1000
const BATCH_SIZE = 50

type PendingPayment = { id: string; booking_id: string; provider_order_id: string; amount_paise: number }
export type ReconcileOutcome = 'paid' | 'flagged' | 'no_capture' | 'skipped'
export type CodRefundOutcome = 'refunded' | 'refund_failed' | 'skipped'

function razorpayAuth(): string | null {
  const key = process.env.RAZORPAY_KEY_ID
  const secret = process.env.RAZORPAY_KEY_SECRET
  return key && secret ? Buffer.from(`${key}:${secret}`).toString('base64') : null
}

// Returns null when Razorpay keys are not configured, so the sweep skips instead of guessing.
async function fetchOrderPayments(orderId: string): Promise<RazorpayPaymentEntity[] | null> {
  const auth = razorpayAuth()
  if (!auth) return null
  const providerResponse = await fetch(`https://api.razorpay.com/v1/orders/${encodeURIComponent(orderId)}/payments`, { headers: { Authorization: `Basic ${auth}` }, signal: AbortSignal.timeout(8000) })
  if (!providerResponse.ok) throw new Error(`Razorpay order lookup returned ${providerResponse.status}`)
  const body = await providerResponse.json() as { items?: RazorpayPaymentEntity[] }
  return body.items ?? []
}

async function markChecked(paymentId: string, note: string, checkedAt: string) {
  const { error } = await supabase.from('payments').update({ reconciled_at: checkedAt, reconciliation_note: note, updated_at: checkedAt }).eq('id', paymentId).eq('status', 'pending')
  if (error) throw new Error(`Payment reconciliation update failed: ${error.message}`)
}

// A capture on a booking the customer moved to cash is refunded in full. The note doubles as a claim,
// so a repeated webhook or sweep cannot refund the same payment twice.
export async function refundCapturedAfterCod(row: { id: string; provider_payment_id: string; amount_paise: number }, now: Date = new Date()): Promise<CodRefundOutcome> {
  const auth = razorpayAuth()
  if (!auth) return 'skipped'
  const { data: claimed, error: claimError } = await supabase.from('payments').update({ reconciliation_note: 'auto_refund_in_progress', updated_at: now.toISOString() })
    .eq('id', row.id).eq('status', 'paid').eq('reconciliation_note', 'captured_after_cod_switch').select('id')
  if (claimError) throw new Error(`COD refund claim failed: ${claimError.message}`)
  if (!claimed?.length) return 'skipped'

  const releaseClaim = () => supabase.from('payments').update({ reconciliation_note: 'captured_after_cod_switch', updated_at: new Date().toISOString() })
    .eq('id', row.id).eq('reconciliation_note', 'auto_refund_in_progress')
  try {
    const providerResponse = await fetch(`https://api.razorpay.com/v1/payments/${encodeURIComponent(row.provider_payment_id)}/refund`, {
      method: 'POST',
      headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json', 'X-Razorpay-Idempotency': `cod-refund-${row.id}` },
      body: JSON.stringify({ amount: row.amount_paise }),
      signal: AbortSignal.timeout(8000),
    })
    if (!providerResponse.ok) throw new Error(`Razorpay refund returned ${providerResponse.status}`)
  } catch (refundError) {
    // Back to flagged so the next sweep retries with the same idempotency key.
    await releaseClaim()
    logger.warn('payment.cod_refund_failed', { paymentId: row.id, error: refundError instanceof Error ? refundError.message : String(refundError) })
    return 'refund_failed'
  }

  const { error } = await supabase.from('payments').update({ status: 'refunded', refunded_paise: row.amount_paise, reconciliation_note: 'auto_refunded_after_cod_switch', updated_at: new Date().toISOString() })
    .eq('id', row.id).eq('reconciliation_note', 'auto_refund_in_progress')
  if (error) throw new Error(`COD refund status update failed: ${error.message}`)
  logger.warn('payment.auto_refunded_after_cod_switch', { paymentId: row.id })
  return 'refunded'
}

// Settles one stuck payment from Razorpay's own record. Only a captured payment with a matching amount changes status.
export async function reconcilePayment(row: PendingPayment, now: Date = new Date()): Promise<ReconcileOutcome> {
  const payments = await fetchOrderPayments(row.provider_order_id)
  if (!payments) return 'skipped'
  const checkedAt = now.toISOString()
  const captured = payments.find((payment) => payment.status === 'captured')

  if (!captured) {
    const note = payments.some((payment) => payment.status === 'authorized') ? 'authorized_not_captured' : 'no_capture_found'
    await markChecked(row.id, note, checkedAt)
    return note === 'no_capture_found' ? 'no_capture' : 'flagged'
  }

  if (captured.amount !== row.amount_paise) {
    logger.error('payment.reconcile_amount_mismatch', { paymentId: row.id, capturedPaise: captured.amount, expectedPaise: row.amount_paise })
    await markChecked(row.id, 'amount_mismatch', checkedAt)
    return 'flagged'
  }

  const { data: booking, error: bookingError } = await supabase.from('bookings').select('payment_method').eq('id', row.booking_id).maybeSingle()
  if (bookingError) throw new Error(`Booking lookup failed: ${bookingError.message}`)
  const note = booking?.payment_method === 'cod' ? 'captured_after_cod_switch' : 'reconciled_from_razorpay'

  const { data: settled, error } = await supabase.from('payments').update({
    status: 'paid',
    provider_payment_id: captured.id,
    captured_at: epochSecondsToIso(captured.created_at) ?? checkedAt,
    ...extractPaymentDetails(captured),
    reconciled_at: checkedAt,
    reconciliation_note: note,
    updated_at: checkedAt,
  }).eq('id', row.id).eq('status', 'pending').select('id')
  if (error) throw new Error(`Payment reconciliation settle failed: ${error.message}`)
  // A webhook or verify may have settled the row between the scan and this update.
  if (!settled?.length) return 'skipped'

  logger.info('payment.reconciled', { paymentId: row.id, note })
  return note === 'reconciled_from_razorpay' ? 'paid' : 'flagged'
}

export async function runPaymentReconciliationSweep() {
  const now = Date.now()
  const recheckCutoff = new Date(now - RECONCILE_AFTER_MS).toISOString()
  const giveUpCutoff = new Date(now - RECHECK_WINDOW_MS).toISOString()
  // Unchecked orders first, then the least recently checked. Unpaid orders stay eligible until the 24-hour window closes.
  const { data, error } = await supabase.from('payments').select('id,booking_id,provider_order_id,amount_paise')
    .eq('status', 'pending').not('provider_order_id', 'is', null)
    .gte('created_at', giveUpCutoff).lte('created_at', recheckCutoff)
    .or(`reconciled_at.is.null,reconciled_at.lte.${recheckCutoff}`)
    .or('reconciliation_note.is.null,reconciliation_note.in.(no_capture_found,authorized_not_captured)')
    .order('reconciled_at', { ascending: true, nullsFirst: true }).limit(BATCH_SIZE)
  if (error) throw new Error(`Payment reconciliation scan failed: ${error.message}`)

  const counts = { scanned: 0, paid: 0, flagged: 0, noCapture: 0, skipped: 0, failed: 0, refunded: 0, refundFailed: 0 }
  // Sequential on purpose: keeps load on Razorpay's API predictable.
  for (const row of (data ?? []) as PendingPayment[]) {
    counts.scanned += 1
    try {
      const outcome = await reconcilePayment(row)
      if (outcome === 'paid') counts.paid += 1
      else if (outcome === 'flagged') counts.flagged += 1
      else if (outcome === 'no_capture') counts.noCapture += 1
      else counts.skipped += 1
    } catch (reconcileError) {
      // The row keeps its previous reconciled_at, so the next cycle retries it.
      counts.failed += 1
      logger.warn('payment.reconcile_failed', { paymentId: row.id, error: reconcileError instanceof Error ? reconcileError.message : String(reconcileError) })
    }
  }

  // Retries COD refunds that the webhook could not complete, plus any captures the scan above just flagged.
  const { data: codCaptures, error: codError } = await supabase.from('payments').select('id,provider_payment_id,amount_paise')
    .eq('status', 'paid').eq('reconciliation_note', 'captured_after_cod_switch').not('provider_payment_id', 'is', null)
    .limit(BATCH_SIZE)
  if (codError) throw new Error(`COD refund scan failed: ${codError.message}`)
  for (const row of (codCaptures ?? []) as Array<{ id: string; provider_payment_id: string; amount_paise: number }>) {
    try {
      const outcome = await refundCapturedAfterCod(row)
      if (outcome === 'refunded') counts.refunded += 1
      else if (outcome === 'refund_failed') counts.refundFailed += 1
    } catch (refundError) {
      counts.refundFailed += 1
      logger.warn('payment.cod_refund_failed', { paymentId: row.id, error: refundError instanceof Error ? refundError.message : String(refundError) })
    }
  }
  return counts
}
