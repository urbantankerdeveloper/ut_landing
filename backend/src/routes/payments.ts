import { databaseFailure } from '../lib/httpErrors.js'
import { Router } from 'express'
import crypto from 'node:crypto'
import { z } from 'zod'
import { requireAuth, requireFreshAuth, requireRole } from '../middleware/auth.js'
import { supabase } from '../supabase.js'
import { refundAmountInPaise, signaturesMatch } from '../services/paymentSecurity.js'
import { failure } from '../lib/httpErrors.js'
const router = Router()
const razorpay = () => ({ key: process.env.RAZORPAY_KEY_ID, secret: process.env.RAZORPAY_KEY_SECRET })
router.post('/razorpay/order', requireAuth, async (request, response) => {
  const parsed = z.object({ amount: z.number().positive().optional(), bookingId: z.string().uuid() }).safeParse(request.body)
  const keys = razorpay()
  if (!parsed.success) return response.status(400).json({ error: 'Invalid payment order' })
  const { data: booking, error: bookingError } = await supabase.from('bookings').select('id,status,quoted_amount_paise').eq('id', parsed.data.bookingId).eq('customer_id', request.authUser!.id).single()
  if (bookingError || !booking) return response.status(404).json({ error: 'Booking not found' })
  if (['cancelled', 'delivered'].includes(booking.status)) return response.status(409).json({ error: 'This booking can no longer be paid.' })
  const { data: existing, error: existingError } = await supabase.from('payments').select('status').eq('booking_id', booking.id).maybeSingle()
  if (existingError) return databaseFailure(response, 'payments.lookup_failed', existingError, 500)
  if (existing?.status === 'paid') return response.status(409).json({ error: 'This booking has already been paid.' })
  const amountPaise = Number(booking.quoted_amount_paise)
  if (!Number.isInteger(amountPaise) || amountPaise <= 0) return response.status(409).json({ error: 'Booking does not have an authoritative quote' })
  if (!keys.key || !keys.secret) return response.status(503).json({ error: 'Payment provider is not configured' })
  const auth = Buffer.from(`${keys.key}:${keys.secret}`).toString('base64')
  let providerResponse: Awaited<ReturnType<typeof fetch>>
  try {
    providerResponse = await fetch('https://api.razorpay.com/v1/orders', { method: 'POST', headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ amount: amountPaise, currency: 'INR', receipt: parsed.data.bookingId }), signal: AbortSignal.timeout(8000) })
  } catch (error) {
    return failure(response, 502, 'Payment provider unavailable', 'payments.order_request_failed', error)
  }
  if (!providerResponse.ok) return response.status(502).json({ error: 'Payment provider unavailable' })
  const order = await providerResponse.json() as { id: string; amount: number; currency: string }
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
router.post('/razorpay/verify', requireAuth, async (request, response) => {
  const parsed = z.object({ orderId: z.string(), paymentId: z.string(), signature: z.string() }).safeParse(request.body)
  const keys = razorpay()
  if (!parsed.success || !keys.secret) return response.status(400).json({ error: 'Invalid payment verification' })
  const expected = crypto.createHmac('sha256', keys.secret).update(`${parsed.data.orderId}|${parsed.data.paymentId}`).digest('hex')
  const expectedBuffer = Buffer.from(expected)
  const receivedBuffer = Buffer.from(parsed.data.signature)
  if (expectedBuffer.length !== receivedBuffer.length || !crypto.timingSafeEqual(expectedBuffer, receivedBuffer)) return response.status(400).json({ error: 'Invalid payment signature' })
  const { data: payment, error: paymentError } = await supabase.from('payments').select('id,booking_id').eq('provider_order_id', parsed.data.orderId).single()
  if (paymentError || !payment) return response.status(404).json({ error: 'Payment order not found' })
  const { data: booking, error: bookingError } = await supabase.from('bookings').select('id').eq('id', payment.booking_id).eq('customer_id', request.authUser!.id).single()
  if (bookingError || !booking) return response.status(403).json({ error: 'Payment is not owned by this customer' })
  const { data: settled, error } = await supabase.from('payments').update({ provider_payment_id: parsed.data.paymentId, status: 'paid', updated_at: new Date().toISOString() }).eq('id', payment.id).in('status', ['pending', 'failed']).select('id').maybeSingle()
  if (error) return databaseFailure(response, 'payments.verify_failed', error, 400)
  if (!settled) return response.status(409).json({ error: 'This payment has already been processed.' })
  response.json({ verified: true, orderId: payment.booking_id })
})
router.post('/razorpay/webhook', async (request, response) => {
  const signature = request.headers['x-razorpay-signature']
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET
  if (!secret || typeof signature !== 'string') return response.status(503).json({ error: 'Webhook is not configured' })
  const raw = (request as typeof request & { rawBody?: Buffer }).rawBody
  if (!raw) return response.status(400).json({ error: 'Raw webhook body is unavailable' })
  const expected = crypto.createHmac('sha256', secret).update(raw).digest('hex')
  if (!signaturesMatch(expected, signature)) return response.status(400).json({ error: 'Invalid webhook signature' })
  let event: { event?: string; payload?: { payment?: { entity?: { id?: string; order_id?: string; amount?: number } } } }
  try { event = JSON.parse(raw.toString('utf8')) as typeof event } catch { return response.status(400).json({ error: 'Invalid webhook payload' }) }
  const paymentEntity = event.payload?.payment?.entity
  const status = event.event === 'payment.captured' ? 'paid' : event.event === 'payment.authorized' ? 'pending' : event.event === 'payment.failed' ? 'failed' : null
  if (status && paymentEntity?.order_id && paymentEntity.id) {
    const { data: payment, error: lookupError } = await supabase.from('payments').select('amount_paise').eq('provider_order_id', paymentEntity.order_id).maybeSingle()
    if (lookupError) return databaseFailure(response, 'payments.webhook_lookup_failed', lookupError, 500, 'Payment event could not be persisted')
    if (status === 'paid' && payment && paymentEntity.amount !== payment.amount_paise) {
      console.error(JSON.stringify({ event: 'payment.amount_mismatch', providerOrderId: paymentEntity.order_id, capturedPaise: paymentEntity.amount, expectedPaise: payment.amount_paise }))
      return response.status(202).json({ accepted: true })
    }
    const { data: updated, error } = await supabase.from('payments').update({ provider_payment_id: paymentEntity.id, status, raw_webhook: event, updated_at: new Date().toISOString() }).eq('provider_order_id', paymentEntity.order_id).in('status', ['pending', 'failed']).select('id')
    if (error) return databaseFailure(response, 'payments.webhook_update_failed', error, 500, 'Payment event could not be persisted')
    if (!updated?.length) console.warn(JSON.stringify({ event: 'payment.webhook_no_matching_row', providerOrderId: paymentEntity.order_id, status }))
  }
  response.status(202).json({ accepted: true })
})
router.post('/payments/:id/refund', requireFreshAuth, requireAuth, requireRole('admin'), async (request, response) => {
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
