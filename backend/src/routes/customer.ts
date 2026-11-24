import crypto from 'node:crypto'
import express, { Router, type Request, type Response } from 'express'
import rateLimit from 'express-rate-limit'
import { z } from 'zod'
import { supabase } from '../supabase.js'
import { logger } from '../lib/logger.js'
import { bookingSchema } from '../lib/schemas.js'
import { customerHasGstWaiver, GST_PERCENTAGE, GST_RATE, quoteServices, testPricingPerServicePaise, type InvoiceLineSnapshot } from '../services/pricing.js'
import { generateMissingCustomerInvoices } from '../services/invoices.js'
import { emitRealtimeToUser, emitRealtimeToVendor } from '../services/realtime.js'
import { sendPushNotification } from '../services/pushNotifications.js'
import { isJpeg, selfieBucket, selfieMaxBytes, selfieObjectPath } from '../services/selfie.js'
import { notifyCustomerOfBooking } from '../services/bookingNotifications.js'
import { config } from '../config.js'
import { getManualAssignmentModeEnabled } from '../services/manualAssignmentMode.js'
import { toE164IndianMobile } from '../lib/phone.js'
import { allocateServiceAmountsPaise, PricingError } from '../services/pricingMath.js'
import { databaseFailure, failure } from '../lib/httpErrors.js'
import { listWindow, sendList } from '../lib/listParams.js'
import { cachedCatalog } from '../services/catalogCache.js'
import { limiterStore } from '../services/scaling.js'
import { isPhoneVerificationRequired, isPhoneVerified, logPhoneVerificationAudit } from '../services/phoneVerification.js'
import { authenticatedRateLimitKey, requireAuth } from '../middleware/auth.js'
const router = Router()
const catalogCacheControl = 'private, max-age=30, stale-while-revalidate=120'
const quoteLimit = rateLimit({ windowMs: 10 * 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false, store: limiterStore('rl:customer:quote:', 'open'), passOnStoreError: true, keyGenerator: (request) => authenticatedRateLimitKey(request, () => request.authUser!.id), message: { error: 'Too many quote requests. Try again later.' } })
const phoneVerificationWindowMs = 15 * 60 * 1000
function recentVerificationCutoff() { return new Date(Date.now() - phoneVerificationWindowMs).toISOString() }
function bookingReference() { return `UT-${crypto.randomBytes(5).toString('hex').toUpperCase()}` }
async function consumeRecentPhoneVerification(challengeId: string | undefined, phoneE164: string) {
  if (!challengeId) return { verified: false, error: null }
  const { data, error } = await supabase
    .from('guest_otp_challenges')
    .update({ consumed_at: new Date().toISOString() })
    .eq('id', challengeId)
    .eq('phone_e164', phoneE164)
    .eq('template_key', 'booking_verification_otp')
    .is('user_id', null)
    .is('consumed_at', null)
    .not('verified_at', 'is', null)
    .gte('verified_at', recentVerificationCutoff())
    .gt('expires_at', new Date().toISOString())
    .select('id')
    .maybeSingle()
  return { verified: Boolean(data), error }
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
  const rows = data ?? []
  if (!config.MULTI_SERVICE_ORDERS_ENABLED || rows.length === 0) return rows
  const { data: serviceTypes, error: serviceTypeError } = await supabase.from('service_types')
    .select('code,min_quantity,max_quantity,quantity_unit,active').eq('active', true)
  if (serviceTypeError) throw serviceTypeError
  const quantities = new Map((serviceTypes ?? []).map((service) => [service.code, service]))
  return rows.map((service) => {
    const type = quantities.get(service.code)
    return type ? {
      ...service,
      min_quantity: Number(type.min_quantity),
      max_quantity: Number(type.max_quantity),
      unit: type.quantity_unit,
    } : service
  })
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
  response.json({ gstPercentage: GST_PERCENTAGE, gstRate: GST_RATE, testPricingPerServicePaise: testPricingPerServicePaise() })
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
const legacyRouterAuth = (request: express.Request, response: express.Response, next: express.NextFunction) => config.featureFlags.AUTH_MOUNT_ONCE ? next() : requireAuth(request, response, next)
router.use(legacyRouterAuth)
router.get('/pricing/me', async (request, response) => {
  try {
    const gstWaived = await customerHasGstWaiver(request.authUser!.id)
    response.json({ gstPercentage: GST_PERCENTAGE, gstRate: gstWaived ? 0 : GST_RATE, gstWaived, testPricingPerServicePaise: testPricingPerServicePaise() })
  } catch (error) {
    return failure(response, 500, 'GST eligibility could not be checked. Please try again.', 'customer.pricing_failed', error)
  }
})
router.get('/phone-verification', async (request, response) => {
  const { data: profile, error: profileError } = await supabase.from('profiles').select('phone_e164,phone_verified,phone_verified_at').eq('id', request.authUser!.id).single()
  if (profileError) return databaseFailure(response, 'customer.phone_verification_failed', profileError, 500)
  const phoneE164 = toE164IndianMobile(String(profile.phone_e164 ?? ''))
  const phoneVerified = profile.phone_verified === true || Boolean(profile.phone_verified_at)
  if (!phoneE164) return response.json({ phone: '', verified: false, phoneVerified, challengeId: null, required: config.REQUIRE_BOOKING_PHONE_VERIFICATION })
  if (!config.REQUIRE_BOOKING_PHONE_VERIFICATION) {
    return response.json({
      phone: phoneE164.slice(-10),
      verified: true,
      phoneVerified,
      challengeId: null,
      required: false,
    })
  }
  const { data: challenge, error } = await supabase.from('guest_otp_challenges').select('id').eq('phone_e164', phoneE164).eq('template_key', 'booking_verification_otp').is('user_id', null).is('consumed_at', null).not('verified_at', 'is', null).gte('verified_at', recentVerificationCutoff()).gt('expires_at', new Date().toISOString()).order('verified_at', { ascending: false }).limit(1).maybeSingle()
  if (error) return databaseFailure(response, 'customer.phone_verification_failed', error, 500)
  response.json({
    phone: phoneE164.slice(-10),
    verified: config.REQUIRE_BOOKING_PHONE_VERIFICATION ? Boolean(challenge) : true,
    phoneVerified,
    challengeId: challenge?.id ?? null,
    required: config.REQUIRE_BOOKING_PHONE_VERIFICATION,
  })
})
router.get('/usage', async (request, response) => { const { data, error } = await supabase.from('bookings').select('quoted_amount_paise,status').eq('customer_id', request.authUser!.id); if (error) return databaseFailure(response, 'customer.database_error', error, 500); const delivered = (data ?? []).filter((item) => item.status === 'delivered'); const totalSpend = delivered.reduce((sum, item) => sum + Number(item.quoted_amount_paise ?? 0) / 100, 0); response.json({ deliveries: delivered.length, totalSpend, averageAmount: delivered.length ? Math.round(totalSpend / delivered.length) : 0 }) })
router.get('/orders', async (request, response) => {
  const offset = Number(request.query.offset ?? 0)
  const pageSize = Number(request.query.pageSize ?? 100)
  if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) return response.status(400).json({ error: 'Invalid booking page' })
  let data: unknown[] | null
  let error: { message: string } | null
  if (config.featureFlags.multi_service_tasks_enabled) {
    const result = await supabase.from('bookings')
      .select('id,reference,service_code,service_details,address_text,latitude,longitude,quoted_amount_paise,status,scheduled_for,customer_phone_e164,access_notes,payment_method,created_at,order_group_id,order_group_reference,order_group_size')
      .eq('customer_id', request.authUser!.id).order('created_at', { ascending: false }).range(offset, offset + pageSize)
    data = result.data
    error = result.error
  } else {
    const result = await supabase.from('bookings')
      .select('id,reference,service_code,service_details,address_text,latitude,longitude,quoted_amount_paise,status,scheduled_for,customer_phone_e164,access_notes,payment_method,created_at')
      .eq('customer_id', request.authUser!.id).order('created_at', { ascending: false }).range(offset, offset + pageSize)
    data = result.data
    error = result.error
  }
  if (error) return databaseFailure(response, 'customer.database_error', error, 500)
  const rows = (data ?? []) as Array<Record<string, unknown> & { id: string }>
  const visibleRows = rows.slice(0, pageSize)
  if (config.MULTI_SERVICE_ORDERS_ENABLED && visibleRows.length) {
    const bookingIds = visibleRows.map((row) => row.id)
    const [itemsResult, fulfilmentsResult] = await Promise.all([
      supabase.from('order_items').select('*,service_types(code,name,quantity_unit)').in('legacy_booking_id', bookingIds),
      supabase.from('order_fulfilments').select('id,order_id,legacy_booking_id,reference,status,vendor_id,latitude,longitude,delivered_at,created_at').in('legacy_booking_id', bookingIds),
    ])
    if (itemsResult.error || fulfilmentsResult.error) return databaseFailure(response, 'customer.multi_service_details_failed', itemsResult.error ?? fulfilmentsResult.error, 500)
    const itemIds = (itemsResult.data ?? []).map((item) => item.id)
    const linksResult = itemIds.length
      ? await supabase.from('order_fulfilment_items').select('fulfilment_id,item_id').in('item_id', itemIds)
      : { data: [], error: null }
    if (linksResult.error) return databaseFailure(response, 'customer.multi_service_details_failed', linksResult.error, 500)
    const fulfilmentByItem = new Map((linksResult.data ?? []).map((link) => [link.item_id, link.fulfilment_id]))
    const itemIdsByFulfilment = new Map<string, string[]>()
    for (const link of linksResult.data ?? []) {
      const linkedItems = itemIdsByFulfilment.get(link.fulfilment_id) ?? []
      linkedItems.push(link.item_id)
      itemIdsByFulfilment.set(link.fulfilment_id, linkedItems)
    }
    const itemsByBooking = new Map<string, unknown[]>()
    for (const item of itemsResult.data ?? []) {
      if (!item.legacy_booking_id) continue
      const bookingItems = itemsByBooking.get(item.legacy_booking_id) ?? []
      bookingItems.push({ ...item, fulfilment_id: fulfilmentByItem.get(item.id) ?? null })
      itemsByBooking.set(item.legacy_booking_id, bookingItems)
    }
    const fulfilmentsByBooking = new Map<string, unknown[]>()
    const orderIdByBooking = new Map<string, string>()
    for (const fulfilment of fulfilmentsResult.data ?? []) {
      if (!fulfilment.legacy_booking_id) continue
      const bookingFulfilments = fulfilmentsByBooking.get(fulfilment.legacy_booking_id) ?? []
      bookingFulfilments.push({
        ...fulfilment,
        item_ids: itemIdsByFulfilment.get(fulfilment.id) ?? [],
      })
      fulfilmentsByBooking.set(fulfilment.legacy_booking_id, bookingFulfilments)
      orderIdByBooking.set(fulfilment.legacy_booking_id, fulfilment.order_id)
    }
    response.json({
      rows: visibleRows.map((row) => ({
        ...row,
        order_id: orderIdByBooking.get(row.id) ?? null,
        items: itemsByBooking.get(row.id) ?? [],
        fulfilments: fulfilmentsByBooking.get(row.id) ?? [],
      })),
      nextOffset: rows.length > pageSize ? offset + pageSize : null,
    })
    return
  }
  response.json({ rows: visibleRows, nextOffset: rows.length > pageSize ? offset + pageSize : null })
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
    const { verified, error } = await consumeRecentPhoneVerification(contact.challengeId, phoneE164)
    if (error) return { status: 500, message: 'Phone verification could not be confirmed.' }
    if (!verified) return { status: 400, message: `Verify the contact number for ${contact.serviceId} before booking.` }
  }
  return null
}
function bookingInsert(data: z.infer<typeof bookingSchema>, services: ReturnType<typeof getBookingServices>, vendorId: string | null, quotedAmountPaise: number, invoiceLineItems?: InvoiceLineSnapshot[]) {
  const primaryService = services[0]
  if (!primaryService) throw new Error('At least one service is required')
  const capacityText = primaryService.capacity || (!data.services?.length ? data.capacity : '') || ''
  const capacityMatch = capacityText.match(/^([\d,]+)\s*(?:litres?|l)?$/i)
  const isTankerService = ['water_tanker', 'sewage_tanker'].includes(primaryService.serviceId)
  const serviceDetails = services.map((service, index) => {
    const persisted = { ...service }
    delete persisted.phoneVerificationChallengeId
    const invoiceLine = invoiceLineItems?.[index]
    return invoiceLine ? { ...persisted, invoice_line: invoiceLine } : persisted
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
type CreatedBooking = { id: string; reference: string; vendor_id: string | null; quoted_amount_paise?: number; payment_method?: string; order_group_id?: string | null; order_group_reference?: string | null; order_group_size?: number | null }
async function createBookingAndNotifications(input: {
  customerId: string
  reference: string
  idempotencyKey?: string
  booking: ReturnType<typeof bookingInsert>
  vendors: Awaited<ReturnType<typeof findNearbyVendors>>
  payment?: { provider: string; amount_paise: number; currency: string; status: string }
  sendTrackingConfirmation?: boolean
}): Promise<{ booking: CreatedBooking; created: boolean }> {
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
  const result = data as { booking: CreatedBooking; created: boolean }
  if (result?.booking?.id) notifyNearbyVendors(input.vendors, result.booking, result.created)
  const sendTrackingConfirmation = input.sendTrackingConfirmation
    ?? input.booking.payment_method !== 'gateway'
  if (result?.booking?.id && sendTrackingConfirmation) {
    void notifyCustomerOfBooking(input.booking.customer_phone_e164, result.booking.id, input.reference)
  }
  return result
}
async function createMultiServiceBookings(input: {
  customerId: string
  groupId: string
  groupReference: string
  idempotencyKey?: string
  services: ReturnType<typeof getBookingServices>
  data: z.infer<typeof bookingSchema>
  taskAmountsPaise: number[]
  invoiceLineItems?: InvoiceLineSnapshot[]
  vendors: Awaited<ReturnType<typeof findNearbyVendors>>
  payment?: { provider: string; amount_paise: number; currency: string; status: string }
}): Promise<{ booking: CreatedBooking; bookings: CreatedBooking[]; created: boolean }> {
  const bookings = input.services.map((service, index) => ({
    ...bookingInsert(
      input.data,
      [service],
      null,
      input.taskAmountsPaise[index]!,
      input.invoiceLineItems ? [input.invoiceLineItems[index]!] : undefined,
    ),
    reference: `${input.groupReference}-${String(index + 1).padStart(2, '0')}`,
    customer_id: input.customerId,
    idempotency_key: index === 0 ? input.idempotencyKey ?? null : null,
    order_group_id: input.groupId,
    order_group_reference: input.groupReference,
    order_group_size: input.services.length,
  }))
  const { data, error } = await supabase.rpc('create_customer_bookings', {
    p_bookings: bookings,
    p_notifications: vendorNotifications(input.vendors, { id: '', reference: input.groupReference, payment_method: input.data.paymentMethod }),
    p_payment: input.payment ?? null,
  })
  if (error) throw error
  const result = data as { bookings: CreatedBooking[]; created: boolean }
  if (!Array.isArray(result?.bookings) || !result.bookings.length) {
    throw new Error('The grouped booking response was invalid.')
  }
  for (const booking of result.bookings) notifyNearbyVendors(input.vendors, booking, result.created)
  const customerPhone = input.data.phone ? toE164IndianMobile(input.data.phone) : null
  if (input.data.paymentMethod !== 'gateway') {
    void notifyCustomerOfBooking(customerPhone, result.bookings[0]!.id, input.groupReference)
  }
  return { booking: result.bookings[0]!, bookings: result.bookings, created: result.created }
}
function quoteFailure(response: Response, error: unknown) {
  if (error instanceof PricingError) return response.status(400).json({ error: error.message })
  return failure(response, 500, 'Booking quote could not be calculated. Please try again.', 'customer.quote_failed', error)
}
// Checkouts created before bookings were written up front. Still settled here so in-flight requests finish.
const claimableCheckoutStatuses = ['awaiting_payment', 'order_created', 'failed']
export type CheckoutRow = {
  id: string
  customer_id: string
  booking_request: z.infer<typeof bookingSchema>
  quoted_amount_paise: number
  coupon_id: string | null
  status: string
  provider_order_id: string | null
  booking_id: string | null
}
type BookingSummary = { id: string; reference: string; vendor_id: string | null; quoted_amount_paise?: number; payment_method?: string }
export type SettleResult = { status: 'booked'; booking: BookingSummary; created: boolean } | { status: 'conflict' } | { status: 'coupon_used' }

async function loadCheckout(checkoutId: string) {
  const { data, error } = await supabase.from('booking_checkouts').select('*').eq('id', checkoutId).single()
  if (error || !data) throw error ?? new Error('Checkout not found')
  return data as CheckoutRow
}
async function bookingSummary(bookingId: string) {
  const { data, error } = await supabase.from('bookings').select('id,reference,vendor_id,quoted_amount_paise,payment_method').eq('id', bookingId).single()
  if (error || !data) throw error ?? new Error('Booking not found')
  return data as BookingSummary
}
async function createCheckoutBooking(checkout: CheckoutRow, method: 'gateway' | 'cod') {
  let redeemed = false
  if (checkout.coupon_id) {
    const { error } = await supabase.from('coupon_redemptions').insert({ coupon_id: checkout.coupon_id, customer_id: checkout.customer_id, redeemed_at: new Date().toISOString() })
    if (error?.code === '23505') {
      if (method === 'cod') return null
      // The customer has already paid, so the booking proceeds without a second redemption.
      logger.warn('customer.checkout_coupon_already_redeemed', { checkoutId: checkout.id })
    } else if (error) throw error
    else redeemed = true
  }
  const data = checkout.booking_request
  let result: { booking: CreatedBooking; created: boolean; bookings?: CreatedBooking[] }
  try {
    const services = getBookingServices(data)
    const manualAssignmentModeEnabled = await getManualAssignmentModeEnabled()
    const vendors = manualAssignmentModeEnabled
      ? []
      : await findNearbyVendors(data.latitude, data.longitude)
    if (config.featureFlags.multi_service_tasks_enabled && services.length > 1) {
      const weights = await quoteServices(services, undefined, checkout.customer_id, true)
      if (!weights.serviceAmountsPaise) throw new Error('Service prices could not be allocated.')
      const taskAmountsPaise = allocateServiceAmountsPaise(checkout.quoted_amount_paise, weights.serviceAmountsPaise)
      result = await createMultiServiceBookings({
        customerId: checkout.customer_id,
        groupId: crypto.randomUUID(),
        groupReference: bookingReference(),
        idempotencyKey: checkout.id,
        services,
        data: { ...data, paymentMethod: method },
        taskAmountsPaise,
        vendors,
        payment: method === 'cod' ? { provider: 'cash_on_delivery', amount_paise: checkout.quoted_amount_paise, currency: 'INR', status: 'pending' } : undefined,
      })
    } else {
      result = await createBookingAndNotifications({
        customerId: checkout.customer_id,
        reference: bookingReference(),
        idempotencyKey: checkout.id,
        booking: { ...bookingInsert(data, services, null, checkout.quoted_amount_paise), payment_method: method },
        vendors,
        payment: method === 'cod' ? { provider: 'cash_on_delivery', amount_paise: checkout.quoted_amount_paise, currency: 'INR', status: 'pending' } : undefined,
      })
    }
  } catch (error) {
    if (redeemed) await supabase.from('coupon_redemptions').delete().eq('coupon_id', checkout.coupon_id!).eq('customer_id', checkout.customer_id)
    throw error
  }
  const { error: linkError } = await supabase.from('booking_checkouts').update({ booking_id: result.booking.id, updated_at: new Date().toISOString() }).eq('id', checkout.id)
  if (linkError) throw linkError
  if (result.created) emitRealtimeToUser(checkout.customer_id, 'booking.created', result.booking)
  return { booking: result.booking as BookingSummary, created: result.created }
}
async function recordCheckoutPayment(bookingId: string, checkout: CheckoutRow, payment: Record<string, unknown>) {
  const { error } = await supabase.from('payments').insert({ booking_id: bookingId, provider: 'razorpay', provider_order_id: checkout.provider_order_id, amount_paise: checkout.quoted_amount_paise, currency: 'INR', ...payment })
  if (!error) return
  if (error.code !== '23505') throw error
  // A retry after a partial failure: the row already exists, so refresh it with the latest payment details.
  const { error: updateError } = await supabase.from('payments').update({ ...payment, updated_at: new Date().toISOString() }).eq('booking_id', bookingId)
  if (updateError) throw updateError
}
// Creates the booking for a checkout once payment is confirmed (gateway) or on the customer's cash choice (cod).
// Safe to call again for the same checkout: an already-booked checkout just re-links its payment row.
export async function settleBookingCheckout(checkout: CheckoutRow, method: 'gateway' | 'cod', payment: Record<string, unknown> | null = null): Promise<SettleResult> {
  let bookingId = checkout.booking_id
  let booking: BookingSummary | null = null
  let created = false
  if (!bookingId) {
    const { data: claimed, error: claimError } = await supabase.from('booking_checkouts').update({ status: method === 'gateway' ? 'booked' : 'cod', updated_at: new Date().toISOString() }).eq('id', checkout.id).in('status', claimableCheckoutStatuses).select('id').maybeSingle()
    if (claimError) throw claimError
    if (!claimed) {
      const latest = await loadCheckout(checkout.id)
      if (!latest.booking_id) return { status: 'conflict' }
      bookingId = latest.booking_id
    } else {
      let outcome: Awaited<ReturnType<typeof createCheckoutBooking>>
      try {
        outcome = await createCheckoutBooking(checkout, method)
      } catch (error) {
        await supabase.from('booking_checkouts').update({ status: checkout.status, updated_at: new Date().toISOString() }).eq('id', checkout.id)
        throw error
      }
      if (!outcome) {
        await supabase.from('booking_checkouts').update({ status: checkout.status, updated_at: new Date().toISOString() }).eq('id', checkout.id)
        return { status: 'coupon_used' }
      }
      booking = outcome.booking
      created = outcome.created
      bookingId = outcome.booking.id
    }
  }
  if (!bookingId) return { status: 'conflict' }
  if (method === 'gateway' && payment) await recordCheckoutPayment(bookingId, checkout, payment)
  if (method === 'gateway' && payment) {
    const { data: bookingContact, error: contactError } = await supabase
      .from('bookings')
      .select('id,reference,customer_phone_e164')
      .eq('id', bookingId)
      .maybeSingle()
    if (contactError) throw contactError
    if (bookingContact) {
      await notifyCustomerOfBooking(bookingContact.customer_phone_e164, bookingContact.id, bookingContact.reference)
    }
  }
  if (method === 'cod' && checkout.provider_order_id) {
    // A Razorpay order created before the customer switched to cash can still be captured, so the webhook must find this row.
    const { error } = await supabase.from('payments').update({ provider_order_id: checkout.provider_order_id }).eq('booking_id', bookingId)
    if (error) throw error
  }
  return { status: 'booked', booking: booking ?? await bookingSummary(bookingId), created }
}
// Returns the debit transaction id, or null when the wallet cannot cover the amount. The debit is written first, then the balance re-read, so concurrent debits cannot overspend.
export async function debitWalletForBooking(customerId: string, amountPaise: number): Promise<string | null> {
  const { data: debit, error } = await supabase.from('wallet_transactions').insert({ customer_id: customerId, type: 'debit', amount: amountPaise / 100, status: 'completed' }).select('id').single()
  if (error || !debit) throw error ?? new Error('Wallet debit could not be recorded')
  const { data: rows, error: balanceError } = await supabase.from('wallet_transactions').select('type,amount').eq('customer_id', customerId).eq('status', 'completed')
  if (balanceError) {
    await supabase.from('wallet_transactions').delete().eq('id', debit.id)
    throw balanceError
  }
  const balancePaise = (rows ?? []).reduce((sum, row) => sum + (row.type === 'credit' ? 1 : -1) * Math.round(Number(row.amount) * 100), 0)
  if (balancePaise < 0) {
    await supabase.from('wallet_transactions').delete().eq('id', debit.id)
    return null
  }
  return debit.id as string
}

async function requireAccountPhoneVerification(customerId: string, response: Response) {
  if (!isPhoneVerificationRequired()) return true
  const { data: profile, error } = await supabase
    .from('profiles')
    .select('phone_verified,phone_verified_at')
    .eq('id', customerId)
    .maybeSingle()
  if (error) {
    databaseFailure(response, 'customer.phone_verification_failed', error, 500)
    return false
  }
  if (!profile || !isPhoneVerified(profile)) {
    response.status(403).json({
      code: 'PHONE_NOT_VERIFIED',
      error: 'Verify your account phone number before placing an order.',
    })
    return false
  }
  return true
}

async function placeQuotedBooking(request: Request, response: Response, includeQuote: boolean) {
  const customerId = request.authUser!.id
  if (!(await requireAccountPhoneVerification(customerId, response))) return
  const parsed = bookingSchema.safeParse(request.body)
  if (!parsed.success) return response.status(400).json({ error: 'Invalid booking', details: parsed.error.flatten() })
  if (!parsed.data.paymentMethod) return response.status(400).json({ error: 'Choose a payment method: wallet, online payment, or cash on delivery.' })
  if (parsed.data.paymentMethod === 'wallet' && !config.featureFlags.wallet_enabled) return response.status(403).json({ error: 'Wallet is currently disabled. Choose another payment method.' })
  if (parsed.data.paymentMethod === 'gateway' && !config.featureFlags.online_payment_enabled) return response.status(503).json({ error: 'Online payments are currently unavailable. Please choose cash on delivery.' })
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
    const needsInvoiceSnapshot = config.featureFlags.invoice_generation_enabled
    quote = await quoteServices(
      services,
      parsed.data.couponCode,
      customerId,
      (config.featureFlags.multi_service_tasks_enabled && services.length > 1) || needsInvoiceSnapshot,
      needsInvoiceSnapshot,
    )
  } catch (error) {
    return quoteFailure(response, error)
  }
  const method = parsed.data.paymentMethod
  const splitServices = config.featureFlags.multi_service_tasks_enabled && services.length > 1
  const clientQuote = { ...quote }
  delete clientQuote.serviceAmountsPaise
  if (splitServices && !quote.serviceAmountsPaise) {
    return failure(response, 500, 'Service prices could not be allocated.', 'customer.booking_amount_allocation_failed')
  }
  if (method === 'wallet' && parsed.data.idempotencyKey) {
    // A retried wallet booking must not debit the wallet a second time.
    const { data: existing, error: existingError } = await supabase.from('bookings').select('id,reference,vendor_id,quoted_amount_paise,payment_method').eq('customer_id', customerId).eq('idempotency_key', parsed.data.idempotencyKey).maybeSingle()
    if (existingError) return databaseFailure(response, 'customer.booking_failed', existingError, 500)
    if (existing) {
      const group = splitServices
        ? await supabase.from('bookings').select('order_group_id,order_group_reference,order_group_size').eq('id', existing.id).maybeSingle()
        : null
      if (group?.error) return databaseFailure(response, 'customer.booking_failed', group.error, 500)
      const order = group?.data?.order_group_id
        ? await supabase.from('bookings').select('id,reference,service_code,service_details,address_text,quoted_amount_paise,status,scheduled_for,order_group_id,order_group_reference,order_group_size').eq('customer_id', customerId).eq('order_group_id', group.data.order_group_id).order('created_at')
        : null
      if (order?.error) return databaseFailure(response, 'customer.booking_failed', order.error, 500)
      const responseBody = order?.data?.length
        ? { ...existing, tasks: order.data, order_group_reference: group?.data?.order_group_reference, order_group_size: group?.data?.order_group_size }
        : existing
      return response.status(200).json(includeQuote ? { ...responseBody, quote: clientQuote } : responseBody)
    }
  }
  let debitId: string | null = null
  if (method === 'wallet') {
    try {
      debitId = await debitWalletForBooking(customerId, quote.totalPaise)
    } catch (error) {
      return databaseFailure(response, 'customer.wallet_debit_failed', error, 500, 'Booking could not be saved. Please try again.')
    }
    if (!debitId) return response.status(402).json({ error: 'Insufficient wallet balance. Add money to your wallet or choose another payment method.' })
  }
  const releaseHold = async (couponRedeemed: boolean) => {
    if (couponRedeemed && quote.couponId) await supabase.from('coupon_redemptions').delete().eq('coupon_id', quote.couponId).eq('customer_id', customerId)
    if (debitId) await supabase.from('wallet_transactions').delete().eq('id', debitId)
  }
  let couponRedemptionAt: string | null = null
  if (quote.couponId) {
    couponRedemptionAt = new Date().toISOString()
    const { error: redemptionError } = await supabase.from('coupon_redemptions').insert({ coupon_id: quote.couponId, customer_id: customerId, redeemed_at: couponRedemptionAt })
    if (redemptionError?.code === '23505') {
      await releaseHold(false)
      return response.status(409).json({ error: 'This coupon has already been used on this account.' })
    }
    if (redemptionError) {
      await releaseHold(false)
      return failure(response, 500, 'Booking could not be saved. Please try again.', 'customer.coupon_redemption_failed', redemptionError)
    }
  }
  try {
    const manualAssignmentModeEnabled = await getManualAssignmentModeEnabled()
    const vendors = manualAssignmentModeEnabled
      ? []
      : await findNearbyVendors(parsed.data.latitude, parsed.data.longitude)
    let result: { booking: CreatedBooking; created: boolean; bookings: CreatedBooking[] }
    if (splitServices) {
      result = await createMultiServiceBookings({
        customerId,
        groupId: crypto.randomUUID(),
        groupReference: bookingReference(),
        idempotencyKey: parsed.data.idempotencyKey,
        services,
        data: parsed.data,
        taskAmountsPaise: quote.invoiceLineItems
          ? quote.invoiceLineItems.map((item) => item.totalPaise)
          : quote.serviceAmountsPaise!,
        invoiceLineItems: quote.invoiceLineItems,
        vendors,
        payment: method === 'cod' ? { provider: 'cash_on_delivery', amount_paise: quote.totalPaise, currency: 'INR', status: 'pending' } : undefined,
      })
    } else {
      const singleBooking = await createBookingAndNotifications({
        customerId,
        reference: bookingReference(),
        idempotencyKey: parsed.data.idempotencyKey,
        booking: bookingInsert(
          parsed.data,
          services,
          null,
          quote.totalPaise,
          quote.invoiceLineItems,
        ),
        vendors,
        sendTrackingConfirmation: method !== 'gateway',
        payment: method === 'cod' ? { provider: 'cash_on_delivery', amount_paise: quote.totalPaise, currency: 'INR', status: 'pending' } : undefined,
      })
      result = { ...singleBooking, bookings: [] }
    }
    if (!result.created) {
      if (debitId) {
        const { error: debitCleanupError } = await supabase.from('wallet_transactions').delete().eq('id', debitId)
        if (debitCleanupError) return databaseFailure(response, 'customer.wallet_debit_failed', debitCleanupError, 500)
      }
      if (quote.couponId && couponRedemptionAt) {
        const { error: couponCleanupError } = await supabase.from('coupon_redemptions').delete()
          .eq('coupon_id', quote.couponId)
          .eq('customer_id', customerId)
          .eq('redeemed_at', couponRedemptionAt)
        if (couponCleanupError) return databaseFailure(response, 'customer.coupon_redemption_failed', couponCleanupError, 500)
      }
    }
    emitRealtimeToUser(customerId, 'booking.created', result.booking)
    const responseBody = result.bookings.length > 0
      ? { ...result.booking, tasks: result.bookings, order_group_reference: result.booking.reference.replace(/-\d{2}$/, ''), order_group_size: result.bookings.length }
      : result.booking
    return response.status(result.created ? 201 : 200).json(includeQuote ? { ...responseBody, quote: clientQuote } : responseBody)
  } catch (error) {
    await releaseHold(Boolean(quote.couponId))
    return databaseFailure(response, 'customer.booking_failed', error, 500, 'Booking could not be saved. Please try again.')
  }
}
router.post('/orders', async (request, response) => placeQuotedBooking(request, response, false))
router.post('/orders/quote', quoteLimit, async (request, response) => placeQuotedBooking(request, response, true))
router.post('/checkouts/:checkoutId/cash-on-delivery', async (request, response) => {
  const customerId = request.authUser!.id
  if (!(await requireAccountPhoneVerification(customerId, response))) return
  const { data: checkout, error } = await supabase.from('booking_checkouts').select('*').eq('id', request.params.checkoutId).eq('customer_id', customerId).maybeSingle()
  if (error) return databaseFailure(response, 'customer.checkout_failed', error, 500)
  if (!checkout) return response.status(404).json({ error: 'Checkout not found' })
  if (checkout.status === 'booked') return response.status(409).json({ error: 'This booking has already been paid.' })
  try {
    const result = await settleBookingCheckout(checkout as CheckoutRow, 'cod')
    if (result.status === 'coupon_used') return response.status(409).json({ error: 'This coupon has already been used on this account.' })
    if (result.status === 'conflict') return response.status(409).json({ error: 'This booking is already being processed. Refresh and try again.' })
    return response.status(result.created ? 201 : 200).json(result.booking)
  } catch (settleError) {
    return databaseFailure(response, 'customer.booking_failed', settleError, 500, 'Booking could not be saved. Please try again.')
  }
})

// Releases a coupon hold taken by a booking that is being removed. The redemption must sit within minutes of the booking's creation,
// so a customer cannot free a coupon they used on an earlier, paid booking.
async function releaseCouponForCancelledBooking(customerId: string, couponCode: string, bookingCreatedAt: string) {
  const { data: coupon } = await supabase.from('coupons').select('id').eq('code', couponCode.toUpperCase()).maybeSingle()
  if (!coupon) return
  const { data: redemption } = await supabase.from('coupon_redemptions').select('redeemed_at').eq('coupon_id', coupon.id).eq('customer_id', customerId).maybeSingle()
  if (!redemption) return
  if (Math.abs(Date.parse(redemption.redeemed_at) - Date.parse(bookingCreatedAt)) > 5 * 60 * 1000) return
  await supabase.from('coupon_redemptions').delete().eq('coupon_id', coupon.id).eq('customer_id', customerId)
}
// The customer closed Razorpay checkout without paying, so the unpaid online booking is removed. Paid bookings are never removed here.
router.post('/bookings/:bookingId/cancel-online-payment', async (request, response) => {
  const customerId = request.authUser!.id
  const parsed = z.object({ couponCode: z.string().max(80).optional() }).safeParse(request.body ?? {})
  if (!parsed.success) return response.status(400).json({ error: 'Invalid cancellation request' })
  const { data: booking, error } = await supabase.from('bookings').select('id,status,payment_method,created_at').eq('id', request.params.bookingId).eq('customer_id', customerId).maybeSingle()
  if (error) return databaseFailure(response, 'customer.booking_failed', error, 500)
  if (!booking) return response.status(404).json({ error: 'Booking not found' })
  if (config.featureFlags.multi_service_tasks_enabled) {
    const { data, error: cancelError } = await supabase.rpc('cancel_customer_unpaid_order', {
      p_booking_id: booking.id,
      p_customer_id: customerId,
    })
    if (cancelError) return databaseFailure(response, 'customer.booking_failed', cancelError, 500)
    const outcome = data as { deleted?: boolean; reason?: string } | null
    if (!outcome?.deleted) {
      if (outcome?.reason === 'not_found') return response.status(404).json({ error: 'Booking not found' })
      if (outcome?.reason === 'paid') return response.status(409).json({ error: 'This booking has already been paid.' })
      return response.status(409).json({ error: 'This booking has already been accepted and cannot be removed.' })
    }
    if (parsed.data.couponCode) await releaseCouponForCancelledBooking(customerId, parsed.data.couponCode, booking.created_at)
    return response.status(204).send()
  }
  if (booking.payment_method !== 'gateway') return response.status(409).json({ error: 'Only an online payment booking can be removed this way.' })
  if (!['pending_vendor', 'vendor_assigned'].includes(booking.status)) return response.status(409).json({ error: 'This booking has already been accepted and cannot be removed.' })
  const { data: payment, error: paymentError } = await supabase.from('payments').select('status').eq('booking_id', booking.id).maybeSingle()
  if (paymentError) return databaseFailure(response, 'customer.booking_failed', paymentError, 500)
  if (payment?.status === 'paid') return response.status(409).json({ error: 'This booking has already been paid.' })
  if (payment) {
    const { error: deletePaymentError } = await supabase.from('payments').delete().eq('booking_id', booking.id).neq('status', 'paid')
    if (deletePaymentError) return databaseFailure(response, 'customer.booking_failed', deletePaymentError, 500)
  }
  const { data: deleted, error: deleteError } = await supabase.from('bookings').delete().eq('id', booking.id).eq('customer_id', customerId).eq('payment_method', 'gateway').in('status', ['pending_vendor', 'vendor_assigned']).select('id').maybeSingle()
  if (deleteError) return databaseFailure(response, 'customer.booking_failed', deleteError, 500)
  if (!deleted) return response.status(409).json({ error: 'This booking has already been accepted and cannot be removed.' })
  if (parsed.data.couponCode) await releaseCouponForCancelledBooking(customerId, parsed.data.couponCode, booking.created_at)
  response.status(204).send()
})
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
  try {
    await generateMissingCustomerInvoices(request.authUser!.id)
  } catch (error) {
    return databaseFailure(response, 'customer.invoice_generation_failed', error, 500)
  }
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
router.get('/profile', async (request, response) => { const { data, error } = await supabase.from('profiles').select('full_name, phone_e164, phone_verified, phone_verified_at').eq('id', request.authUser!.id).single(); if (error) return databaseFailure(response, 'customer.database_error', error, 500); response.json({ name: data.full_name, email: request.authUser!.email ?? '', phone: String(data.phone_e164 ?? '').replace(/\D/g, '').slice(-10), phoneVerified: data.phone_verified === true || Boolean(data.phone_verified_at) }) })
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
    email: z.string().trim().toLowerCase().email(),
    phone: z.string().regex(/^\d{10}$/).optional(),
    phoneVerificationChallengeId: z.string().uuid().optional(),
    emailVerificationChallengeId: z.string().uuid().optional(),
  }).safeParse(request.body)
  if (!parsed.success) return response.status(400).json({ error: 'Invalid profile' })
  const userId = request.authUser!.id
  const { data: authAccount, error: authLookupError } = await supabase.auth.admin.getUserById(userId)
  if (authLookupError || !authAccount.user) return response.status(500).json({ error: 'The current account could not be checked.' })
  const currentEmail = authAccount.user.email ?? request.authUser!.email
  const emailChanged = currentEmail !== undefined && currentEmail !== parsed.data.email
  const profileUpdate: Record<string, unknown> = { full_name: parsed.data.name }
  let phoneChange: { phone: string; hadExistingPhone: boolean } | null = null
  if (parsed.data.phone !== undefined) {
    const phoneE164 = toE164IndianMobile(parsed.data.phone)
    if (!phoneE164) return response.status(400).json({ error: 'Enter a valid 10-digit mobile number.' })
    const { data: current, error: currentError } = await supabase.from('profiles').select('phone_e164').eq('id', userId).maybeSingle()
    if (currentError) return databaseFailure(response, 'customer.profile_lookup_failed', currentError, 500)
    if (toE164IndianMobile(String(current?.phone_e164 ?? '')) !== phoneE164) {
      const { verified, error } = await consumeRecentPhoneVerification(parsed.data.phoneVerificationChallengeId, phoneE164)
      if (error) return databaseFailure(response, 'customer.phone_verification_failed', error, 500)
      if (!verified) return response.status(400).json({ error: 'Verify the new mobile number before changing it.' })
      profileUpdate.phone_e164 = phoneE164
      profileUpdate.phone_verified = true
      profileUpdate.phone_verified_at = new Date().toISOString()
      phoneChange = { phone: phoneE164, hadExistingPhone: Boolean(current?.phone_e164) }
    }
  }
  if (emailChanged) {
    if (!parsed.data.emailVerificationChallengeId) return response.status(400).json({ error: 'Verify the new email address before saving.' })
    const { data: emailChallenge, error: emailChallengeError } = await supabase
      .from('email_otp_challenges')
      .delete()
      .eq('id', parsed.data.emailVerificationChallengeId)
      .eq('email', parsed.data.email)
      .eq('purpose', 'link')
      .eq('user_id', userId)
      .not('verified_at', 'is', null)
      .gt('expires_at', new Date().toISOString())
      .select('id')
      .maybeSingle()
    if (emailChallengeError) return databaseFailure(response, 'customer.email_verification_failed', emailChallengeError, 500)
    if (!emailChallenge) return response.status(400).json({ error: 'Verify the new email address before saving.' })
    const { error } = await supabase.auth.admin.updateUserById(userId, { email: parsed.data.email, email_confirm: true })
    if (error) return failure(response, 400, 'This email address cannot be used.', 'customer.email_update_failed', error)
  }
  const { data, error } = await supabase.from('profiles').update(profileUpdate).eq('id', userId).select().single()
  if (error) return databaseFailure(response, 'customer.profile_update_failed', error, 400)
  if (config.PHONE_VERIFY_DIALOG_ENABLED && phoneChange) {
    logPhoneVerificationAudit({
      action: 'number_change',
      userId,
      phone: phoneChange.phone,
      ip: request.ip,
      details: { hadExistingPhone: phoneChange.hadExistingPhone },
    })
  }
  response.json({ name: data.full_name, email: emailChanged ? parsed.data.email : (currentEmail ?? parsed.data.email), phone: String(data.phone_e164 ?? '').replace(/\D/g, '').slice(-10), phoneVerified: data.phone_verified === true || Boolean(data.phone_verified_at) })
})
export default router
