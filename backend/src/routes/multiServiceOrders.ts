import crypto from 'node:crypto'
import { Router } from 'express'
import { z } from 'zod'
import { config } from '../config.js'
import { failure, databaseFailure } from '../lib/httpErrors.js'
import { logger } from '../lib/logger.js'
import express from 'express'
import { requireAuth, requireRole } from '../middleware/auth.js'
import { supabase } from '../supabase.js'
import { emitRealtimeToUser, emitRealtimeToVendor } from '../services/realtime.js'
import { sendPushNotification } from '../services/pushNotifications.js'
import { sendTemplateSms } from '../services/sms.js'
import { hashOtp } from '../services/otp.js'
import { quoteServices } from '../services/pricing.js'
import { allocateServiceAmountsPaise } from '../services/pricingMath.js'
import { getManualAssignmentModeEnabled } from '../services/manualAssignmentMode.js'
import { isPhoneVerificationRequired, isPhoneVerified } from '../services/phoneVerification.js'
import { createInvoiceIfEligible } from '../services/invoices.js'
import { debitWalletForBooking } from './customer.js'
import { vendorAccrualPaise } from '../services/pricingMath.js'

const customer = Router()
const vendor = Router()
const admin = Router()
const appVersionSchema = /^\d+\.\d+\.\d+$/

function compareVersion(first: string, second: string) {
  const left = first.split('.').map(Number)
  const right = second.split('.').map(Number)
  for (let index = 0; index < 3; index += 1) {
    if (left[index]! !== right[index]!) return left[index]! - right[index]!
  }
  return 0
}

async function recordFulfilmentLedger(fulfilmentId: string) {
  const { data: fulfilment, error: fulfilmentError } = await supabase.from('order_fulfilments')
    .select('id,order_id,vendor_id,status').eq('id', fulfilmentId).maybeSingle()
  if (fulfilmentError) throw fulfilmentError
  if (!fulfilment || fulfilment.status !== 'delivered' || !fulfilment.vendor_id) return false
  const { data: links, error: linksError } = await supabase.from('order_fulfilment_items').select('item_id').eq('fulfilment_id', fulfilment.id)
  if (linksError) throw linksError
  const itemIds = (links ?? []).map((link) => link.item_id)
  const { data: items, error: itemsError } = await supabase.from('order_items')
    .select('locked_price_paise,delivery_charge_paise,discount_paise').in('id', itemIds)
  if (itemsError) throw itemsError
  const grossPaise = (items ?? []).reduce((total, item) => total + Number(item.locked_price_paise) + Number(item.delivery_charge_paise) - Number(item.discount_paise), 0)
  if (!Number.isSafeInteger(grossPaise) || grossPaise < 0) throw new Error('Fulfilment accounting amount is invalid.')
  const payoutPaise = vendorAccrualPaise(grossPaise)
  const { error } = await supabase.from('order_fulfilment_ledger').upsert({
    fulfilment_id: fulfilment.id, order_id: fulfilment.order_id, vendor_id: fulfilment.vendor_id,
    gross_paise: grossPaise, commission_paise: grossPaise - payoutPaise, payout_paise: payoutPaise,
  }, { onConflict: 'fulfilment_id', ignoreDuplicates: true })
  if (error) throw error
  return true
}

function requireFeature(response: import('express').Response) {
  if (config.MULTI_SERVICE_ORDERS_ENABLED) return true
  response.status(404).json({ error: 'Multi-service orders are not enabled.' })
  return false
}

function requireSupportedAppVersion(request: import('express').Request, response: import('express').Response) {
  const version = request.get('x-app-version')
  if (!version) return true
  if (!appVersionSchema.test(version) || compareVersion(version, config.MULTI_SERVICE_MIN_APP_VERSION) < 0) {
    response.status(426).json({
      code: 'APP_UPDATE_REQUIRED',
      minAppVersion: config.MULTI_SERVICE_MIN_APP_VERSION,
      message: `Update Urban Tanker to version ${config.MULTI_SERVICE_MIN_APP_VERSION} or later to use multi-service orders.`,
    })
    return false
  }
  return true
}

function asIsoSlot(date: string, slot?: string) {
  return slot ? new Date(`${date}T${slot}:00+05:30`).toISOString() : new Date(`${date}T10:00:00+05:30`).toISOString()
}

type RequestItem = {
  serviceId: string
  quantity: number
  quantityUnit?: string
  location: string
  deliveryDate: string
  slot?: string
  latitude?: number
  longitude?: number
  details?: Record<string, unknown>
  capacity?: string
  waterType?: string
  serviceType?: string
}

const createOrderSchema = z.object({
  idempotencyKey: z.string().uuid().optional(),
  paymentMethod: z.enum(['wallet', 'gateway', 'cod']),
  couponCode: z.string().trim().max(80).optional(),
  phone: z.string().regex(/^\d{10}$/).optional(),
  phoneVerificationChallengeId: z.string().uuid().optional(),
  items: z.array(z.object({
    serviceId: z.string().trim().min(1).max(80),
    quantity: z.number().int().positive().max(50).default(1),
    quantityUnit: z.string().trim().min(1).max(30).optional(),
    location: z.string().trim().min(3).max(200),
    deliveryDate: z.string().date(),
    slot: z.string().regex(/^\d{2}:\d{2}$/).optional(),
    latitude: z.number().finite().min(-90).max(90).optional(),
    longitude: z.number().finite().min(-180).max(180).optional(),
    details: z.record(z.string(), z.unknown()).default({}),
    capacity: z.string().max(30).optional(),
    waterType: z.string().max(40).optional(),
    serviceType: z.string().max(80).optional(),
    quantityText: z.string().max(30).optional(),
  }).refine((item) => (item.latitude === undefined) === (item.longitude === undefined), 'Provide both coordinates or neither'))
    .min(1).max(config.MULTI_SERVICE_MAX_SERVICES),
})

async function customerHasAccountPhone(customerId: string, response: import('express').Response) {
  if (!isPhoneVerificationRequired()) return true
  const { data: profile, error } = await supabase.from('profiles').select('phone_verified,phone_verified_at').eq('id', customerId).maybeSingle()
  if (error) {
    databaseFailure(response, 'multi_service.phone_verification_failed', error, 500)
    return false
  }
  if (!profile || !isPhoneVerified(profile)) {
    response.status(403).json({ code: 'PHONE_NOT_VERIFIED', error: 'Verify your account phone number before placing an order.' })
    return false
  }
  return true
}

async function verifyBookingContact(customerId: string, phone: string | undefined, challengeId: string | undefined) {
  if (!config.REQUIRE_BOOKING_PHONE_VERIFICATION) {
    const { data, error } = await supabase.from('profiles').select('phone_e164').eq('id', customerId).maybeSingle()
    if (error) throw error
    const accountPhone = String(data?.phone_e164 ?? '').replace(/\D/g, '').slice(-10)
    if (!/^\d{10}$/.test(accountPhone)) return { error: 'Add a mobile number to your account before booking.' }
    return { phone: `+91${accountPhone}` }
  }
  if (!phone || !challengeId) return { error: 'Verify the booking contact number before placing this order.' }
  const { data, error } = await supabase.from('guest_otp_challenges')
    .update({ consumed_at: new Date().toISOString() })
    .eq('id', challengeId).eq('phone_e164', `+91${phone}`).eq('template_key', 'booking_verification_otp')
    .is('user_id', null).is('consumed_at', null).not('verified_at', 'is', null)
    .gte('verified_at', new Date(Date.now() - 15 * 60 * 1000).toISOString())
    .gt('expires_at', new Date().toISOString()).select('id').maybeSingle()
  if (error) throw error
  return data ? { phone: `+91${phone}` } : { error: 'Verify the booking contact number before placing this order.' }
}

function createReference() {
  return `UT-${crypto.randomBytes(5).toString('hex').toUpperCase()}`
}

type CandidateVendor = {
  id: string
  owner_profile_id: string | null
  latitude: number | null
  longitude: number | null
}

function geoDistanceKm(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }) {
  const radians = (value: number) => value * Math.PI / 180
  const dLat = radians(b.latitude - a.latitude)
  const dLon = radians(b.longitude - a.longitude)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(radians(a.latitude)) * Math.cos(radians(b.latitude)) * Math.sin(dLon / 2) ** 2
  return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h))
}

async function dispatchOrder(orderId: string, items: Array<{ id: string; service_type_id: string; latitude: number | null; longitude: number | null }>) {
  if (await getManualAssignmentModeEnabled()) return
  const { data: vendors, error: vendorsError } = await supabase.from('vendors')
    .select('id,owner_profile_id,latitude,longitude').eq('is_online', true).eq('verification', 'approved')
  if (vendorsError) throw vendorsError
  const vendorRows = (vendors ?? []) as CandidateVendor[]
  const { data: capabilities, error: capabilitiesError } = await supabase.from('vendor_services')
    .select('vendor_id,service_type_id').eq('active', true)
  if (capabilitiesError) throw capabilitiesError
  const supported = new Map<string, Set<string>>()
  for (const row of capabilities ?? []) {
    const services = supported.get(row.vendor_id) ?? new Set<string>()
    services.add(row.service_type_id)
    supported.set(row.vendor_id, services)
  }
  const ids = items.map((item) => item.id)
  const now = Date.now()
  const expiresAt = new Date(now + Math.max(60, config.BUNDLE_PRIORITY_SECONDS) * 1000).toISOString()
  const bundlePriorityAt = new Date(now + config.BUNDLE_PRIORITY_SECONDS * 1000).toISOString()
  const bundles = vendorRows.filter((candidate) => {
    const services = supported.get(candidate.id) ?? new Set<string>()
    return items.every((item) => {
      if (!services.has(item.service_type_id)) return false
      if (candidate.latitude === null || candidate.longitude === null || item.latitude === null || item.longitude === null) return true
      return geoDistanceKm(
        { latitude: Number(candidate.latitude), longitude: Number(candidate.longitude) },
        { latitude: Number(item.latitude), longitude: Number(item.longitude) },
      ) <= 50
    })
  })
  const bundleInserts = bundles.map((candidate) => ({
    order_id: orderId,
    vendor_id: candidate.id,
    offer_scope_id: orderId,
    item_ids: ids,
    is_bundle: true,
    status: 'offered',
    expires_at: new Date(now + Math.max(60, config.BUNDLE_PRIORITY_SECONDS) * 1000).toISOString(),
    bundle_priority_at: bundlePriorityAt,
    availability_snapshot: { online: true, approved: true, serviceTypeIds: [...(supported.get(candidate.id) ?? [])] },
  }))
  const singleInserts: Array<Record<string, unknown>> = []
  for (const item of items) {
    const eligible = vendorRows.filter((candidate) => {
      if (!supported.get(candidate.id)?.has(item.service_type_id)) return false
      if (candidate.latitude === null || candidate.longitude === null || item.latitude === null || item.longitude === null) return true
      return geoDistanceKm(
        { latitude: Number(candidate.latitude), longitude: Number(candidate.longitude) },
        { latitude: Number(item.latitude), longitude: Number(item.longitude) },
      ) <= 50
    })
    for (const candidate of eligible) {
      singleInserts.push({
        order_id: orderId,
        vendor_id: candidate.id,
        offer_scope_id: item.id,
        fulfilment_id: item.id,
        item_ids: [item.id],
        is_bundle: false,
        status: 'offered',
        expires_at: expiresAt,
        bundle_priority_at: bundlePriorityAt,
        availability_snapshot: { online: true, approved: true, serviceTypeId: item.service_type_id },
        distance_km: candidate.latitude !== null && candidate.longitude !== null && item.latitude !== null && item.longitude !== null
          ? Math.round(geoDistanceKm({ latitude: Number(candidate.latitude), longitude: Number(candidate.longitude) }, { latitude: Number(item.latitude), longitude: Number(item.longitude) }) * 100) / 100
          : null,
      })
    }
  }
  const requestedOffers = [...bundleInserts, ...singleInserts]
  if (!requestedOffers.length) return
  const { data: previousOffers, error: previousOfferError } = await supabase.from('order_offers')
    .select('vendor_id,is_bundle,offer_scope_id,status,expires_at').eq('order_id', orderId)
  if (previousOfferError) throw previousOfferError
  const existingByKey = new Map((previousOffers ?? []).map((offer) => [
    `${offer.vendor_id}:${offer.is_bundle}:${offer.offer_scope_id}`,
    offer,
  ]))
  const offers = requestedOffers.filter((offer) => {
    const existing = existingByKey.get(`${offer.vendor_id}:${offer.is_bundle}:${offer.offer_scope_id}`)
    if (!existing) return true
    if (existing.status === 'accepted') return false
    return existing.status === 'expired' || existing.status === 'cancelled'
  })
  if (!offers.length) return
  const { data: createdOffers, error } = await supabase.from('order_offers')
    .upsert(offers, { onConflict: 'order_id,vendor_id,is_bundle,offer_scope_id' })
    .select('id,vendor_id,is_bundle,fulfilment_id')
  if (error) throw error
  const notifications = new Map<string, Array<{ offerId: string; isBundle: boolean }>>()
  for (const offer of createdOffers ?? []) {
    const list = notifications.get(offer.vendor_id) ?? []
    list.push({ offerId: offer.id, isBundle: offer.is_bundle })
    notifications.set(offer.vendor_id, list)
  }
  for (const [vendorId, vendorOffers] of notifications) {
    const candidate = vendorRows.find((row) => row.id === vendorId)
    if (!candidate?.owner_profile_id) continue
    const { error: notificationError } = await supabase.from('notifications').insert(vendorOffers.map((offer) => ({
      recipient_id: candidate.owner_profile_id,
      event_type: 'multi_service.order_offer',
      title: offer.isBundle ? 'New bundle delivery offer' : 'New service delivery offer',
      payload: { orderId, offerId: offer.offerId, bundle: offer.isBundle },
    })))
    if (notificationError) logger.warn('multi_service.offer_notification_failed', { orderId, vendorId, error: notificationError.message })
    emitRealtimeToVendor(vendorId, 'multi_service.offer.created', { orderId, offers: vendorOffers })
    void sendPushNotification({
      recipientId: candidate.owner_profile_id,
      title: 'New delivery request',
      body: vendorOffers.some((offer) => offer.isBundle) ? 'A multi-service bundle is ready for review.' : 'A service request is ready for review.',
      data: { eventType: 'multi_service.order_offer', orderId },
    }).catch((error) => logger.warn('multi_service.offer_push_failed', { orderId, vendorId, error: error instanceof Error ? error.message : 'Unknown error' }))
  }
}

async function loadCustomerOrder(orderId: string, customerId: string) {
  const { data: order, error } = await supabase.from('orders').select('*').eq('id', orderId).eq('customer_id', customerId).maybeSingle()
  if (error || !order) return { order: null, error }
  const [items, fulfilments] = await Promise.all([
    supabase.from('order_items').select('*,service_types(code,name,quantity_unit)').eq('order_id', orderId).order('created_at'),
    supabase.from('order_fulfilments').select('id,reference,status,vendor_id,latitude,longitude,delivered_at,created_at').eq('order_id', orderId).order('created_at'),
  ])
  if (items.error || fulfilments.error) return { order: null, error: items.error ?? fulfilments.error }
  const itemIds = (items.data ?? []).map((item) => item.id)
  const links = itemIds.length
    ? await supabase.from('order_fulfilment_items').select('fulfilment_id,item_id').in('item_id', itemIds)
    : { data: [], error: null }
  if (links.error) return { order: null, error: links.error }
  const fulfilmentByItem = new Map((links.data ?? []).map((link) => [link.item_id, link.fulfilment_id]))
  const itemIdsByFulfilment = new Map<string, string[]>()
  for (const link of links.data ?? []) {
    const itemIds = itemIdsByFulfilment.get(link.fulfilment_id) ?? []
    itemIds.push(link.item_id)
    itemIdsByFulfilment.set(link.fulfilment_id, itemIds)
  }
  return {
    order: {
      ...order,
      items: (items.data ?? []).map((item) => ({ ...item, fulfilment_id: fulfilmentByItem.get(item.id) ?? null })),
      fulfilments: (fulfilments.data ?? []).map((fulfilment) => ({
        ...fulfilment,
        item_ids: itemIdsByFulfilment.get(fulfilment.id) ?? [],
      })),
    },
    error: null,
  }
}

async function emitParentOrderUpdate(orderId: string) {
  const { data, error } = await supabase.from('orders').select('customer_id,status').eq('id', orderId).maybeSingle()
  if (error) {
    logger.warn('multi_service.realtime_order_lookup_failed', { orderId, error: error.message })
    return
  }
  if (data?.customer_id) emitRealtimeToUser(data.customer_id, 'multi_service.order.updated', { orderId, status: data.status })
}

const legacyRouterAuth = (request: express.Request, response: express.Response, next: express.NextFunction) => config.featureFlags.AUTH_MOUNT_ONCE ? next() : requireAuth(request, response, next)
customer.use(legacyRouterAuth, requireRole('customer'))
customer.get('/service-types', async (request, response) => {
  if (!requireFeature(response) || !requireSupportedAppVersion(request, response)) return
  const { data, error } = await supabase.from('service_types').select('id,code,name,active,min_quantity,max_quantity,quantity_unit').eq('active', true).order('name')
  if (error) return databaseFailure(response, 'multi_service.service_types_failed', error, 500)
  response.json({
    rows: (data ?? []).map((service) => ({ ...service, unit: service.quantity_unit })),
    maxServices: config.MULTI_SERVICE_MAX_SERVICES,
    minAppVersion: config.MULTI_SERVICE_MIN_APP_VERSION,
  })
})

customer.get('/multi-service-orders', async (request, response) => {
  if (!requireFeature(response) || !requireSupportedAppVersion(request, response)) return
  const { data, error } = await supabase.from('orders')
    .select('*,order_items(*,service_types(code,name,quantity_unit)),order_fulfilments(id,reference,status,vendor_id,latitude,longitude,delivered_at,created_at,order_fulfilment_items(item_id))')
    .eq('customer_id', request.authUser!.id).order('created_at', { ascending: false }).limit(100)
  if (error) return databaseFailure(response, 'multi_service.order_list_failed', error, 500)
  response.json({ rows: data ?? [], nextOffset: null })
})

customer.post('/multi-service-orders', async (request, response) => {
  if (!requireFeature(response) || !requireSupportedAppVersion(request, response)) return
  const customerId = request.authUser!.id
  if (!(await customerHasAccountPhone(customerId, response))) return
  const parsed = createOrderSchema.safeParse(request.body)
  if (!parsed.success) return response.status(400).json({ error: 'Invalid multi-service order.', details: parsed.error.flatten() })
  if (parsed.data.paymentMethod === 'wallet' && !config.featureFlags.wallet_enabled) return response.status(403).json({ error: 'Wallet is currently disabled. Choose another payment method.' })
  if (parsed.data.paymentMethod === 'gateway' && !config.featureFlags.online_payment_enabled) return response.status(503).json({ error: 'Online payments are currently unavailable. Please choose cash on delivery.' })
  if (parsed.data.idempotencyKey) {
    const { data: previous, error: previousError } = await supabase.from('orders').select('id,legacy_booking_id')
      .eq('customer_id', customerId).eq('idempotency_key', parsed.data.idempotencyKey).maybeSingle()
    if (previousError) return databaseFailure(response, 'multi_service.order_lookup_failed', previousError, 500)
    if (previous) {
      const { order, error } = await loadCustomerOrder(previous.id, customerId)
      if (error) return databaseFailure(response, 'multi_service.order_load_failed', error, 500)
      return response.status(200).json({ ...order, legacyBookingId: previous.legacy_booking_id })
    }
  }
  const contact = await verifyBookingContact(customerId, parsed.data.phone, parsed.data.phoneVerificationChallengeId)
  if (contact.error) return response.status(400).json({ error: contact.error })
  const { data: services, error: serviceError } = await supabase.from('service_types')
    .select('id,code,name,min_quantity,max_quantity,quantity_unit,active')
    .in('code', parsed.data.items.map((item) => item.serviceId)).eq('active', true)
  if (serviceError) return databaseFailure(response, 'multi_service.services_lookup_failed', serviceError, 500)
  const serviceMap = new Map((services ?? []).map((service) => [service.code, service]))
  if (serviceMap.size !== new Set(parsed.data.items.map((item) => item.serviceId)).size) return response.status(400).json({ error: 'One or more selected services are unavailable.' })
  for (const item of parsed.data.items) {
    const service = serviceMap.get(item.serviceId)!
    if (item.quantity < Number(service.min_quantity) || item.quantity > Number(service.max_quantity)) {
      return response.status(400).json({ error: `Quantity for ${service.name} must be between ${service.min_quantity} and ${service.max_quantity}.` })
    }
  }
  const items = parsed.data.items as RequestItem[]
  let quote
  try {
    quote = await quoteServices(items.map((item) => ({
      serviceId: item.serviceId,
      quantity: String(item.quantity),
      tankerCount: String(item.quantity),
      capacity: item.capacity,
      waterType: item.waterType,
      serviceType: item.serviceType,
    })), parsed.data.couponCode, customerId, true, true)
  } catch (error) {
    return failure(response, 400, error instanceof Error ? error.message : 'Pricing could not be calculated.', 'multi_service.quote_failed', error)
  }
  if (!quote.serviceAmountsPaise) return failure(response, 500, 'Service prices could not be allocated.', 'multi_service.pricing_allocation_failed')
  const servicePrices = quote.invoiceLineItems?.map((line) => line.totalPaise) ?? quote.serviceAmountsPaise
  const deliveryCharges = items.map((_, index) => config.FULFILMENT_DELIVERY_CHARGE_PAISE
    + Math.max(0, config.FULFILMENT_MINIMUM_CHARGE_PAISE - servicePrices[index]!))
  const bundleDiscount = items.length > 1 ? Math.min(config.BUNDLE_DISCOUNT_PAISE, servicePrices.reduce((sum, amount) => sum + amount, 0) + deliveryCharges.reduce((sum, amount) => sum + amount, 0)) : 0
  const discountByItem = bundleDiscount > 0
    ? allocateServiceAmountsPaise(bundleDiscount, servicePrices.map((amount, index) => amount + deliveryCharges[index]!))
    : items.map(() => 0)
  const totalPaise = servicePrices.reduce((sum, amount) => sum + amount, 0)
    + deliveryCharges.reduce((sum, amount) => sum + amount, 0) - bundleDiscount
  if (!Number.isSafeInteger(totalPaise) || totalPaise < 0) return response.status(400).json({ error: 'The total order price is invalid.' })

  const itemRows = items.map((item, index) => ({
    service_code: item.serviceId,
    quantity: item.quantity,
    quantity_unit: item.quantityUnit ?? serviceMap.get(item.serviceId)?.quantity_unit ?? 'service',
    location: item.location,
    latitude: item.latitude ?? null,
    longitude: item.longitude ?? null,
    scheduled_for: asIsoSlot(item.deliveryDate, item.slot),
    slot: item.slot ?? null,
    service_details: item.details ?? {},
    locked_price_paise: servicePrices[index]!,
    delivery_charge_paise: deliveryCharges[index]!,
    discount_paise: discountByItem[index]!,
  }))
  const reference = createReference()
  const paymentInput = {
    provider: parsed.data.paymentMethod === 'cod' ? 'cash_on_delivery' : parsed.data.paymentMethod === 'wallet' ? 'wallet' : 'razorpay',
    status: parsed.data.paymentMethod === 'wallet' ? 'paid' : 'pending',
  }
  let walletDebitId: string | null = null
  if (parsed.data.paymentMethod === 'wallet') {
    try { walletDebitId = await debitWalletForBooking(customerId, totalPaise) }
    catch (error) { return databaseFailure(response, 'multi_service.wallet_debit_failed', error, 500) }
    if (!walletDebitId) return response.status(402).json({ error: 'Insufficient wallet balance.' })
  }
  if (quote.couponId) {
    const { error: redemptionError } = await supabase.from('coupon_redemptions').insert({
      coupon_id: quote.couponId,
      customer_id: customerId,
      redeemed_at: new Date().toISOString(),
    })
    if (redemptionError) {
      if (walletDebitId) await supabase.from('wallet_transactions').delete().eq('id', walletDebitId)
      if (redemptionError.code === '23505') return response.status(409).json({ error: 'This coupon has already been used on this account.' })
      return databaseFailure(response, 'multi_service.coupon_redemption_failed', redemptionError, 500)
    }
  }
  const { data: created, error: createError } = await supabase.rpc('create_multi_service_order', {
    p_order: {
      customer_id: customerId,
      reference,
      idempotency_key: parsed.data.idempotencyKey ?? null,
      payment_method: parsed.data.paymentMethod,
      total_paise: totalPaise,
      customer_phone_e164: contact.phone,
      location: items[0]!.location,
      legacy_service_details: items.map((item, index) => ({
        serviceId: item.serviceId,
        quantity: item.quantity,
        location: item.location,
        deliveryDate: item.deliveryDate,
        preferredTime: item.slot,
        invoice_line: quote.invoiceLineItems?.[index],
      })),
    },
    p_items: itemRows,
    p_payment: paymentInput,
  })
  if (createError) {
    if (quote.couponId) await supabase.from('coupon_redemptions').delete().eq('coupon_id', quote.couponId).eq('customer_id', customerId)
    if (walletDebitId) await supabase.from('wallet_transactions').delete().eq('id', walletDebitId)
    return databaseFailure(response, 'multi_service.order_create_failed', createError, 400)
  }
  const result = created as { created: boolean; order: { id: string }; legacyBookingId: string }
  if (!result.created && walletDebitId) await supabase.from('wallet_transactions').delete().eq('id', walletDebitId)
  if (!result?.order?.id) return failure(response, 500, 'Order could not be created.', 'multi_service.order_create_invalid_response')
  const { data: normalizedItems, error: itemLoadError } = await supabase.from('order_items')
    .select('id,service_type_id,latitude,longitude,status').eq('order_id', result.order.id)
  if (itemLoadError) return databaseFailure(response, 'multi_service.order_items_load_failed', itemLoadError, 500)
  if (result.created) {
    try {
      await dispatchOrder(result.order.id, normalizedItems ?? [])
    } catch (dispatchError) {
      logger.error('multi_service.dispatch_failed', { orderId: result.order.id, error: dispatchError instanceof Error ? dispatchError.message : String(dispatchError) })
    }
  }
  const normalized = await loadCustomerOrder(result.order.id, customerId)
  if (normalized.error) return databaseFailure(response, 'multi_service.order_load_failed', normalized.error, 500)
  emitRealtimeToUser(customerId, 'multi_service.order.created', normalized.order)
  response.status(result.created ? 201 : 200).json({
    ...normalized.order,
    legacyBookingId: result.legacyBookingId,
    quote: { subtotalPaise: quote.subtotalPaise, gstPaise: quote.gstPaise, couponDiscountPaise: quote.discountPaise, bundleDiscountPaise: bundleDiscount, deliveryChargesPaise: deliveryCharges.reduce((sum, amount) => sum + amount, 0), totalPaise },
  })
})

customer.get('/orders/:orderId', async (request, response) => {
  if (!requireFeature(response) || !requireSupportedAppVersion(request, response)) return
  const { order, error } = await loadCustomerOrder(request.params.orderId!, request.authUser!.id)
  if (error) return databaseFailure(response, 'multi_service.order_load_failed', error, 500)
  if (!order) return response.status(404).json({ error: 'Order not found.' })
  response.json(order)
})

customer.post('/multi-service-orders/:orderId/cancel-online-payment', async (request, response) => {
  if (!requireFeature(response) || !requireSupportedAppVersion(request, response)) return
  const parsed = z.object({ couponCode: z.string().trim().max(80).optional() }).safeParse(request.body ?? {})
  if (!parsed.success) return response.status(400).json({ error: 'Invalid cancellation request.' })
  const customerId = request.authUser!.id
  const { data, error } = await supabase.rpc('cancel_multi_service_unpaid_order', {
    p_order_id: request.params.orderId,
    p_customer_id: customerId,
  })
  if (error) return databaseFailure(response, 'multi_service.payment_cancel_failed', error, 500)
  const outcome = data as { cancelled?: boolean; reason?: string; createdAt?: string }
  if (!outcome.cancelled) {
    if (outcome.reason === 'not_found') return response.status(404).json({ error: 'Order not found.' })
    if (outcome.reason === 'paid') return response.status(409).json({ error: 'This order has already been paid.' })
    if (outcome.reason === 'not_gateway') return response.status(409).json({ error: 'Only an online-payment order can be removed this way.' })
    return response.status(409).json({ error: 'This order has already been accepted and cannot be removed.' })
  }
  if (parsed.data.couponCode) {
    const { data: coupon } = await supabase.from('coupons').select('id').eq('code', parsed.data.couponCode.toUpperCase()).maybeSingle()
    if (coupon) {
      const { data: redemption } = await supabase.from('coupon_redemptions').select('redeemed_at')
        .eq('coupon_id', coupon.id).eq('customer_id', customerId).maybeSingle()
      if (redemption && outcome.createdAt && Math.abs(Date.parse(redemption.redeemed_at) - Date.parse(outcome.createdAt)) <= 5 * 60 * 1000) {
        await supabase.from('coupon_redemptions').delete().eq('coupon_id', coupon.id).eq('customer_id', customerId)
      }
    }
  }
  return response.status(204).send()
})

customer.patch('/orders/:orderId/items/:itemId', async (request, response) => {
  if (!requireFeature(response) || !requireSupportedAppVersion(request, response)) return
  const parsed = z.object({
    location: z.string().trim().min(3).max(200).optional(),
    scheduledFor: z.string().datetime().optional(),
    slot: z.string().regex(/^\d{2}:\d{2}$/).optional(),
    latitude: z.number().finite().min(-90).max(90).optional(),
    longitude: z.number().finite().min(-180).max(180).optional(),
  }).refine((value) => Object.keys(value).length > 0).refine((value) => (value.latitude === undefined) === (value.longitude === undefined))
    .safeParse(request.body)
  if (!parsed.success) return response.status(400).json({ error: 'Invalid order item update.' })
  const { data: ownedItem, error: itemError } = await supabase.from('order_items').select('id')
    .eq('id', request.params.itemId).eq('order_id', request.params.orderId).maybeSingle()
  if (itemError) return databaseFailure(response, 'multi_service.item_update_failed', itemError, 500)
  if (!ownedItem) return response.status(404).json({ error: 'Order item not found.' })
  const { data, error } = await supabase.rpc('edit_multi_service_item', {
    p_item_id: request.params.itemId,
    p_customer_id: request.authUser!.id,
    p_changes: { location: parsed.data.location, scheduled_for: parsed.data.scheduledFor, slot: parsed.data.slot, latitude: parsed.data.latitude, longitude: parsed.data.longitude },
  })
  if (error) return databaseFailure(response, 'multi_service.item_update_failed', error, 400)
  const outcome = data as { updated?: boolean; reason?: string; orderId?: string }
  if (!outcome.updated) return response.status(outcome.reason === 'not_found' ? 404 : 409).json({ error: outcome.reason === 'not_found' ? 'Order item not found.' : 'This service can no longer be edited.' })
  const refreshed = await loadCustomerOrder(outcome.orderId!, request.authUser!.id)
  if (refreshed.error) return databaseFailure(response, 'multi_service.order_load_failed', refreshed.error, 500)
  await emitParentOrderUpdate(outcome.orderId!)
  response.json(refreshed.order)
})

customer.delete('/orders/:orderId/items/:itemId', async (request, response) => {
  if (!requireFeature(response) || !requireSupportedAppVersion(request, response)) return
  const { data: ownedItem, error: itemError } = await supabase.from('order_items').select('id')
    .eq('id', request.params.itemId).eq('order_id', request.params.orderId).maybeSingle()
  if (itemError) return databaseFailure(response, 'multi_service.item_cancel_failed', itemError, 500)
  if (!ownedItem) return response.status(404).json({ error: 'Order item not found.' })
  const { data, error } = await supabase.rpc('cancel_multi_service_item', { p_item_id: request.params.itemId, p_customer_id: request.authUser!.id, p_reason: 'Customer cancelled before vendor acceptance' })
  if (error) return databaseFailure(response, 'multi_service.item_cancel_failed', error, 400)
  const outcome = data as { cancelled?: boolean; reason?: string; orderId?: string }
  if (!outcome.cancelled) return response.status(outcome.reason === 'not_found' ? 404 : 409).json({ error: outcome.reason === 'not_found' ? 'Order item not found.' : 'This service can no longer be cancelled.' })
  const result = await loadCustomerOrder(outcome.orderId!, request.authUser!.id)
  if (result.error) return databaseFailure(response, 'multi_service.order_load_failed', result.error, 500)
  await emitParentOrderUpdate(outcome.orderId!)
  response.json(result.order)
})

customer.post('/orders/:orderId/fulfilments/:fulfilmentId/delivery-otp', async (request, response) => {
  if (!requireFeature(response) || !requireSupportedAppVersion(request, response)) return
  const { data: order, error: orderError } = await supabase.from('orders').select('id,legacy_booking_id').eq('id', request.params.orderId).eq('customer_id', request.authUser!.id).maybeSingle()
  if (orderError) return databaseFailure(response, 'multi_service.delivery_otp_failed', orderError, 500)
  if (!order) return response.status(404).json({ error: 'Order not found.' })
  const { data: fulfilment, error: fulfilmentError } = await supabase.from('order_fulfilments')
    .select('id,reference,status').eq('id', request.params.fulfilmentId).eq('order_id', order.id).maybeSingle()
  if (fulfilmentError) return databaseFailure(response, 'multi_service.delivery_otp_failed', fulfilmentError, 500)
  if (!fulfilment) return response.status(404).json({ error: 'Fulfilment not found.' })
  if (fulfilment.status !== 'arrived') return response.status(409).json({ error: 'Delivery OTP can only be requested after the vendor arrives.' })
  const { data: booking, error: bookingError } = await supabase.from('bookings').select('customer_phone_e164').eq('id', order.legacy_booking_id).maybeSingle()
  if (bookingError) return databaseFailure(response, 'multi_service.delivery_otp_failed', bookingError, 500)
  if (!booking?.customer_phone_e164) return response.status(409).json({ error: 'A customer phone number is not available for delivery verification.' })
  const otp = crypto.randomInt(0, 1_000_000).toString().padStart(6, '0')
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString()
  const { data: issueResult, error: issueError } = await supabase.rpc('issue_multi_service_delivery_otp', {
    p_fulfilment_id: fulfilment.id, p_customer_id: request.authUser!.id,
    p_hash: hashOtp(otp), p_expires_at: expiresAt,
  })
  if (issueError) return databaseFailure(response, 'multi_service.delivery_otp_failed', issueError, 500)
  const issue = issueResult as { issued?: boolean; reason?: string; reference?: string }
  if (!issue?.issued) return response.status(issue?.reason === 'rate_limited' ? 429 : issue?.reason === 'not_found' ? 404 : 409)
    .json({ error: issue?.reason === 'cooldown' ? 'Wait 60 seconds before requesting another delivery code.' : issue?.reason === 'rate_limited' ? 'Delivery code request limit reached. Try again later.' : 'Delivery code is not available for this fulfilment.' })
  try {
    const sent = await sendTemplateSms('delivery_otp', booking.customer_phone_e164, { reference: issue.reference ?? fulfilment.reference, otp })
    await supabase.from('order_fulfilments').update({ delivery_otp_sms_sent: sent.queued }).eq('id', fulfilment.id).eq('order_id', order.id)
    if (!sent.queued) return response.status(503).json({ error: 'Delivery OTP could not be sent. Please request a new code.' })
  } catch (error) {
    logger.warn('multi_service.delivery_otp_send_failed', { orderId: order.id, fulfilmentId: fulfilment.id, error: error instanceof Error ? error.message : String(error) })
    return response.status(503).json({ error: 'Delivery OTP could not be sent. Please request a new code.' })
  }
  response.status(202).json({ fulfilmentId: fulfilment.id, expiresAt, message: 'A delivery code was sent to your registered phone.' })
})

customer.post('/multi-service-fulfilments/:fulfilmentId/ratings', async (request, response) => {
  if (!requireFeature(response) || !requireSupportedAppVersion(request, response)) return
  const parsed = z.object({ rating: z.number().int().min(1).max(5), review: z.string().max(1000).optional() }).safeParse(request.body)
  if (!parsed.success) return response.status(400).json({ error: 'Invalid rating.' })
  const { data: fulfilment, error: fulfilmentError } = await supabase.from('order_fulfilments')
    .select('id,order_id,status').eq('id', request.params.fulfilmentId).maybeSingle()
  if (fulfilmentError) return databaseFailure(response, 'multi_service.rating_failed', fulfilmentError, 500)
  if (!fulfilment) return response.status(404).json({ error: 'Fulfilment not found.' })
  const { data: order, error: orderError } = await supabase.from('orders').select('id')
    .eq('id', fulfilment.order_id).eq('customer_id', request.authUser!.id).maybeSingle()
  if (orderError) return databaseFailure(response, 'multi_service.rating_failed', orderError, 500)
  if (!order) return response.status(404).json({ error: 'Fulfilment not found.' })
  if (fulfilment.status !== 'delivered') return response.status(409).json({ error: 'Only completed fulfilments can be rated.' })
  const { data, error } = await supabase.from('order_fulfilment_ratings').upsert({
    fulfilment_id: fulfilment.id, order_id: fulfilment.order_id, customer_id: request.authUser!.id,
    rating: parsed.data.rating, review: parsed.data.review,
  }, { onConflict: 'fulfilment_id,customer_id' }).select().single()
  if (error) return databaseFailure(response, 'multi_service.rating_failed', error, 400)
  response.status(201).json(data)
})

vendor.use(legacyRouterAuth, requireRole('vendor'))

async function findVendorId(userId: string) {
  const { data, error } = await supabase.from('vendors').select('id').eq('owner_profile_id', userId).maybeSingle()
  return { id: data?.id as string | undefined, error }
}

vendor.get('/multi-service-orders/offers', async (request, response) => {
  if (!requireFeature(response) || !requireSupportedAppVersion(request, response)) return
  const { id, error: vendorError } = await findVendorId(request.authUser!.id)
  if (vendorError) return databaseFailure(response, 'multi_service.vendor_lookup_failed', vendorError, 500)
  if (!id) return response.status(404).json({ error: 'Vendor profile not found.' })
  const { data, error } = await supabase.from('order_offers')
    .select('id,order_id,fulfilment_id,item_ids,is_bundle,status,expires_at,bundle_priority_at,distance_km,created_at')
    .eq('vendor_id', id).eq('status', 'offered').gt('expires_at', new Date().toISOString())
    .order('is_bundle', { ascending: false }).order('created_at', { ascending: true })
  if (error) return databaseFailure(response, 'multi_service.offers_lookup_failed', error, 500)
  const offers = (data ?? []).filter((offer) => offer.is_bundle || !offer.bundle_priority_at || new Date(offer.bundle_priority_at).getTime() <= Date.now())
  const orderIds = [...new Set(offers.map((offer) => offer.order_id))]
  const [orders, orderItems] = await Promise.all([
    orderIds.length ? supabase.from('orders').select('id,reference,total_paise,status,created_at').in('id', orderIds) : Promise.resolve({ data: [], error: null }),
    offers.length ? supabase.from('order_items').select('id,order_id,service_type_id,location,latitude,longitude,scheduled_for,slot,locked_price_paise,delivery_charge_paise,discount_paise,service_details,service_types(code,name)').in('id', [...new Set(offers.flatMap((offer) => offer.item_ids))]) : Promise.resolve({ data: [], error: null }),
  ])
  if (orders.error || orderItems.error) return databaseFailure(response, 'multi_service.offers_lookup_failed', orders.error ?? orderItems.error, 500)
  const ordersById = new Map((orders.data ?? []).map((order) => [order.id, order]))
  const itemsById = new Map((orderItems.data ?? []).map((item) => [item.id, item]))
  response.json(offers.map((offer) => ({
    ...offer,
    order: ordersById.get(offer.order_id),
    items: offer.item_ids.map((itemId: string) => itemsById.get(itemId)).filter(Boolean),
  })))
})

vendor.post('/multi-service-orders/offers/:offerId/accept', async (request, response) => {
  if (!requireFeature(response) || !requireSupportedAppVersion(request, response)) return
  const { id, error: vendorError } = await findVendorId(request.authUser!.id)
  if (vendorError) return databaseFailure(response, 'multi_service.vendor_lookup_failed', vendorError, 500)
  if (!id) return response.status(404).json({ error: 'Vendor profile not found.' })
  const { data, error } = await supabase.rpc('accept_multi_service_offer', { p_offer_id: request.params.offerId, p_vendor_id: id })
  if (error) return databaseFailure(response, 'multi_service.offer_accept_failed', error, 409)
  const outcome = data as { accepted?: boolean; reason?: string; orderId?: string; idempotent?: boolean }
  if (!outcome.accepted) return response.status(outcome.reason === 'not_found' ? 404 : 409).json({ error: outcome.reason === 'items_taken' ? 'One or more services were already taken.' : 'This offer is no longer available.', code: outcome.reason })
  logger.info('multi_service.offer_accepted', { orderId: outcome.orderId, offerId: request.params.offerId, vendorId: id, idempotent: outcome.idempotent })
  if (!outcome.idempotent && outcome.orderId) {
    await emitParentOrderUpdate(outcome.orderId)
    const { data: takenOffers } = await supabase.from('order_offers').select('vendor_id')
      .eq('order_id', outcome.orderId).eq('status', 'taken')
    for (const offer of takenOffers ?? []) emitRealtimeToVendor(offer.vendor_id, 'multi_service.offer.taken', { orderId: outcome.orderId })
  }
  response.json({ accepted: true, idempotent: Boolean(outcome.idempotent), orderId: outcome.orderId })
})

vendor.post('/multi-service-orders/offers/:offerId/reject', async (request, response) => {
  if (!requireFeature(response) || !requireSupportedAppVersion(request, response)) return
  const { id, error: vendorError } = await findVendorId(request.authUser!.id)
  if (vendorError) return databaseFailure(response, 'multi_service.vendor_lookup_failed', vendorError, 500)
  if (!id) return response.status(404).json({ error: 'Vendor profile not found.' })
  const { data, error } = await supabase.from('order_offers')
    .update({ status: 'declined', updated_at: new Date().toISOString() })
    .eq('id', request.params.offerId).eq('vendor_id', id).eq('status', 'offered')
    .select('id').maybeSingle()
  if (error) return databaseFailure(response, 'multi_service.offer_reject_failed', error, 409)
  if (!data) return response.status(409).json({ error: 'This offer is no longer available.' })
  response.json({ rejected: true })
})

vendor.get('/multi-service-fulfilments', async (request, response) => {
  if (!requireFeature(response) || !requireSupportedAppVersion(request, response)) return
  const { id, error: vendorError } = await findVendorId(request.authUser!.id)
  if (vendorError) return databaseFailure(response, 'multi_service.vendor_lookup_failed', vendorError, 500)
  if (!id) return response.status(404).json({ error: 'Vendor profile not found.' })
  const { data, error } = await supabase.from('order_fulfilments')
    .select('id,order_id,reference,status,latitude,longitude,delivered_at,created_at,orders(reference),order_fulfilment_items(order_items(id,location,latitude,longitude,scheduled_for,slot,locked_price_paise,delivery_charge_paise,service_details,service_types(code,name)))')
    .eq('vendor_id', id).order('created_at', { ascending: false }).limit(100)
  if (error) return databaseFailure(response, 'multi_service.fulfilments_lookup_failed', error, 500)
  response.json(data ?? [])
})

vendor.get('/multi-service-earnings', async (request, response) => {
  if (!requireFeature(response) || !requireSupportedAppVersion(request, response)) return
  const { id, error: vendorError } = await findVendorId(request.authUser!.id)
  if (vendorError) return databaseFailure(response, 'multi_service.vendor_lookup_failed', vendorError, 500)
  if (!id) return response.status(404).json({ error: 'Vendor profile not found.' })
  const { data, error } = await supabase.from('order_fulfilment_ledger')
    .select('fulfilment_id,order_id,gross_paise,commission_paise,payout_paise,created_at,order_fulfilments(reference,delivered_at)')
    .eq('vendor_id', id).is('settled_payout_id', null).order('created_at', { ascending: false }).limit(100)
  if (error) return databaseFailure(response, 'multi_service.earnings_lookup_failed', error, 500)
  response.json({ rows: data ?? [], totalPayoutPaise: (data ?? []).reduce((sum, row) => sum + Number(row.payout_paise), 0) })
})

vendor.patch('/multi-service-fulfilments/:fulfilmentId/status', async (request, response) => {
  if (!requireFeature(response) || !requireSupportedAppVersion(request, response)) return
  const parsed = z.object({ status: z.enum(['en_route', 'arrived']) }).safeParse(request.body)
  if (!parsed.success) return response.status(400).json({ error: 'Invalid fulfilment status.' })
  const { id, error: vendorError } = await findVendorId(request.authUser!.id)
  if (vendorError) return databaseFailure(response, 'multi_service.vendor_lookup_failed', vendorError, 500)
  if (!id) return response.status(404).json({ error: 'Vendor profile not found.' })
  const { data, error } = await supabase.rpc('transition_multi_service_fulfilment', {
    p_fulfilment_id: request.params.fulfilmentId, p_vendor_id: id, p_next_status: parsed.data.status,
  })
  if (error) return databaseFailure(response, 'multi_service.fulfilment_transition_failed', error, 409)
  const outcome = data as { updated?: boolean; reason?: string; orderId?: string }
  if (!outcome.updated) return response.status(outcome.reason === 'not_found' ? 404 : 409).json({ error: 'The fulfilment cannot be updated in its current state.' })
  if (outcome.orderId) await emitParentOrderUpdate(outcome.orderId)
  response.json(outcome)
})

vendor.post('/multi-service-fulfilments/:fulfilmentId/location', async (request, response) => {
  if (!requireFeature(response) || !requireSupportedAppVersion(request, response)) return
  const parsed = z.object({
    latitude: z.number().finite().min(-90).max(90),
    longitude: z.number().finite().min(-180).max(180),
  }).safeParse(request.body)
  if (!parsed.success) return response.status(400).json({ error: 'Invalid fulfilment location.' })
  const { id, error: vendorError } = await findVendorId(request.authUser!.id)
  if (vendorError) return databaseFailure(response, 'multi_service.vendor_lookup_failed', vendorError, 500)
  if (!id) return response.status(404).json({ error: 'Vendor profile not found.' })
  const { data, error } = await supabase.from('order_fulfilments').update({
    latitude: parsed.data.latitude, longitude: parsed.data.longitude, updated_at: new Date().toISOString(),
  }).eq('id', request.params.fulfilmentId).eq('vendor_id', id).in('status', ['en_route', 'arrived'])
    .select('id,order_id,latitude,longitude,updated_at').maybeSingle()
  if (error) return databaseFailure(response, 'multi_service.fulfilment_location_failed', error, 400)
  if (!data) return response.status(404).json({ error: 'Active vendor fulfilment not found.' })
  const { data: order } = await supabase.from('orders').select('customer_id').eq('id', data.order_id).maybeSingle()
  if (order?.customer_id) emitRealtimeToUser(order.customer_id, 'multi_service.fulfilment.location', {
    fulfilmentId: data.id, latitude: data.latitude, longitude: data.longitude,
  })
  response.json(data)
})

vendor.post('/multi-service-fulfilments/:fulfilmentId/drop', async (request, response) => {
  if (!requireFeature(response) || !requireSupportedAppVersion(request, response)) return
  const { id, error: vendorError } = await findVendorId(request.authUser!.id)
  if (vendorError) return databaseFailure(response, 'multi_service.vendor_lookup_failed', vendorError, 500)
  if (!id) return response.status(404).json({ error: 'Vendor profile not found.' })
  const { data, error } = await supabase.rpc('drop_multi_service_fulfilment', { p_fulfilment_id: request.params.fulfilmentId, p_vendor_id: id })
  if (error) return databaseFailure(response, 'multi_service.fulfilment_drop_failed', error, 409)
  const outcome = data as { dropped?: boolean; reason?: string }
  if (!outcome.dropped) return response.status(outcome.reason === 'not_found' ? 404 : 409).json({ error: 'This fulfilment can no longer be dropped.' })
  const { data: links, error: linksError } = await supabase.from('order_fulfilment_items')
    .select('order_items(id,service_type_id,latitude,longitude)').eq('fulfilment_id', request.params.fulfilmentId)
  if (linksError) return databaseFailure(response, 'multi_service.redispatch_failed', linksError, 500)
  const { data: droppedFulfilment } = await supabase.from('order_fulfilments').select('order_id')
    .eq('id', request.params.fulfilmentId).maybeSingle()
  const droppedItems = (links ?? []).flatMap((link) => (link.order_items ?? []).map((item) => ({
    id: item.id, service_type_id: item.service_type_id, latitude: item.latitude, longitude: item.longitude,
  })))
  if (droppedFulfilment?.order_id && droppedItems.length) {
    try { await dispatchOrder(droppedFulfilment.order_id, droppedItems) }
    catch (dispatchError) { logger.error('multi_service.redispatch_failed', { orderId: droppedFulfilment.order_id, error: dispatchError instanceof Error ? dispatchError.message : String(dispatchError) }) }
    await emitParentOrderUpdate(droppedFulfilment.order_id)
  }
  logger.info('multi_service.fulfilment_dropped', { fulfilmentId: request.params.fulfilmentId, vendorId: id })
  response.json(outcome)
})

vendor.post('/multi-service-fulfilments/:fulfilmentId/delivery/verify', async (request, response) => {
  if (!requireFeature(response) || !requireSupportedAppVersion(request, response)) return
  const parsed = z.object({ otp: z.string().regex(/^\d{6}$/) }).safeParse(request.body)
  if (!parsed.success) return response.status(400).json({ error: 'Enter the six-digit delivery code.' })
  const { id, error: vendorError } = await findVendorId(request.authUser!.id)
  if (vendorError) return databaseFailure(response, 'multi_service.vendor_lookup_failed', vendorError, 500)
  if (!id) return response.status(404).json({ error: 'Vendor profile not found.' })
  const { data: fulfilment, error: lookupError } = await supabase.from('order_fulfilments')
    .select('delivery_otp_hash').eq('id', request.params.fulfilmentId).eq('vendor_id', id).maybeSingle()
  if (lookupError) return databaseFailure(response, 'multi_service.delivery_verify_failed', lookupError, 500)
  if (!fulfilment) return response.status(404).json({ error: 'Fulfilment not found.' })
  const { data, error } = await supabase.rpc('claim_multi_service_delivery_attempt', {
    p_fulfilment_id: request.params.fulfilmentId, p_vendor_id: id,
    p_candidate_hash: hashOtp(parsed.data.otp),
  })
  if (error) return databaseFailure(response, 'multi_service.delivery_verify_failed', error, 409)
  const outcome = data as { verified?: boolean; reason?: string; orderId?: string }
  if (!outcome.verified) return response.status(outcome.reason === 'not_found' ? 404 : outcome.reason === 'locked' ? 429 : 400)
    .json({ error: outcome.reason === 'invalid' ? 'Invalid delivery code.' : outcome.reason === 'locked' ? 'Delivery code is locked. Contact operations.' : 'Delivery code is missing or expired.' })
  const { data: row } = await supabase.from('order_fulfilments').select('legacy_booking_id')
    .eq('id', request.params.fulfilmentId).eq('vendor_id', id).maybeSingle()
  try { await recordFulfilmentLedger(request.params.fulfilmentId) }
  catch (error) { logger.error('multi_service.ledger_record_failed', { fulfilmentId: request.params.fulfilmentId, error: error instanceof Error ? error.message : String(error) }) }
  if (row?.legacy_booking_id) {
    try { await createInvoiceIfEligible(row.legacy_booking_id) }
    catch (error) { logger.error('multi_service.invoice_generation_failed', { fulfilmentId: request.params.fulfilmentId, error: error instanceof Error ? error.message : String(error) }) }
  }
  logger.info('multi_service.fulfilment_delivered', { fulfilmentId: request.params.fulfilmentId, vendorId: id })
  if (outcome.orderId) await emitParentOrderUpdate(outcome.orderId)
  response.json({ delivered: true, orderId: outcome.orderId })
})

admin.use(legacyRouterAuth, requireRole('admin'))

admin.get('/multi-service-orders', async (request, response) => {
  if (!requireFeature(response) || !requireSupportedAppVersion(request, response)) return
  const { data, error } = await supabase.from('orders').select('id,reference,customer_id,legacy_booking_id,payment_method,status,total_paise,currency,created_at,updated_at,order_items(id,service_type_id,quantity,quantity_unit,location,latitude,longitude,scheduled_for,slot,service_details,locked_price_paise,delivery_charge_paise,discount_paise,status,service_types(code,name)),order_fulfilments(id,reference,status,vendor_id,latitude,longitude,delivered_at,created_at)')
    .order('created_at', { ascending: false }).limit(100)
  if (error) return databaseFailure(response, 'multi_service.admin_orders_failed', error, 500)
  response.json(data ?? [])
})

admin.post('/multi-service-fulfilments/:fulfilmentId/complete', async (request, response) => {
  if (!requireFeature(response) || !requireSupportedAppVersion(request, response)) return
  const parsed = z.object({ reason: z.string().trim().min(5).max(500) }).safeParse(request.body)
  if (!parsed.success) return response.status(400).json({ error: 'An audit reason of at least five characters is required.' })
  const { data, error } = await supabase.rpc('complete_multi_service_fulfilment_admin', {
    p_fulfilment_id: request.params.fulfilmentId, p_actor_id: request.authUser!.id, p_reason: parsed.data.reason,
  })
  if (error) return databaseFailure(response, 'multi_service.admin_completion_failed', error, 409)
  const outcome = data as { completed?: boolean; reason?: string }
  if (!outcome.completed) return response.status(outcome.reason === 'not_found' ? 404 : 409).json({ error: 'The fulfilment cannot be manually completed.' })
  try { await recordFulfilmentLedger(request.params.fulfilmentId!) }
  catch (error) { logger.error('multi_service.ledger_record_failed', { fulfilmentId: request.params.fulfilmentId, error: error instanceof Error ? error.message : String(error) }) }
  const { data: completedFulfilment } = await supabase.from('order_fulfilments').select('order_id')
    .eq('id', request.params.fulfilmentId).maybeSingle()
  if (completedFulfilment?.order_id) await emitParentOrderUpdate(completedFulfilment.order_id)
  response.json(outcome)
})

admin.post('/multi-service-fulfilments/:fulfilmentId/reassign', async (request, response) => {
  if (!requireFeature(response) || !requireSupportedAppVersion(request, response)) return
  const parsed = z.object({ vendorId: z.string().uuid(), reason: z.string().trim().min(5).max(500) }).safeParse(request.body)
  if (!parsed.success) return response.status(400).json({ error: 'A vendor and audit reason are required.' })
  const { data, error } = await supabase.rpc('reassign_multi_service_fulfilment_admin', {
    p_fulfilment_id: request.params.fulfilmentId, p_vendor_id: parsed.data.vendorId,
    p_actor_id: request.authUser!.id, p_reason: parsed.data.reason,
  })
  if (error) return databaseFailure(response, 'multi_service.admin_reassignment_failed', error, 409)
  const outcome = data as { reassigned?: boolean; reason?: string }
  if (!outcome.reassigned) return response.status(outcome.reason === 'not_found' ? 404 : 409).json({ error: 'The fulfilment cannot be reassigned.' })
  const { data: reassignedFulfilment } = await supabase.from('order_fulfilments').select('order_id')
    .eq('id', request.params.fulfilmentId).maybeSingle()
  if (reassignedFulfilment?.order_id) await emitParentOrderUpdate(reassignedFulfilment.order_id)
  emitRealtimeToVendor(parsed.data.vendorId, 'multi_service.fulfilment.assigned', { fulfilmentId: request.params.fulfilmentId })
  response.json(outcome)
})

export { customer as multiServiceCustomerRoutes, vendor as multiServiceVendorRoutes, admin as multiServiceAdminRoutes, compareVersion }

export async function runMultiServiceOrderSweep() {
  if (!config.MULTI_SERVICE_ORDERS_ENABLED) return { expiredOffers: 0, dispatchedOrders: 0 }
  const { data: sweepResult, error: sweepError } = await supabase.rpc('sweep_multi_service_order_offers', { p_escalation_minutes: config.NO_VENDOR_ESCALATION_MINUTES })
  if (sweepError) throw new Error(`Multi-service offer sweep failed: ${sweepError.message}`)
  const { data: unassigned, error } = await supabase.from('order_fulfilments')
    .select('id,order_id,order_fulfilment_items(item_id,order_items(id,service_type_id,latitude,longitude,status))')
    .is('vendor_id', null).in('status', ['pending_vendor', 'offered']).limit(500)
  if (error) throw new Error(`Multi-service pending fulfilments could not be loaded: ${error.message}`)
  const { data: delivered, error: deliveredError } = await supabase.from('order_fulfilments')
    .select('id').eq('status', 'delivered').not('vendor_id', 'is', null).limit(500)
  if (deliveredError) throw new Error(`Multi-service completed fulfilments could not be loaded: ${deliveredError.message}`)
  for (const fulfilment of delivered ?? []) {
    try { await recordFulfilmentLedger(fulfilment.id) }
    catch (ledgerError) { logger.error('multi_service.ledger_sweep_failed', { fulfilmentId: fulfilment.id, error: ledgerError instanceof Error ? ledgerError.message : String(ledgerError) }) }
  }
  const byOrder = new Map<string, Array<{ id: string; service_type_id: string; latitude: number | null; longitude: number | null }>>()
  for (const fulfilment of unassigned ?? []) {
    for (const link of fulfilment.order_fulfilment_items ?? []) {
      for (const item of link.order_items ?? []) {
        if (!['pending_vendor', 'offered'].includes(item.status)) continue
        const rows = byOrder.get(fulfilment.order_id) ?? []
        rows.push({ id: item.id, service_type_id: item.service_type_id, latitude: item.latitude, longitude: item.longitude })
        byOrder.set(fulfilment.order_id, rows)
      }
    }
  }
  for (const [orderId, items] of byOrder) {
    try { await dispatchOrder(orderId, items) }
    catch (dispatchError) { logger.error('multi_service.redispatch_failed', { orderId, error: dispatchError instanceof Error ? dispatchError.message : String(dispatchError) }) }
  }
  const result = sweepResult as { expiredOffers?: number; alerts?: number } | null
  return { expiredOffers: result?.expiredOffers ?? 0, escalations: result?.alerts ?? 0, dispatchedOrders: byOrder.size }
}
