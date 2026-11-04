import crypto from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import express, { Router, type Request, type Response } from 'express'
import rateLimit from 'express-rate-limit'
import { z } from 'zod'
import { requireAuth } from '../middleware/auth.js'
import { supabase } from '../supabase.js'
import { logger } from '../lib/logger.js'
import { bookingSchema } from '../lib/schemas.js'
import { customerHasGstWaiver, GST_PERCENTAGE, GST_RATE, quoteServices } from '../services/pricing.js'
import { emitRealtimeToUser, emitRealtimeToVendor } from '../services/realtime.js'
import { sendPushNotification } from '../services/pushNotifications.js'
import { isJpeg, selfieBucket, selfieMaxBytes, selfieObjectPath } from '../services/selfie.js'
import { notifyCustomerSms } from '../services/bookingNotifications.js'
import { config } from '../config.js'
import { toE164IndianMobile } from '../lib/phone.js'
import { databaseFailure, failure } from '../lib/httpErrors.js'
import { PricingError } from '../services/pricingMath.js'
import { listWindow, sendList } from '../lib/listParams.js'
import { cachedCatalog } from '../services/catalogCache.js'
import { limiterStore } from '../services/scaling.js'
const router = Router()
const catalogCacheControl = 'private, max-age=30, stale-while-revalidate=120'
const quoteLimit = rateLimit({ windowMs: 10 * 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false, store: limiterStore('rl:customer:quote:', 'open'), passOnStoreError: true, keyGenerator: (request) => request.authUser!.id, message: { error: 'Too many quote requests. Try again later.' } })
const phoneVerificationWindowMs = 15 * 60 * 1000
function recentVerificationCutoff() { return new Date(Date.now() - phoneVerificationWindowMs).toISOString() }
function bookingReference() { return `UT-${crypto.randomBytes(5).toString('hex').toUpperCase()}` }
async function recentPhoneVerification(challengeId: string | undefined, phoneE164: string) {
  if (!challengeId) return { verified: false, error: null }
  const { data, error } = await supabase.from('guest_otp_challenges').select('id').eq('id', challengeId).eq('phone_e164', phoneE164).not('verified_at', 'is', null).gte('verified_at', recentVerificationCutoff()).maybeSingle()
  return { verified: Boolean(data), error }
}
async function passwordIsCorrect(email: string, password: string) {
  const verifier = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })
  const { error } = await verifier.auth.signInWithPassword({ email, password })
  return !error
}
function pushVendorOrder(ownerId: string, bookingId: string, reference: string) {
  void sendPushNotification({
    recipientId: ownerId,
    title: 'New delivery request',
    body: `Booking ${reference} is ready for review.`,
    data: { eventType: 'vendor_order_created', bookingId },
  }).catch((error) => logger.warn('vendor_order.push_failed', {
    bookingId,
    error: error instanceof Error ? error.message : 'Unknown error',
  }))
}
type GeoPoint = { latitude: number; longitude: number }
type DispatchVendor = { id: string; owner_profile_id: string | null; service_zone: string; latitude: number | null; longitude: number | null }
function distanceKm(first: GeoPoint, second: GeoPoint) {
  const radians = (degrees: number) => degrees * Math.PI / 180
  const latitudeDelta = radians(second.latitude - first.latitude)
  const longitudeDelta = radians(second.longitude - first.longitude)
  const a = Math.sin(latitudeDelta / 2) ** 2 + Math.cos(radians(first.latitude)) * Math.cos(radians(second.latitude)) * Math.sin(longitudeDelta / 2) ** 2
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}
async function findNearbyVendors(latitude?: number | null, longitude?: number | null) {
  const { data, error } = await supabase.from('vendors').select('id,owner_profile_id,service_zone,latitude,longitude').eq('is_online', true).eq('verification', 'approved')
  if (error) throw new Error(`Nearby vendors could not be loaded: ${error.message}`)
  const origin = latitude !== null && latitude !== undefined && longitude !== null && longitude !== undefined
    ? { latitude: Number(latitude), longitude: Number(longitude) }
    : null
  const nearby = ((data ?? []) as DispatchVendor[]).map((vendor) => {
    const vendorPoint = vendor.latitude !== null && vendor.longitude !== null
      ? { latitude: Number(vendor.latitude), longitude: Number(vendor.longitude) }
      : null
    const distance = origin && vendorPoint ? distanceKm(origin, vendorPoint) : null
    return { ...vendor, distance_km: distance === null ? null : Math.round(distance * 10) / 10 }
  }).filter((vendor) => vendor.distance_km === null || vendor.distance_km <= 50)
  return nearby.sort((first, second) => (first.distance_km ?? Number.POSITIVE_INFINITY) - (second.distance_km ?? Number.POSITIVE_INFINITY))
}
function vendorNotifications(vendors: Awaited<ReturnType<typeof findNearbyVendors>>, booking: { id: string; reference: string; payment_method?: string }) {
  const recipients = vendors.filter((vendor): vendor is typeof vendor & { owner_profile_id: string } => Boolean(vendor.owner_profile_id))
  return recipients.map((vendor) => ({
    recipient_id: vendor.owner_profile_id,
    event_type: 'vendor_order_created',
    title: 'New nearby delivery request',
    payload: { bookingId: booking.id, reference: booking.reference, paymentMethod: booking.payment_method, distanceKm: vendor.distance_km },
  }))
}
function notifyNearbyVendors(vendors: Awaited<ReturnType<typeof findNearbyVendors>>, booking: { id: string; reference: string; payment_method?: string }, sendPush: boolean) {
  const recipients = vendors.filter((vendor): vendor is typeof vendor & { owner_profile_id: string } => Boolean(vendor.owner_profile_id))
  for (const vendor of recipients) {
    if (sendPush) pushVendorOrder(vendor.owner_profile_id, booking.id, booking.reference)
    emitRealtimeToVendor(vendor.id, 'vendor.order.created', { vendorId: vendor.id, bookingId: booking.id, reference: booking.reference, distanceKm: vendor.distance_km })
  }
}
// The loaders throw the Supabase error so a failed read is not cached.
async function loadServices() {
  const { data, error } = await supabase.from('service_catalog').select('code,name,description,base_price_paise,is_active,config').eq('is_active', true).order('name')
  if (error) throw error
  return data ?? []
}
async function loadOffers() {
  const { data, error } = await supabase.from('coupons').select('id,code,title,discount_type,discount_value,valid_until').eq('is_active', true).or('valid_until.is.null,valid_until.gte.' + new Date().toISOString()).order('created_at', { ascending: false })
  if (error) throw error
  return data ?? []
}
router.get('/services', async (_request, response) => {
  try {
    const services = await cachedCatalog('customer.services', loadServices)
    response.setHeader('Cache-Control', catalogCacheControl)
    response.json(services)
  } catch (error) {
    return databaseFailure(response, 'customer.database_error', error, 500)
  }
})
// Offers filter on the current time. The 60 s TTL means an offer can stay listed up to 60 s after valid_until (accepted by product).
router.get('/pricing', (_request, response) => {
  response.setHeader('Cache-Control', catalogCacheControl)
  response.json({ gstPercentage: GST_PERCENTAGE, gstRate: GST_RATE })
})
router.get('/offers', async (_request, response) => {
  try {
    const offers = await cachedCatalog('customer.offers', loadOffers, 60_000)
    response.setHeader('Cache-Control', catalogCacheControl)
    response.json(offers)
  } catch (error) {
    return databaseFailure(response, 'customer.database_error', error, 500)
  }
})
router.post('/coupons/validate', async (request, response) => { const parsed = z.object({ code: z.string().min(2).max(80), serviceCode: z.string().optional(), amount: z.number().nonnegative() }).safeParse(request.body); if (!parsed.success) return response.status(400).json({ error: 'Invalid coupon request' }); const { data, error } = await supabase.from('coupons').select('id,code,title,discount_type,discount_value,valid_until').eq('code', parsed.data.code.toUpperCase()).eq('is_active', true).or('valid_until.is.null,valid_until.gte.' + new Date().toISOString()).maybeSingle(); if (error) return failure(response, 500, 'Coupon could not be checked.', 'customer.coupon_validate_failed', error); if (!data) return response.status(404).json({ error: 'Coupon is not available' }); response.json({ valid: true, coupon: { id: data.id, code: data.code, title: data.title, discountType: data.discount_type, discountValue: Number(data.discount_value), validUntil: data.valid_until } }) })
router.use(requireAuth)
router.get('/pricing/me', async (request, response) => {
  try {
    const gstWaived = await customerHasGstWaiver(request.authUser!.id)
    response.json({ gstPercentage: GST_PERCENTAGE, gstRate: gstWaived ? 0 : GST_RATE, gstWaived })
  } catch (error) {
    return failure(response, 500, 'GST eligibility could not be checked. Please try again.', 'customer.pricing_failed', error)
  }
})
router.get('/phone-verification', async (request, response) => {
  const { data: profile, error: profileError } = await supabase.from('profiles').select('phone_e164').eq('id', request.authUser!.id).single()
  if (profileError) return databaseFailure(response, 'customer.phone_verification_failed', profileError, 500)
  const phoneE164 = toE164IndianMobile(String(profile.phone_e164 ?? ''))
  if (!phoneE164) return response.json({ phone: '', verified: false, required: config.REQUIRE_BOOKING_PHONE_VERIFICATION })
  if (!config.REQUIRE_BOOKING_PHONE_VERIFICATION) {
    return response.json({
      phone: phoneE164.slice(-10),
      verified: true,
      required: false,
    })
  }
  const { data: challenge, error } = await supabase.from('guest_otp_challenges').select('id').eq('phone_e164', phoneE164).not('verified_at', 'is', null).gte('verified_at', recentVerificationCutoff()).order('verified_at', { ascending: false }).limit(1).maybeSingle()
  if (error) return databaseFailure(response, 'customer.phone_verification_failed', error, 500)
  response.json({
    phone: phoneE164.slice(-10),
    verified: config.REQUIRE_BOOKING_PHONE_VERIFICATION ? Boolean(challenge) : true,
    required: config.REQUIRE_BOOKING_PHONE_VERIFICATION,
  })
})
router.get('/usage', async (request, response) => { const { data, error } = await supabase.from('bookings').select('quoted_amount_paise,status').eq('customer_id', request.authUser!.id); if (error) return databaseFailure(response, 'customer.database_error', error, 500); const delivered = (data ?? []).filter((item) => item.status === 'delivered'); const totalSpend = delivered.reduce((sum, item) => sum + Number(item.quoted_amount_paise ?? 0) / 100, 0); response.json({ deliveries: delivered.length, totalSpend, averageAmount: delivered.length ? Math.round(totalSpend / delivered.length) : 0 }) })
router.get('/orders', async (request, response) => {
  const offset = Number(request.query.offset ?? 0)
  const pageSize = Number(request.query.pageSize ?? 100)
  if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) return response.status(400).json({ error: 'Invalid booking page' })
  const { data, error } = await supabase.from('bookings')
    .select('id,reference,service_code,service_details,address_text,latitude,longitude,quoted_amount_paise,status,scheduled_for,customer_phone_e164,access_notes,payment_method,created_at')
    .eq('customer_id', request.authUser!.id).order('created_at', { ascending: false }).range(offset, offset + pageSize)
  if (error) return databaseFailure(response, 'customer.database_error', error, 500)
  const rows = data ?? []
  response.json({ rows: rows.slice(0, pageSize), nextOffset: rows.length > pageSize ? offset + pageSize : null })
})
function getBookingServices(data: z.infer<typeof bookingSchema>) {
  const isLegacyPayload = !data.services?.length
  const items = data.services ?? (data.serviceId ?? '').split(',').map((serviceId) => ({
    serviceId,
    capacity: data.capacity,
    details: data.notes,
    deliveryDate: data.deliveryDate,
    preferredTime: data.preferredTime,
    location: data.location,
    waterType: undefined,
    tankerCount: undefined,
    serviceType: undefined,
    quantity: undefined,
    depth: undefined,
    grade: undefined,
    pump: undefined,
    pickupLocation: undefined,
    materialType: undefined,
    phone: data.phone,
    latitude: data.latitude,
    longitude: data.longitude,
    phoneVerificationChallengeId: undefined,
  }))
  return items.map((item) => ({
    serviceId: item.serviceId.trim(),
    capacity: item.capacity?.trim() ?? '',
    waterType: item.waterType?.trim() ?? '',
    tankerCount: item.tankerCount,
    serviceType: item.serviceType?.trim() ?? '',
    quantity: item.quantity?.trim() ?? '',
    depth: item.depth?.trim() ?? '',
    grade: item.grade?.trim() ?? '',
    pump: item.pump,
    pickupLocation: item.pickupLocation?.trim() ?? '',
    materialType: item.materialType?.trim() ?? '',
    details: item.serviceId === 'water_tanker' ? undefined : item.details?.trim() ?? '',
    deliveryDate: item.deliveryDate ?? data.deliveryDate ?? '',
    preferredTime: item.preferredTime ?? data.preferredTime,
    location: item.location ?? data.location,
    phone: item.phone ?? (isLegacyPayload ? data.phone : undefined),
    latitude: item.latitude ?? (isLegacyPayload ? data.latitude : undefined),
    longitude: item.longitude ?? (isLegacyPayload ? data.longitude : undefined),
    phoneVerificationChallengeId: item.phoneVerificationChallengeId,
  })).filter((item) => item.serviceId)
}
async function validateServicePhoneVerification(data: z.infer<typeof bookingSchema>, services: ReturnType<typeof getBookingServices>, requireBookingContactVerification = true) {
  const contactChallenges = new Map<string, { challengeId?: string; serviceId: string }>()
  for (const service of services) {
    if (service.phone && (requireBookingContactVerification || service.phone !== data.phone)) contactChallenges.set(service.phone, { challengeId: service.phoneVerificationChallengeId, serviceId: service.serviceId })
  }
  if (data.phone && requireBookingContactVerification) contactChallenges.set(data.phone, { challengeId: data.phoneVerificationChallengeId ?? contactChallenges.get(data.phone)?.challengeId, serviceId: 'booking contact' })
  for (const [phone, contact] of contactChallenges) {
    const phoneE164 = toE164IndianMobile(phone)
    if (!phoneE164) return { status: 400, message: 'Enter a valid 10-digit mobile number.' }
    const { verified, error } = await recentPhoneVerification(contact.challengeId, phoneE164)
    if (error) return { status: 500, message: 'Phone verification could not be confirmed.' }
    if (!verified) return { status: 400, message: `Verify the contact number for ${contact.serviceId} before booking.` }
  }
  return null
}
function bookingInsert(data: z.infer<typeof bookingSchema>, services: ReturnType<typeof getBookingServices>, vendorId: string | null, quotedAmountPaise: number) {
  const primaryService = services[0]
  if (!primaryService) throw new Error('At least one service is required')
  const capacityText = primaryService.capacity || (!data.services?.length ? data.capacity : '') || ''
  const capacityMatch = capacityText.match(/^([\d,]+)\s*(?:litres?|l)?$/i)
  const isTankerService = ['water_tanker', 'sewage_tanker'].includes(primaryService.serviceId)
  const serviceDetails = services.map((service) => {
    const persisted = { ...service }
    delete persisted.phoneVerificationChallengeId
    return persisted
  })
  return {
    customer_phone_e164: toE164IndianMobile(data.phone ?? primaryService.phone ?? ''),
    payment_method: data.paymentMethod,
    vendor_id: vendorId,
    service_code: primaryService.serviceId,
    capacity_litres: (isTankerService || !data.services?.length) && capacityMatch ? Number.parseInt(capacityMatch[1]?.replace(/,/g, '') ?? '', 10) || null : null,
    service_details: serviceDetails,
    address_text: primaryService.location ?? data.location,
    latitude: primaryService.latitude ?? data.latitude ?? null,
    longitude: primaryService.longitude ?? data.longitude ?? null,
    scheduled_for: primaryService.deliveryDate && primaryService.preferredTime
      ? new Date(`${primaryService.deliveryDate}T${primaryService.preferredTime}:00+05:30`).toISOString()
      : primaryService.deliveryDate || data.deliveryDate,
    access_notes: data.notes ?? null,
    quoted_amount_paise: quotedAmountPaise,
  }
}
async function createBookingAndNotifications(input: {
  customerId: string
  reference: string
  idempotencyKey?: string
  booking: ReturnType<typeof bookingInsert>
  vendors: Awaited<ReturnType<typeof findNearbyVendors>>
  payment?: { provider: string; amount_paise: number; currency: string; status: string }
}) {
  const { data, error } = await supabase.rpc('create_customer_booking', {
    p_booking: {
      ...input.booking,
      reference: input.reference,
      customer_id: input.customerId,
      idempotency_key: input.idempotencyKey ?? null,
    },
    p_notifications: vendorNotifications(input.vendors, { id: '', reference: input.reference, payment_method: input.booking.payment_method }),
    p_payment: input.payment ?? null,
  })
  if (error) throw error
  const result = data as { booking: { id: string; reference: string; vendor_id: string | null; quoted_amount_paise?: number; payment_method?: string }; created: boolean }
  if (result?.booking?.id) notifyNearbyVendors(input.vendors, result.booking, result.created)
  if (result?.created && input.booking.customer_phone_e164) {
    void notifyCustomerSms(input.booking.customer_phone_e164, 'guest_booking_confirmation', { reference: input.reference })
  }
  return result
}
function quoteFailure(response: Response, error: unknown) {
  if (error instanceof PricingError) return response.status(400).json({ error: error.message })
  return failure(response, 500, 'Booking quote could not be calculated. Please try again.', 'customer.quote_failed', error)
}
async function placeQuotedBooking(request: Request, response: Response, includeQuote: boolean) {
  const parsed = bookingSchema.safeParse(request.body)
  if (!parsed.success) return response.status(400).json({ error: 'Invalid booking', details: parsed.error.flatten() })
  const customerId = request.authUser!.id
  if (!config.REQUIRE_BOOKING_PHONE_VERIFICATION) {
    const { data: profile, error } = await supabase.from('profiles').select('phone_e164').eq('id', customerId).maybeSingle()
    if (error) return databaseFailure(response, 'customer.phone_verification_failed', error, 500)
    const accountPhone = toE164IndianMobile(String(profile?.phone_e164 ?? ''))
    if (!accountPhone) return response.status(400).json({ error: 'Add a mobile number to your account before booking.' })
    parsed.data.phone = accountPhone.slice(-10)
  }
  const services = getBookingServices(parsed.data)
  if (!services.length) return response.status(400).json({ error: 'At least one service is required' })
  const verificationError = await validateServicePhoneVerification(parsed.data, services, config.REQUIRE_BOOKING_PHONE_VERIFICATION)
  if (verificationError) return response.status(verificationError.status).json({ error: verificationError.message })
  let quote: Awaited<ReturnType<typeof quoteServices>>
  try {
    quote = await quoteServices(services, parsed.data.couponCode, customerId)
  } catch (error) {
    return quoteFailure(response, error)
  }
  if (quote.couponId) {
    const { error: redemptionError } = await supabase.from('coupon_redemptions').insert({ coupon_id: quote.couponId, customer_id: customerId, redeemed_at: new Date().toISOString() })
    if (redemptionError?.code === '23505') return response.status(409).json({ error: 'This coupon has already been used on this account.' })
    if (redemptionError) return failure(response, 500, 'Booking could not be saved. Please try again.', 'customer.coupon_redemption_failed', redemptionError)
  }
  try {
    const vendors = await findNearbyVendors(parsed.data.latitude, parsed.data.longitude)
    const result = await createBookingAndNotifications({
      customerId,
      reference: bookingReference(),
      idempotencyKey: parsed.data.idempotencyKey,
      booking: bookingInsert(parsed.data, services, null, quote.totalPaise),
      vendors,
      payment: parsed.data.paymentMethod === 'cod' ? { provider: 'cash_on_delivery', amount_paise: quote.totalPaise, currency: 'INR', status: 'pending' } : undefined,
    })
    emitRealtimeToUser(customerId, 'booking.created', result.booking)
    return response.status(result.created ? 201 : 200).json(includeQuote ? { ...result.booking, quote } : result.booking)
  } catch (error) {
    if (quote.couponId) await supabase.from('coupon_redemptions').delete().eq('coupon_id', quote.couponId).eq('customer_id', customerId)
    return databaseFailure(response, 'customer.booking_failed', error, 500, 'Booking could not be saved. Please try again.')
  }
}
router.post('/orders', async (request, response) => placeQuotedBooking(request, response, false))
router.post('/orders/quote', quoteLimit, async (request, response) => placeQuotedBooking(request, response, true))

router.post('/orders/quote-preview', quoteLimit, async (request, response) => {
  const parsed = bookingSchema.safeParse(request.body)
  if (!parsed.success) return response.status(400).json({ error: 'Invalid booking', details: parsed.error.flatten() })
  const services = getBookingServices(parsed.data)
  if (!services.length) return response.status(400).json({ error: 'At least one service is required' })
  try {
    const quote = await quoteServices(services, parsed.data.couponCode, request.authUser!.id)
    return response.json({ quote, paymentMethod: parsed.data.paymentMethod ?? 'cod' })
  } catch (error) {
    return quoteFailure(response, error)
  }
})
router.get('/invoices', async (request, response) => {
  const list = listWindow(request.query)
  const { data, error, count } = await supabase.from('invoices').select('*', { count: list.mode === 'paged' ? 'exact' : undefined }).eq('customer_id', request.authUser!.id).order('issued_at', { ascending: false }).range(list.from, list.to)
  if (error) return databaseFailure(response, 'customer.database_error', error, 500)
  sendList(response, list, data ?? [], count)
})
router.get('/invoices/:invoiceId/download', async (request, response) => { const { data, error } = await supabase.from('invoices').select('*').eq('id', request.params.invoiceId).eq('customer_id', request.authUser!.id).single(); if (error || !data) return response.status(404).json({ error: 'Invoice not found' }); response.json(data) })
router.get('/addresses', async (request, response) => { const { data, error } = await supabase.from('saved_addresses').select('*').eq('user_id', request.authUser!.id).order('is_default', { ascending: false }).order('created_at', { ascending: false }); if (error) return databaseFailure(response, 'customer.database_error', error, 500); response.json(data ?? []) })
router.post('/addresses', async (request, response) => { const parsed = z.object({ label: z.string().min(1).max(60), address: z.string().min(3).max(240), city: z.string().min(2).max(80), pincode: z.string().min(4).max(12), latitude: z.number().optional(), longitude: z.number().optional(), isDefault: z.boolean().default(false) }).safeParse(request.body); if (!parsed.success) return response.status(400).json({ error: 'Invalid address' }); if (parsed.data.isDefault) await supabase.from('saved_addresses').update({ is_default: false }).eq('user_id', request.authUser!.id); const { data, error } = await supabase.from('saved_addresses').insert({ user_id: request.authUser!.id, label: parsed.data.label, address: parsed.data.address, city: parsed.data.city, pincode: parsed.data.pincode, latitude: parsed.data.latitude, longitude: parsed.data.longitude, is_default: parsed.data.isDefault }).select().single(); if (error) return databaseFailure(response, 'customer.database_error', error, 400); response.status(201).json(data) })
router.patch('/addresses/:id', async (request, response) => { const parsed = z.object({ label: z.string().min(1).max(60).optional(), address: z.string().min(3).max(240).optional(), city: z.string().min(2).max(80).optional(), pincode: z.string().min(4).max(12).optional(), isDefault: z.boolean().optional() }).safeParse(request.body); if (!parsed.success) return response.status(400).json({ error: 'Invalid address update' }); if (parsed.data.isDefault === true) await supabase.from('saved_addresses').update({ is_default: false }).eq('user_id', request.authUser!.id); const update = Object.fromEntries(Object.entries({ label: parsed.data.label, address: parsed.data.address, city: parsed.data.city, pincode: parsed.data.pincode, is_default: parsed.data.isDefault }).filter(([, value]) => value !== undefined)); const { data, error } = await supabase.from('saved_addresses').update(update).eq('id', request.params.id).eq('user_id', request.authUser!.id).select().single(); if (error) return databaseFailure(response, 'customer.database_error', error, 400); response.json(data) })
router.delete('/addresses/:id', async (request, response) => { const { error } = await supabase.from('saved_addresses').delete().eq('id', request.params.id).eq('user_id', request.authUser!.id); if (error) return databaseFailure(response, 'customer.database_error', error, 400); response.status(204).send() })
router.get('/subscriptions', async (request, response) => {
  const list = listWindow(request.query)
  const { data, error, count } = await supabase.from('subscriptions').select('*', { count: list.mode === 'paged' ? 'exact' : undefined }).eq('customer_id', request.authUser!.id).order('created_at', { ascending: false }).range(list.from, list.to)
  if (error) return databaseFailure(response, 'customer.database_error', error, 500)
  sendList(response, list, data ?? [], count)
})
router.get('/profile', async (request, response) => { const { data, error } = await supabase.from('profiles').select('full_name, phone_e164').eq('id', request.authUser!.id).single(); if (error) return databaseFailure(response, 'customer.database_error', error, 500); response.json({ name: data.full_name, email: request.authUser!.email ?? '', phone: String(data.phone_e164 ?? '').replace(/\D/g, '').slice(-10) }) })
router.post('/profile/selfie', express.raw({ type: 'image/jpeg', limit: selfieMaxBytes }), async (request, response) => {
  const customerId = request.authUser!.id
  const image = request.body
  if (!Buffer.isBuffer(image) || !isJpeg(image)) return response.status(400).json({ error: 'Upload a JPEG selfie.' })
  const path = selfieObjectPath(customerId)
  const { error: uploadError } = await supabase.storage.from(selfieBucket).upload(path, image, { contentType: 'image/jpeg', upsert: true })
  if (uploadError) return response.status(500).json({ error: 'The selfie could not be saved. Please try again.' })
  const capturedAt = new Date().toISOString()
  const { error } = await supabase.from('profiles').update({ selfie_path: path, selfie_required: false, selfie_captured_at: capturedAt }).eq('id', customerId)
  if (error) return databaseFailure(response, 'customer.database_error', error, 500)
  response.status(201).json({ capturedAt, selfieRequired: false })
})
router.get('/profile/selfie', async (request, response) => {
  const { data: profile, error } = await supabase.from('profiles').select('selfie_path,selfie_captured_at').eq('id', request.authUser!.id).maybeSingle()
  if (error) return databaseFailure(response, 'customer.database_error', error, 500)
  if (!profile?.selfie_path) return response.status(404).json({ error: 'Selfie not found' })
  const { data: signed, error: signError } = await supabase.storage.from(selfieBucket).createSignedUrl(profile.selfie_path, 300)
  if (signError || !signed) return response.status(500).json({ error: 'Selfie link could not be created' })
  response.json({ url: signed.signedUrl, expiresInSeconds: 300, capturedAt: profile.selfie_captured_at })
})
router.patch('/profile', async (request, response) => {
  const parsed = z.object({
    name: z.string().min(2).max(60),
    email: z.string().email(),
    phone: z.string().regex(/^\d{10}$/).optional(),
    phoneVerificationChallengeId: z.string().uuid().optional(),
    currentPassword: z.string().min(1).max(200).optional(),
  }).safeParse(request.body)
  if (!parsed.success) return response.status(400).json({ error: 'Invalid profile' })
  const userId = request.authUser!.id
  const currentEmail = request.authUser!.email
  const emailChanged = currentEmail !== undefined && currentEmail !== parsed.data.email
  const profileUpdate: Record<string, unknown> = { full_name: parsed.data.name }
  if (parsed.data.phone !== undefined) {
    const phoneE164 = toE164IndianMobile(parsed.data.phone)
    if (!phoneE164) return response.status(400).json({ error: 'Enter a valid 10-digit mobile number.' })
    const { data: current, error: currentError } = await supabase.from('profiles').select('phone_e164').eq('id', userId).maybeSingle()
    if (currentError) return databaseFailure(response, 'customer.profile_lookup_failed', currentError, 500)
    if (toE164IndianMobile(String(current?.phone_e164 ?? '')) !== phoneE164) {
      const { verified, error } = await recentPhoneVerification(parsed.data.phoneVerificationChallengeId, phoneE164)
      if (error) return databaseFailure(response, 'customer.phone_verification_failed', error, 500)
      if (!verified) return response.status(400).json({ error: 'Verify the new mobile number before changing it.' })
      profileUpdate.phone_e164 = phoneE164
      profileUpdate.phone_verified_at = new Date().toISOString()
    }
  }
  if (emailChanged) {
    if (!parsed.data.currentPassword) return response.status(400).json({ error: 'Enter your current password to change your email.' })
    if (!(await passwordIsCorrect(currentEmail, parsed.data.currentPassword))) return response.status(400).json({ error: 'The current password is incorrect.' })
    const { error } = await supabase.auth.admin.updateUserById(userId, { email: parsed.data.email })
    if (error) return failure(response, 400, 'This email address cannot be used.', 'customer.email_update_failed', error)
  }
  const { data, error } = await supabase.from('profiles').update(profileUpdate).eq('id', userId).select().single()
  if (error) return databaseFailure(response, 'customer.profile_update_failed', error, 400)
  response.json({ name: data.full_name, email: emailChanged ? parsed.data.email : (currentEmail ?? parsed.data.email), phone: String(data.phone_e164 ?? '').replace(/\D/g, '').slice(-10) })
})
export default router
