import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import { databaseFailure, failure } from '../lib/httpErrors.js'
import crypto from 'node:crypto'
import { z } from 'zod'
import { requireAuth } from '../middleware/auth.js'
import { supabase } from '../supabase.js'
import { notifyCustomer } from '../services/customerNotifications.js'
import { sendTemplateSms } from '../services/sms.js'
import { canCustomerCancelBooking, transitionBooking } from '../services/bookingLifecycle.js'
import { signaturesMatch } from '../services/paymentSecurity.js'
import { hashOtp } from '../services/otp.js'
import { listWindow, sendList } from '../lib/listParams.js'
import { cachedCatalog } from '../services/catalogCache.js'
import { limiterStore } from '../services/scaling.js'
import { codSwitchStatuses, notifyRevertedToCash } from '../services/codOnlineSwitch.js'
const catalogCacheControl = 'private, max-age=30, stale-while-revalidate=120'
const router = Router(); router.use(requireAuth)
const deliveryOtpLimit = rateLimit({ windowMs: 10 * 60 * 1000, limit: 3, standardHeaders: true, legacyHeaders: false, store: limiterStore('rl:customerExtended:deliveryOtp:', 'open'), passOnStoreError: true, keyGenerator: (request) => `${request.authUser!.id}:${request.params.orderId}`, message: { error: 'Too many delivery codes requested for this order. Try again later.' } })
const statusSchema = z.object({ status: z.enum(['cancelled']) })
router.get('/orders/:orderId/tracking', async (request, response) => { const { data: booking, error: bookingError } = await supabase.from('bookings').select('id,status,customer_id,vehicle_id,driver_id,latitude,longitude').eq('id', request.params.orderId).eq('customer_id', request.authUser!.id).maybeSingle(); if (bookingError) return databaseFailure(response, 'customerExtended.database_error', bookingError, 500); if (!booking) return response.status(404).json({ error: 'Booking not found' }); const { data: location, error } = await supabase.from('vendor_location_updates').select('latitude,longitude,accuracy_metres,recorded_at').eq('booking_id', request.params.orderId).order('recorded_at', { ascending: false }).limit(1).maybeSingle(); if (error) return databaseFailure(response, 'customerExtended.database_error', error, 500); const [vehicleResult, driverResult] = await Promise.all([booking.vehicle_id ? supabase.from('vehicles').select('registration_number').eq('id', booking.vehicle_id).maybeSingle() : Promise.resolve({ data: null, error: null }), booking.driver_id ? supabase.from('drivers').select('name').eq('id', booking.driver_id).maybeSingle() : Promise.resolve({ data: null, error: null })]); if (vehicleResult.error || driverResult.error) return failure(response, 500, 'Tracking details could not be loaded.', 'customer.tracking_lookup_failed', vehicleResult.error ?? driverResult.error); response.json({ orderId: booking.id, status: booking.status, latitude: location?.latitude ?? undefined, longitude: location?.longitude ?? undefined, accuracy: location?.accuracy_metres ?? undefined, recorded_at: location?.recorded_at, customerLatitude: booking.latitude ?? undefined, customerLongitude: booking.longitude ?? undefined, vehicle: vehicleResult.data?.registration_number, driver: driverResult.data?.name, trackingAvailable: Boolean(location) }) })
router.post('/orders/:orderId/delivery-otp', deliveryOtpLimit, async (request, response) => { const { data: booking, error: bookingError } = await supabase.from('bookings').select('id,reference,status,scheduled_for').eq('id', request.params.orderId).eq('customer_id', request.authUser!.id).single(); if (bookingError || !booking) return response.status(404).json({ error: 'Booking not found' }); if (booking.status !== 'arrived') return response.status(409).json({ error: 'Delivery OTP is available when the vendor has arrived' }); const otp = crypto.randomInt(100000, 1000000).toString(); const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString(); const { data: profile } = await supabase.from('profiles').select('full_name,phone_e164').eq('id', request.authUser!.id).single(); const { error } = await supabase.from('bookings').update({ delivery_otp_hash: hashOtp(otp), delivery_otp_expires_at: expiresAt, delivery_otp_attempts: 0 }).eq('id', booking.id).eq('customer_id', request.authUser!.id); if (error) return response.status(500).json({ error: 'Delivery OTP could not be created' }); if (profile?.phone_e164) { const delivery = await sendTemplateSms('delivery_otp', profile.phone_e164, { reference: booking.reference, otp }); if (!delivery.queued) return response.status(503).json({ error: 'Delivery OTP could not be sent. Please try again.' }) } response.status(201).json({ expiresAt }) })
router.patch('/orders/:orderId/reschedule', async (request, response) => { const parsed = z.object({ scheduledFor: z.string().datetime() }).safeParse(request.body); if (!parsed.success || new Date(parsed.data.scheduledFor).getTime() <= Date.now()) return response.status(400).json({ error: 'Scheduled time must be a valid future datetime' }); const { data, error } = await supabase.from('bookings').update({ scheduled_for: parsed.data.scheduledFor, updated_at: new Date().toISOString() }).eq('id', request.params.orderId).eq('customer_id', request.authUser!.id).in('status', ['pending_vendor', 'vendor_assigned', 'accepted']).select().maybeSingle(); if (error) return databaseFailure(response, 'customerExtended.database_error', error, 400); if (!data) return response.status(409).json({ error: 'Booking cannot be rescheduled in its current state' }); response.json(data) })
router.patch('/orders/:orderId/status', async (request, response) => {
  const parsed = statusSchema.safeParse(request.body)
  if (!parsed.success) return response.status(400).json({ error: 'Invalid status' })
  const customerId = request.authUser!.id
  const { data: booking, error: bookingError } = await supabase.from('bookings').select('id,status').eq('id', request.params.orderId).eq('customer_id', customerId).maybeSingle()
  if (bookingError) return databaseFailure(response, 'customerExtended.database_error', bookingError, 500)
  if (!booking) return response.status(404).json({ error: 'Booking not found' })
  if (!canCustomerCancelBooking(booking.status)) return response.status(409).json({ error: 'A booking can only be cancelled before the vendor accepts it.' })
  const { data, error } = await transitionBooking({ bookingId: booking.id, actorId: customerId, status: 'cancelled', cancellationReason: 'Cancelled by customer' })
  if (error || !data) return failure(response, 409, 'Booking cannot be cancelled in its current state.', 'customer.cancel_failed', error)
  response.json(data)
})
router.post('/orders/:orderId/rating', async (request, response) => { const parsed = z.object({ rating: z.number().int().min(1).max(5), review: z.string().trim().max(1000).optional() }).safeParse(request.body); if (!parsed.success) return response.status(400).json({ error: 'Invalid rating' }); const { data: booking, error: bookingError } = await supabase.from('bookings').select('id,status').eq('id', request.params.orderId).eq('customer_id', request.authUser!.id).single(); if (bookingError || !booking) return response.status(404).json({ error: 'Booking not found' }); if (booking.status !== 'delivered') return response.status(409).json({ error: 'A rating can only be submitted after delivery' }); const { data, error } = await supabase.from('ratings').insert({ booking_id: booking.id, customer_id: request.authUser!.id, rating: parsed.data.rating, review: parsed.data.review || null }).select().single(); if (error) return error.code === '23505' ? failure(response, 409, 'Booking has already been rated.') : databaseFailure(response, 'customer.rating_failed', error, 400); response.status(201).json(data) })
router.get('/wallet', async (request, response) => {
  const list = listWindow(request.query)
  const { data, error, count } = await supabase.from('wallet_transactions').select('*', { count: list.mode === 'paged' ? 'exact' : undefined }).eq('customer_id', request.authUser!.id).order('created_at', { ascending: false }).range(list.from, list.to)
  if (error) return databaseFailure(response, 'customerExtended.database_error', error, 500)
  sendList(response, list, data ?? [], count)
})
router.post('/wallet/top-up/order', async (request, response) => { const parsed = z.object({ amount: z.number().positive().max(50000) }).safeParse(request.body); const key = process.env.RAZORPAY_KEY_ID; const secret = process.env.RAZORPAY_KEY_SECRET; if (!parsed.success) return response.status(400).json({ error: 'Invalid top-up amount' }); if (!key || !secret) return response.status(503).json({ error: 'Payment provider is not configured' }); const { data: transaction, error: transactionError } = await supabase.from('wallet_transactions').insert({ customer_id: request.authUser!.id, type: 'credit', amount: parsed.data.amount, status: 'pending' }).select().single(); if (transactionError || !transaction) return failure(response, 400, 'Wallet transaction could not be created.', 'customer.wallet_transaction_failed', transactionError); const auth = Buffer.from(`${key}:${secret}`).toString('base64'); const providerResponse = await fetch('https://api.razorpay.com/v1/orders', { method: 'POST', headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ amount: Math.round(parsed.data.amount * 100), currency: 'INR', receipt: transaction.id }), signal: AbortSignal.timeout(8000) }); if (!providerResponse.ok) return response.status(502).json({ error: 'Payment provider unavailable' }); const order = await providerResponse.json() as { id: string; amount: number; currency: string }; const { error } = await supabase.from('wallet_transactions').update({ provider_reference: order.id }).eq('id', transaction.id).eq('customer_id', request.authUser!.id); if (error) return response.status(500).json({ error: 'Wallet payment could not be linked' }); response.status(201).json({ id: order.id, amount: order.amount, currency: order.currency, keyId: key }) })
router.post('/wallet/top-up/verify', async (request, response) => { const parsed = z.object({ orderId: z.string().min(1), paymentId: z.string().min(1), signature: z.string().min(1) }).safeParse(request.body); const secret = process.env.RAZORPAY_KEY_SECRET; if (!parsed.success || !secret) return response.status(400).json({ error: 'Invalid wallet payment verification' }); const expected = crypto.createHmac('sha256', secret).update(`${parsed.data.orderId}|${parsed.data.paymentId}`).digest('hex'); if (!signaturesMatch(expected, parsed.data.signature)) return response.status(400).json({ error: 'Invalid payment signature' }); const { data, error } = await supabase.from('wallet_transactions').update({ provider_reference: parsed.data.paymentId, status: 'completed' }).eq('provider_reference', parsed.data.orderId).eq('customer_id', request.authUser!.id).eq('status', 'pending').select().single(); if (error || !data) return response.status(404).json({ error: 'Wallet transaction not found' }); response.json({ verified: true, transactionId: data.id }) })
router.patch('/subscriptions/:id/status', async (request, response) => { const parsed = z.object({ status: z.enum(['paused', 'cancelled']), nextDelivery: z.string().datetime().optional() }).safeParse(request.body); if (!parsed.success) return response.status(400).json({ error: 'Invalid subscription update' }); const { data, error } = await supabase.from('subscriptions').update(Object.fromEntries(Object.entries({ status: parsed.data.status, next_delivery: parsed.data.nextDelivery }).filter(([, value]) => value !== undefined))).eq('id', request.params.id).eq('customer_id', request.authUser!.id).select().single(); if (error) return databaseFailure(response, 'customerExtended.database_error', error, 400); response.json(data) })
router.post('/orders/:orderId/payment-method', async (request, response) => {
  const parsed = z.object({ paymentMethod: z.literal('cod') }).safeParse(request.body)
  if (!parsed.success) return response.status(400).json({ error: 'Only switching to cash on delivery is supported' })
  const customerId = request.authUser!.id
  const { data: booking, error: bookingError } = await supabase.from('bookings').select('id,status,payment_method,quoted_amount_paise').eq('id', request.params.orderId).eq('customer_id', customerId).maybeSingle()
  if (bookingError) return databaseFailure(response, 'customerExtended.database_error', bookingError, 500)
  if (!booking) return response.status(404).json({ error: 'Booking not found' })
  if (booking.payment_method === 'cod') return response.json({ id: booking.id, paymentMethod: 'cod' })
  if (booking.payment_method !== 'gateway') return response.status(409).json({ error: 'Payment method cannot be changed for this booking' })
  if (!codSwitchStatuses.includes(booking.status)) return response.status(409).json({ error: 'Payment method cannot be changed in the current booking state' })
  const { data: payment, error: paymentError } = await supabase.from('payments').select('id,status').eq('booking_id', booking.id).maybeSingle()
  if (paymentError) return databaseFailure(response, 'customerExtended.database_error', paymentError, 500)
  if (payment?.status === 'paid') return response.status(409).json({ error: 'This booking has already been paid online' })
  const { data: switched, error: switchError } = await supabase.from('bookings').update({ payment_method: 'cod', updated_at: new Date().toISOString() }).eq('id', booking.id).eq('customer_id', customerId).eq('payment_method', 'gateway').in('status', codSwitchStatuses).select('id').maybeSingle()
  if (switchError) return databaseFailure(response, 'customerExtended.database_error', switchError, 500)
  if (!switched) return response.status(409).json({ error: 'Payment method cannot be changed in the current booking state' })
  // A Razorpay capture can land between the check above and the update; revert in that case.
  const { data: latest } = await supabase.from('payments').select('status').eq('booking_id', booking.id).maybeSingle()
  if (latest?.status === 'paid') {
    await supabase.from('bookings').update({ payment_method: 'gateway' }).eq('id', booking.id).eq('customer_id', customerId)
    return response.status(409).json({ error: 'This booking has already been paid online' })
  }
  if (!payment) {
    const { error: insertError } = await supabase.from('payments').insert({ booking_id: booking.id, provider: 'cash_on_delivery', amount_paise: booking.quoted_amount_paise, currency: 'INR', status: 'pending' })
    if (insertError) return databaseFailure(response, 'customerExtended.database_error', insertError, 500)
  }
  await notifyRevertedToCash(booking.id)
  response.json({ id: booking.id, paymentMethod: 'cod' })
})
router.post('/orders/:orderId/payment-method/online', async (request, response) => {
  if (process.env.COD_ONLINE_SWITCH_ENABLED === 'false') return response.status(503).json({ error: 'Online payment is temporarily unavailable. Please pay in cash.' })
  const customerId = request.authUser!.id
  const { data: booking, error: bookingError } = await supabase.from('bookings').select('id,status,payment_method').eq('id', request.params.orderId).eq('customer_id', customerId).maybeSingle()
  if (bookingError) return databaseFailure(response, 'customerExtended.database_error', bookingError, 500)
  if (!booking) return response.status(404).json({ error: 'Booking not found' })
  if (booking.payment_method === 'gateway') return response.json({ id: booking.id, paymentMethod: 'gateway' })
  if (booking.payment_method !== 'cod') return response.status(409).json({ error: 'Payment method cannot be changed for this booking' })
  if (!codSwitchStatuses.includes(booking.status)) return response.status(409).json({ error: 'Online payment can only be chosen before the driver starts the trip' })
  const { data: payment, error: paymentError } = await supabase.from('payments').select('status').eq('booking_id', booking.id).maybeSingle()
  if (paymentError) return databaseFailure(response, 'customerExtended.database_error', paymentError, 500)
  if (payment?.status === 'paid') return response.status(409).json({ error: 'This booking has already been paid' })
  const now = new Date().toISOString()
  const { data: switched, error: switchError } = await supabase.from('bookings').update({ payment_method: 'gateway', payment_switched_to_online_at: now, updated_at: now }).eq('id', booking.id).eq('customer_id', customerId).eq('payment_method', 'cod').in('status', codSwitchStatuses).select('id').maybeSingle()
  if (switchError) return databaseFailure(response, 'customerExtended.database_error', switchError, 500)
  if (!switched) return response.status(409).json({ error: 'Online payment can only be chosen before the driver starts the trip' })
  // A capture can land between the check and the update. Keep it as COD in that case so the driver does not get a conflicting instruction.
  const { data: latest } = await supabase.from('payments').select('status').eq('booking_id', booking.id).maybeSingle()
  if (latest?.status === 'paid') {
    await supabase.from('bookings').update({ payment_method: 'cod', payment_switched_to_online_at: null }).eq('id', booking.id).eq('customer_id', customerId)
    return response.status(409).json({ error: 'This booking has already been paid' })
  }
  response.json({ id: booking.id, paymentMethod: 'gateway' })
})
router.get('/payments/:bookingId', async (request, response) => {
  const { data: booking, error: bookingError } = await supabase.from('bookings').select('id').eq('id', request.params.bookingId).eq('customer_id', request.authUser!.id).maybeSingle()
  if (bookingError) return databaseFailure(response, 'customerExtended.database_error', bookingError, 500)
  if (!booking) return response.status(404).json({ error: 'Booking not found' })
  const { data: payment, error } = await supabase.from('payments').select('status,amount_paise,currency,method,card_network,card_last4,bank,wallet,vpa,captured_at,fee_paise,tax_paise,refunded_paise').eq('booking_id', booking.id).maybeSingle()
  if (error) return databaseFailure(response, 'customerExtended.database_error', error, 500)
  if (!payment) return response.status(404).json({ error: 'Payment not found' })
  response.json({ status: payment.status, amountPaise: payment.amount_paise, currency: payment.currency, method: payment.method, cardNetwork: payment.card_network, cardLast4: payment.card_last4, bank: payment.bank, wallet: payment.wallet, vpa: payment.vpa, capturedAt: payment.captured_at, feePaise: payment.fee_paise, taxPaise: payment.tax_paise, refundedPaise: payment.refunded_paise })
})
router.get('/contracts', async (request, response) => { const { data, error } = await supabase.from('customer_contracts').select('*').eq('customer_id', request.authUser!.id).order('created_at', { ascending: false }); if (error) return databaseFailure(response, 'customerExtended.database_error', error, 500); response.json(data ?? []) })
router.post('/contracts', async (request, response) => { const parsed = z.object({ propertyType: z.string().min(2).max(40), servicePlan: z.record(z.string(), z.unknown()), address: z.string().min(3).max(240), estimate: z.number().nonnegative() }).safeParse(request.body); if (!parsed.success) return response.status(400).json({ error: 'Invalid contract request' }); const { data, error } = await supabase.from('customer_contracts').insert({ customer_id: request.authUser!.id, property_type: parsed.data.propertyType, service_plan: parsed.data.servicePlan, address: parsed.data.address, estimate: parsed.data.estimate }).select().single(); if (error) return databaseFailure(response, 'customerExtended.database_error', error, 400); response.status(201).json(data) })
router.get('/offers', async (_request, response) => { const { data, error } = await supabase.from('coupons').select('id,code,title,discount_type,discount_value,valid_until').eq('is_active', true).or('valid_until.is.null,valid_until.gte.' + new Date().toISOString()).order('created_at', { ascending: false }); if (error) return databaseFailure(response, 'customerExtended.database_error', error, 500); response.json(data ?? []) })
async function loadMembershipPlans() {
  const { data, error } = await supabase.from('membership_plans').select('*').eq('is_active', true).order('amount')
  if (error) throw error
  return data ?? []
}
router.get('/membership-plans', async (_request, response) => {
  try {
    const plans = await cachedCatalog('customer.membership-plans', loadMembershipPlans)
    response.setHeader('Cache-Control', catalogCacheControl)
    response.json(plans)
  } catch (error) {
    return databaseFailure(response, 'customerExtended.database_error', error, 500)
  }
})
router.get('/membership', async (request, response) => { const { data, error } = await supabase.from('customer_memberships').select('*, plan:membership_plans(*)').eq('customer_id', request.authUser!.id).maybeSingle(); if (error) return databaseFailure(response, 'customerExtended.database_error', error, 500); response.json(data ?? null) })
router.post('/membership', async (request, response) => { const parsed = z.object({ planId: z.string().uuid() }).safeParse(request.body); if (!parsed.success) return response.status(400).json({ error: 'Invalid membership plan' }); const { data: plan } = await supabase.from('membership_plans').select('id').eq('id', parsed.data.planId).eq('is_active', true).single(); if (!plan) return response.status(404).json({ error: 'Membership plan not found' }); const { data, error } = await supabase.from('customer_memberships').upsert({ customer_id: request.authUser!.id, plan_id: parsed.data.planId, status: 'requested' }, { onConflict: 'customer_id' }).select('*, plan:membership_plans(*)').single(); if (error) return databaseFailure(response, 'customerExtended.database_error', error, 400); response.status(201).json(data) })
router.patch('/membership', async (request, response) => { const parsed = z.object({ status: z.enum(['paused', 'cancelled']) }).safeParse(request.body); if (!parsed.success) return response.status(400).json({ error: 'Invalid membership status' }); const { data, error } = await supabase.from('customer_memberships').update({ status: parsed.data.status, updated_at: new Date().toISOString() }).eq('customer_id', request.authUser!.id).select('*, plan:membership_plans(*)').single(); if (error) return databaseFailure(response, 'customerExtended.database_error', error, 400); try { await notifyCustomer({ customerId: request.authUser!.id, eventType: 'membership_updated', title: 'Membership updated', detail: `Your membership is now ${parsed.data.status}.`, payload: { status: parsed.data.status } }) } catch { /* Membership update succeeded even if notification delivery is temporarily unavailable. */ } response.json(data) })
router.post('/push-subscription', async (request, response) => { const parsed = z.object({ endpoint: z.string().url(), keys: z.record(z.string(), z.string()).optional(), expirationTime: z.number().nullable().optional() }).safeParse(request.body); if (!parsed.success) return response.status(400).json({ error: 'Invalid push subscription' }); const { error } = await supabase.from('push_subscriptions').upsert({ customer_id: request.authUser!.id, endpoint: parsed.data.endpoint, subscription: parsed.data }, { onConflict: 'customer_id,endpoint' }); if (error) return databaseFailure(response, 'customerExtended.database_error', error, 400); response.status(201).json({ saved: true }) })
router.delete('/push-subscription', async (request, response) => { const parsed = z.object({ endpoint: z.string().url() }).safeParse(request.body); if (!parsed.success) return response.status(400).json({ error: 'Invalid push subscription' }); const { error } = await supabase.from('push_subscriptions').delete().eq('customer_id', request.authUser!.id).eq('endpoint', parsed.data.endpoint); if (error) return databaseFailure(response, 'customerExtended.database_error', error, 400); response.status(204).send() })
router.post('/coupons/validate', async (request, response) => { const parsed = z.object({ code: z.string().min(2).max(80), serviceCode: z.string().optional(), amount: z.number().nonnegative() }).safeParse(request.body); if (!parsed.success) return response.status(400).json({ error: 'Invalid coupon request' }); const { data, error } = await supabase.from('coupons').select('id').eq('code', parsed.data.code.toUpperCase()).eq('is_active', true).or('valid_until.is.null,valid_until.gte.' + new Date().toISOString()).maybeSingle(); if (error) return failure(response, 500, 'Coupon could not be checked.', 'customer.coupon_validate_failed', error); if (!data) return response.status(404).json({ error: 'Coupon is not available' }); response.json({ valid: true }) })
router.get('/notifications', async (request, response) => {
  const list = listWindow(request.query)
  let query = supabase.from('notifications').select('*', { count: list.mode === 'paged' ? 'exact' : undefined }).eq('recipient_id', request.authUser!.id).order('created_at', { ascending: false })
  if (typeof request.query.eventType === 'string') query = query.eq('event_type', request.query.eventType)
  if (typeof request.query.entityId === 'string') query = query.eq('payload->>bookingId', request.query.entityId)
  const { data, error, count } = await query.range(list.from, list.to)
  if (error) return databaseFailure(response, 'customerExtended.database_error', error, 500)
  sendList(response, list, data ?? [], count)
})
router.patch('/notifications/read-all', async (request, response) => { const { data, error } = await supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('recipient_id', request.authUser!.id).is('read_at', null).select('id'); if (error) return databaseFailure(response, 'customerExtended.database_error', error, 400); response.json({ updated: data?.length ?? 0 }) })
router.get('/notification-preferences', async (request, response) => { const { data, error } = await supabase.from('notification_preferences').upsert({ customer_id: request.authUser!.id }, { onConflict: 'customer_id' }).select().single(); if (error) return databaseFailure(response, 'customerExtended.database_error', error, 500); response.json(data) })
router.patch('/notification-preferences', async (request, response) => { const parsed = z.object({ bookingUpdates: z.boolean().optional(), paymentUpdates: z.boolean().optional(), marketingUpdates: z.boolean().optional(), pushEnabled: z.boolean().optional() }).safeParse(request.body); if (!parsed.success) return response.status(400).json({ error: 'Invalid notification preferences' }); const { data, error } = await supabase.from('notification_preferences').upsert({ customer_id: request.authUser!.id, booking_updates: parsed.data.bookingUpdates, payment_updates: parsed.data.paymentUpdates, marketing_updates: parsed.data.marketingUpdates, push_enabled: parsed.data.pushEnabled, updated_at: new Date().toISOString() }, { onConflict: 'customer_id' }).select().single(); if (error) return databaseFailure(response, 'customerExtended.database_error', error, 400); response.json(data) })
router.patch('/notifications/:id/read', async (request, response) => { const { data, error } = await supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', request.params.id).eq('recipient_id', request.authUser!.id).select().single(); if (error) return databaseFailure(response, 'customerExtended.database_error', error, 400); response.json(data) })
export default router
