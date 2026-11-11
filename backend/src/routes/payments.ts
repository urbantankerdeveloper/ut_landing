import { databaseFailure } from '../lib/httpErrors.js'
import { Router, type Response } from 'express'
import crypto from 'node:crypto'
import { z } from 'zod'
import { requireAuth, requireRole } from '../middleware/auth.js'
import { supabase } from '../supabase.js'
import { logger } from '../lib/logger.js'
import { refundAmountInPaise, signaturesMatch } from '../services/paymentSecurity.js'
import { epochSecondsToIso, extractPaymentDetails, type RazorpayPaymentEntity } from '../services/paymentDetails.js'
import { refundCapturedAfterCod } from '../services/paymentReconciliation.js'
import { notifyPaidOnlineAfterCodSwitch } from '../services/codOnlineSwitch.js'
import { failure } from '../lib/httpErrors.js'
import { settleBookingCheckout, type CheckoutRow } from './customer.js'
const router = Router()
const razorpay = () => ({ key: process.env.RAZORPAY_KEY_ID, secret: process.env.RAZORPAY_KEY_SECRET })
type RazorpayKeys = { key?: string; secret?: string }

// Returns null (never throws) so a Razorpay hiccup cannot fail a verify that the signature already proves.
async function fetchRazorpayPayment(paymentId: string, keys: { key?: string; secret?: string }): Promise<RazorpayPaymentEntity | null> {
  if (!keys.key || !keys.secret) return null
  const auth = Buffer.from(`${keys.key}:${keys.secret}`).toString('base64')
  try {
    const providerResponse = await fetch(`https://api.razorpay.com/v1/payments/${encodeURIComponent(paymentId)}`, { headers: { Authorization: `Basic ${auth}` }, signal: AbortSignal.timeout(8000) })
    if (!providerResponse.ok) {
      logger.warn('payment.details_fetch_failed', { providerPaymentId: paymentId, providerStatus: providerResponse.status })
      return null
    }
    return await providerResponse.json() as RazorpayPaymentEntity
  } catch (error) {
    logger.warn('payment.details_fetch_failed', { providerPaymentId: paymentId, reason: error instanceof Error ? error.name : 'unknown' })
    return null
  }
}
async function createRazorpayOrder(response: Response, keys: RazorpayKeys, amountPaise: number, receipt: string) {
  const auth = Buffer.from(`${keys.key}:${keys.secret}`).toString('base64')
  let providerResponse: Awaited<ReturnType<typeof fetch>>
  try {
    providerResponse = await fetch('https://api.razorpay.com/v1/orders', { method: 'POST', headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ amount: amountPaise, currency: 'INR', receipt }), signal: AbortSignal.timeout(8000) })
  } catch (error) {
    failure(response, 502, 'Payment provider unavailable', 'payments.order_request_failed', error)
    return null
  }
  if (!providerResponse.ok) {
    response.status(502).json({ error: 'Payment provider unavailable' })
    return null
  }
  return await providerResponse.json() as { id: string; amount: number; currency: string }
}
// Checkout orders are not tied to a booking yet, so the Razorpay order id is stored on the checkout instead of payments.
async function checkoutPaymentOrder(response: Response, customerId: string, checkoutId: string, keys: RazorpayKeys) {
  const { data: checkout, error } = await supabase.from('booking_checkouts').select('*').eq('id', checkoutId).eq('customer_id', customerId).maybeSingle()
  if (error) return databaseFailure(response, 'payments.checkout_lookup_failed', error, 500)
  if (!checkout) return response.status(404).json({ error: 'Booking not found' })
  if (checkout.status === 'booked') return response.status(409).json({ error: 'This booking has already been paid.' })
  if (checkout.status === 'cod') return response.status(409).json({ error: 'This booking is set to cash on delivery.' })
  const amountPaise = Number(checkout.quoted_amount_paise)
  if (!Number.isInteger(amountPaise) || amountPaise <= 0) return response.status(409).json({ error: 'Booking does not have an authoritative quote' })
  if (!keys.key || !keys.secret) return response.status(503).json({ error: 'Payment provider is not configured' })
  let orderId = checkout.provider_order_id as string | null
  if (!orderId) {
    const order = await createRazorpayOrder(response, keys, amountPaise, checkout.id)
    if (!order) return
    // Retries reuse the stored order, so a payment started earlier on it still matches this checkout.
    const { data: claimed, error: claimError } = await supabase.from('booking_checkouts').update({ provider_order_id: order.id, status: 'order_created', updated_at: new Date().toISOString() }).eq('id', checkout.id).is('provider_order_id', null).select('id').maybeSingle()
    if (claimError) return databaseFailure(response, 'payments.checkout_update_failed', claimError, 500)
    if (claimed) orderId = order.id
    else {
      const { data: latest, error: latestError } = await supabase.from('booking_checkouts').select('provider_order_id').eq('id', checkout.id).single()
      if (latestError || !latest?.provider_order_id) return databaseFailure(response, 'payments.checkout_update_failed', latestError, 500)
      orderId = latest.provider_order_id
    }
  }
  response.status(201).json({ id: orderId, amount: amountPaise, currency: 'INR', keyId: keys.key })
}
router.post('/razorpay/order', requireAuth, async (request, response) => {
  const parsed = z.object({ amount: z.number().positive().optional(), bookingId: z.string().uuid().optional(), checkoutId: z.string().uuid().optional() })
    .refine((body) => Number(Boolean(body.bookingId)) + Number(Boolean(body.checkoutId)) === 1, { error: 'Provide exactly one of bookingId or checkoutId' })
    .safeParse(request.body)
  const keys = razorpay()
  if (!parsed.success) return response.status(400).json({ error: 'Invalid payment order' })
  if (parsed.data.checkoutId) return checkoutPaymentOrder(response, request.authUser!.id, parsed.data.checkoutId, keys)
  const bookingId = parsed.data.bookingId
  if (!bookingId) return response.status(400).json({ error: 'Invalid payment order' })
  const { data: booking, error: bookingError } = await supabase.from('bookings').select('id,status,quoted_amount_paise').eq('id', bookingId).eq('customer_id', request.authUser!.id).single()
  if (bookingError || !booking) return response.status(404).json({ error: 'Booking not found' })
  if (['cancelled', 'delivered'].includes(booking.status)) return response.status(409).json({ error: 'This booking can no longer be paid.' })
  const { data: existing, error: existingError } = await supabase.from('payments').select('status').eq('booking_id', booking.id).maybeSingle()
  if (existingError) return databaseFailure(response, 'payments.lookup_failed', existingError, 500)
  if (existing?.status === 'paid') return response.status(409).json({ error: 'This booking has already been paid.' })
  const amountPaise = Number(booking.quoted_amount_paise)
  if (!Number.isInteger(amountPaise) || amountPaise <= 0) return response.status(409).json({ error: 'Booking does not have an authoritative quote' })
  if (!keys.key || !keys.secret) return response.status(503).json({ error: 'Payment provider is not configured' })
  const order = await createRazorpayOrder(response, keys, amountPaise, bookingId)
  if (!order) return
  const orderFields = { provider: 'razorpay', provider_order_id: order.id, amount_paise: order.amount, currency: order.currency, status: 'pending' }
  const { error: insertError } = await supabase.from('payments').insert({ booking_id: booking.id, ...orderFields })
  if (insertError) {
    if (insertError.code !== '23505') return databaseFailure(response, 'payments.order_insert_failed', insertError, 500)
    const { data: updated, error: updateError } = await supabase.from('payments').update({ ...orderFields, updated_at: new Date().toISOString() }).eq('booking_id', booking.id).in('status', ['pending', 'failed']).select('id').maybeSingle()
    if (updateError) return databaseFailure(response, 'payments.order_update_failed', updateError, 500)
    if (!updated) return response.status(409).json({ error: 'A payment for this booking is already in progress or complete.' })
  }
  response.status(201).json({ id: order.id, amount: order.amount, currency: order.currency, keyId: keys.key })
})
// Verify for a checkout: the booking is created here only after Razorpay has captured the payment.
async function verifyCheckoutPayment(response: Response, customerId: string, orderId: string, paymentId: string, keys: RazorpayKeys) {
  const { data: checkout, error } = await supabase.from('booking_checkouts').select('*').eq('provider_order_id', orderId).maybeSingle()
  if (error) return databaseFailure(response, 'payments.verify_failed', error, 500)
  if (!checkout) return response.status(404).json({ error: 'Payment order not found' })
  if (checkout.customer_id !== customerId) return response.status(403).json({ error: 'Payment is not owned by this customer' })
  const entity = await fetchRazorpayPayment(paymentId, keys)
  if (entity && ((entity.order_id && entity.order_id !== orderId) || (typeof entity.amount === 'number' && entity.amount !== Number(checkout.quoted_amount_paise)))) {
    logger.error('payment.amount_mismatch', { providerOrderId: orderId, capturedPaise: entity.amount, expectedPaise: checkout.quoted_amount_paise })
    return response.status(409).json({ error: 'Payment amount does not match this booking. Contact support.' })
  }
  const details = entity ? { ...extractPaymentDetails(entity), captured_at: entity.status === 'captured' ? new Date().toISOString() : null } : {}
  try {
    const outcome = await settleBookingCheckout(checkout as CheckoutRow, 'gateway', { provider_payment_id: paymentId, status: 'paid', ...details })
    if (outcome.status !== 'booked') return response.status(409).json({ error: 'This booking is already being processed. Refresh and try again.' })
    response.json({ verified: true, orderId: outcome.booking.id })
  } catch (settleError) {
    return databaseFailure(response, 'payments.verify_failed', settleError, 500)
  }
}
router.post('/razorpay/verify', requireAuth, async (request, response) => {
  const parsed = z.object({ orderId: z.string(), paymentId: z.string(), signature: z.string() }).safeParse(request.body)
  const keys = razorpay()
  if (!parsed.success || !keys.secret) return response.status(400).json({ error: 'Invalid payment verification' })
  const expected = crypto.createHmac('sha256', keys.secret).update(`${parsed.data.orderId}|${parsed.data.paymentId}`).digest('hex')
  const expectedBuffer = Buffer.from(expected)
  const receivedBuffer = Buffer.from(parsed.data.signature)
  if (expectedBuffer.length !== receivedBuffer.length || !crypto.timingSafeEqual(expectedBuffer, receivedBuffer)) return response.status(400).json({ error: 'Invalid payment signature' })
  const { data: payment, error: paymentError } = await supabase.from('payments').select('id,booking_id,amount_paise,status,provider_payment_id').eq('provider_order_id', parsed.data.orderId).maybeSingle()
  if (paymentError) return response.status(404).json({ error: 'Payment order not found' })
  if (!payment) return verifyCheckoutPayment(response, request.authUser!.id, parsed.data.orderId, parsed.data.paymentId, keys)
  const { data: booking, error: bookingError } = await supabase.from('bookings').select('id').eq('id', payment.booking_id).eq('customer_id', request.authUser!.id).single()
  if (bookingError || !booking) return response.status(403).json({ error: 'Payment is not owned by this customer' })
  // A webhook may have settled this payment first; a repeated verify for the same payment should still succeed.
  if (payment.status === 'paid' && payment.provider_payment_id === parsed.data.paymentId) return response.json({ verified: true, orderId: payment.booking_id })
  const entity = await fetchRazorpayPayment(parsed.data.paymentId, keys)
  if (entity && ((entity.order_id && entity.order_id !== parsed.data.orderId) || (typeof entity.amount === 'number' && entity.amount !== payment.amount_paise))) {
    logger.error('payment.amount_mismatch', { providerOrderId: parsed.data.orderId, capturedPaise: entity.amount, expectedPaise: payment.amount_paise })
    return response.status(409).json({ error: 'Payment amount does not match this booking. Contact support.' })
  }
  // Detail is written only when the fetch succeeded; otherwise the webhook fills it in later.
  const details = entity ? { ...extractPaymentDetails(entity), captured_at: entity.status === 'captured' ? new Date().toISOString() : null } : {}
  const { data: settled, error } = await supabase.from('payments').update({ provider_payment_id: parsed.data.paymentId, status: 'paid', ...details, updated_at: new Date().toISOString() }).eq('id', payment.id).in('status', ['pending', 'failed']).select('id').maybeSingle()
  if (error) return databaseFailure(response, 'payments.verify_failed', error, 400)
  if (!settled) return response.status(409).json({ error: 'This payment has already been processed.' })
  await notifyPaidOnlineAfterCodSwitch(payment.booking_id)
  response.json({ verified: true, orderId: payment.booking_id })
})
// The webhook is the source of truth for checkouts too, so a payment still lands when the client never calls verify.
async function settleCheckoutFromWebhook(response: Response, checkout: CheckoutRow, status: 'paid' | 'pending' | 'failed', event: unknown, entity: RazorpayPaymentEntity & { id?: string; order_id?: string; amount?: number }) {
  if (status === 'failed') {
    const { error } = await supabase.from('booking_checkouts').update({ status: 'failed', updated_at: new Date().toISOString() }).eq('id', checkout.id).in('status', ['awaiting_payment', 'order_created'])
    if (error) return databaseFailure(response, 'payments.webhook_update_failed', error, 500, 'Payment event could not be persisted')
    return response.status(202).json({ accepted: true })
  }
  if (status !== 'paid' || !entity.id) return response.status(202).json({ accepted: true })
  if (entity.amount !== Number(checkout.quoted_amount_paise)) {
    logger.error('payment.amount_mismatch', { providerOrderId: entity.order_id, capturedPaise: entity.amount, expectedPaise: checkout.quoted_amount_paise })
    return response.status(202).json({ accepted: true })
  }
  try {
    const outcome = await settleBookingCheckout(checkout, 'gateway', {
      provider_payment_id: entity.id,
      status: 'paid',
      raw_webhook: event,
      ...extractPaymentDetails(entity),
      captured_at: epochSecondsToIso((event as { created_at?: number }).created_at) ?? new Date().toISOString(),
    })
    // Returning 500 makes Razorpay retry the event until the booking can be created.
    if (outcome.status === 'conflict') return response.status(500).json({ error: 'Payment event could not be persisted' })
  } catch (error) {
    return databaseFailure(response, 'payments.webhook_update_failed', error, 500, 'Payment event could not be persisted')
  }
  response.status(202).json({ accepted: true })
}
router.post('/razorpay/webhook', async (request, response) => {
  const signature = request.headers['x-razorpay-signature']
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET
  if (!secret || typeof signature !== 'string') return response.status(503).json({ error: 'Webhook is not configured' })
  const raw = (request as typeof request & { rawBody?: Buffer }).rawBody
  if (!raw) return response.status(400).json({ error: 'Raw webhook body is unavailable' })
  const expected = crypto.createHmac('sha256', secret).update(raw).digest('hex')
  if (!signaturesMatch(expected, signature)) return response.status(400).json({ error: 'Invalid webhook signature' })
  let event: { event?: string; created_at?: number; payload?: { payment?: { entity?: RazorpayPaymentEntity & { id?: string; order_id?: string; amount?: number } } } }
  try { event = JSON.parse(raw.toString('utf8')) as typeof event } catch { return response.status(400).json({ error: 'Invalid webhook payload' }) }
  const paymentEntity = event.payload?.payment?.entity
  const status = event.event === 'payment.captured' ? 'paid' : event.event === 'payment.authorized' ? 'pending' : event.event === 'payment.failed' ? 'failed' : null
  if (status && paymentEntity?.order_id && paymentEntity.id) {
    const { data: payment, error: lookupError } = await supabase.from('payments').select('id,amount_paise,booking_id').eq('provider_order_id', paymentEntity.order_id).maybeSingle()
    if (lookupError) return databaseFailure(response, 'payments.webhook_lookup_failed', lookupError, 500, 'Payment event could not be persisted')
    if (!payment) {
      const { data: checkout, error: checkoutError } = await supabase.from('booking_checkouts').select('*').eq('provider_order_id', paymentEntity.order_id).maybeSingle()
      if (checkoutError) return databaseFailure(response, 'payments.webhook_lookup_failed', checkoutError, 500, 'Payment event could not be persisted')
      if (checkout) return settleCheckoutFromWebhook(response, checkout as CheckoutRow, status, event, paymentEntity)
      if (status === 'paid') {
        // Wallet top-ups have no payments row; mirror the client verify path for them.
        const { data: topUp, error: topUpError } = await supabase.from('wallet_transactions').select('id,amount').eq('provider_reference', paymentEntity.order_id).eq('status', 'pending')
        if (topUpError) return databaseFailure(response, 'payments.webhook_lookup_failed', topUpError, 500, 'Payment event could not be persisted')
        const row = topUp?.[0]
        if (row && Math.round(Number(row.amount) * 100) === paymentEntity.amount) {
          const { error: settleError } = await supabase.from('wallet_transactions').update({ provider_reference: paymentEntity.id, status: 'completed' }).eq('id', row.id).eq('status', 'pending')
          if (settleError) return databaseFailure(response, 'payments.webhook_update_failed', settleError, 500, 'Payment event could not be persisted')
          return response.status(202).json({ accepted: true })
        }
      }
      logger.warn('payment.webhook_no_matching_row', { providerOrderId: paymentEntity.order_id, status })
      return response.status(202).json({ accepted: true })
    }
    if (status === 'paid' && paymentEntity.amount !== payment.amount_paise) {
      logger.error('payment.amount_mismatch', { providerOrderId: paymentEntity.order_id, capturedPaise: paymentEntity.amount, expectedPaise: payment.amount_paise })
      return response.status(202).json({ accepted: true })
    }
    const update: Record<string, unknown> = { provider_payment_id: paymentEntity.id, status, raw_webhook: event, ...extractPaymentDetails(paymentEntity), updated_at: new Date().toISOString() }
    if (status === 'paid') {
      update.captured_at = epochSecondsToIso(event.created_at) ?? new Date().toISOString()
      // The customer switched to cash after starting online payment, so this capture needs an admin to look at it.
      const { data: booking, error: bookingError } = await supabase.from('bookings').select('payment_method').eq('id', payment.booking_id).maybeSingle()
      if (bookingError) return databaseFailure(response, 'payments.webhook_lookup_failed', bookingError, 500, 'Payment event could not be persisted')
      if (booking?.payment_method === 'cod') {
        update.reconciliation_note = 'captured_after_cod_switch'
        logger.warn('payment.captured_after_cod_switch', { providerOrderId: paymentEntity.order_id })
      }
    }
    // A paid event may also refresh a row that verify already marked paid, but only for the same payment id.
    const filtered = supabase.from('payments').update(update).eq('provider_order_id', paymentEntity.order_id)
    const { data: updated, error } = await (status === 'paid'
      ? filtered.or(`status.in.(pending,failed),and(status.eq.paid,provider_payment_id.eq.${paymentEntity.id})`)
      : filtered.in('status', ['pending', 'failed'])
    ).select('id')
    if (error) return databaseFailure(response, 'payments.webhook_update_failed', error, 500, 'Payment event could not be persisted')
    if (!updated?.length) logger.warn('payment.webhook_no_matching_row', { providerOrderId: paymentEntity.order_id, status })
    else {
      if (status === 'paid') await notifyPaidOnlineAfterCodSwitch(payment.booking_id)
      if (update.reconciliation_note === 'captured_after_cod_switch') {
        // A failed refund stays flagged, and the reconciliation sweep retries it.
        try {
          await refundCapturedAfterCod({ id: payment.id, provider_payment_id: paymentEntity.id, amount_paise: payment.amount_paise })
        } catch (refundError) {
          logger.error('payment.cod_refund_failed', { paymentId: payment.id, error: refundError instanceof Error ? refundError.message : String(refundError) })
        }
      }
    }
  }
  response.status(202).json({ accepted: true })
})
router.post('/payments/:id/refund', requireAuth, requireRole('admin'), async (request, response) => {
  const parsed = z.object({ amount: z.number().positive().optional() }).safeParse(request.body)
  const keys = razorpay()
  if (!parsed.success) return response.status(400).json({ error: 'Invalid refund' })
  if (!keys.key || !keys.secret) return response.status(503).json({ error: 'Payment provider is not configured' })
  const { data: payment, error: paymentError } = await supabase.from('payments').select('id,provider,provider_payment_id,amount_paise,status,refunded_paise').eq('id', request.params.id).single()
  if (paymentError || !payment) return response.status(404).json({ error: 'Payment not found' })
  if (payment.provider !== 'razorpay' || !payment.provider_payment_id) return response.status(409).json({ error: 'Payment is not refundable through Razorpay' })
  if (payment.status !== 'paid') return response.status(409).json({ error: 'Only paid payments can be refunded' })
  const alreadyRefunded = Number(payment.refunded_paise ?? 0)
  if (payment.amount_paise - alreadyRefunded <= 0) return response.status(409).json({ error: 'This payment has already been fully refunded.' })
  let refundAmount: number
  try { refundAmount = refundAmountInPaise(parsed.data.amount, payment.amount_paise - alreadyRefunded) } catch (error) { return response.status(400).json({ error: error instanceof Error ? error.message : 'Invalid refund amount' }) }
  const refundedAfter = alreadyRefunded + refundAmount
  const { data: claimed, error: claimError } = await supabase.from('payments').update({ refunded_paise: refundedAfter, updated_at: new Date().toISOString() }).eq('id', payment.id).eq('status', 'paid').eq('refunded_paise', alreadyRefunded).select('id').maybeSingle()
  if (claimError) return databaseFailure(response, 'payments.refund_claim_failed', claimError, 500)
  if (!claimed) return response.status(409).json({ error: 'This payment is already being refunded. Refresh and try again.' })
  const releaseClaim = () => supabase.from('payments').update({ refunded_paise: alreadyRefunded, updated_at: new Date().toISOString() }).eq('id', payment.id).eq('refunded_paise', refundedAfter)
  const auth = Buffer.from(`${keys.key}:${keys.secret}`).toString('base64')
  let providerResponse: Awaited<ReturnType<typeof fetch>>
  try {
    providerResponse = await fetch(`https://api.razorpay.com/v1/payments/${payment.provider_payment_id}/refund`, { method: 'POST', headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json', 'X-Razorpay-Idempotency': `refund-${payment.id}-${refundedAfter}` }, body: JSON.stringify({ amount: refundAmount }), signal: AbortSignal.timeout(8000) })
  } catch (error) {
    await releaseClaim()
    return failure(response, 502, 'Payment provider refund failed', 'payments.refund_request_failed', error)
  }
  if (!providerResponse.ok) {
    await releaseClaim()
    return response.status(502).json({ error: 'Payment provider refund failed' })
  }
  const { data, error } = await supabase.from('payments').update({ status: refundedAfter >= payment.amount_paise ? 'refunded' : 'paid', updated_at: new Date().toISOString() }).eq('id', payment.id).eq('refunded_paise', refundedAfter).select().single()
  if (error) return databaseFailure(response, 'payments.refund_status_failed', error, 500, 'The refund was sent but the payment record could not be updated. Contact support.')
  response.json(data)
})
export default router
