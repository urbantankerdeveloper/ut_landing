import { Router } from 'express'
import { z } from 'zod'
import { requireAuth } from '../middleware/auth.js'
import { supabase } from '../supabase.js'
import { bookingSchema } from '../lib/schemas.js'
import { quoteServices } from '../services/pricing.js'
import { emitRealtimeToUser, emitRealtimeToVendor } from '../services/realtime.js'
import { sendPushNotification } from '../services/pushNotifications.js'
const router = Router()
function pushVendorOrder(ownerId: string, bookingId: string, reference: string) {
  void sendPushNotification({
    recipientId: ownerId,
    title: 'New delivery request',
    body: `Booking ${reference} is ready for review.`,
    data: { eventType: 'vendor_order_created', bookingId },
  }).catch((error) => console.warn(JSON.stringify({
    event: 'vendor_order.push_failed',
    bookingId,
    error: error instanceof Error ? error.message : 'Unknown error',
  })))
}
async function findAvailableVendor() {
  const { data } = await supabase.from('vendors').select('id,owner_profile_id').eq('is_online', true).eq('verification', 'approved').order('created_at').limit(1).maybeSingle()
  return data ?? null
}
router.get('/services', async (_request, response) => { const { data, error } = await supabase.from('service_catalog').select('code,name,description,base_price_paise,is_active,config').eq('is_active', true).order('name'); if (error) return response.status(500).json({ error: error.message }); response.json(data ?? []) })
router.get('/offers', async (_request, response) => { const { data, error } = await supabase.from('coupons').select('id,code,title,discount_type,discount_value,valid_until').eq('is_active', true).or('valid_until.is.null,valid_until.gte.' + new Date().toISOString()).order('created_at', { ascending: false }); if (error) return response.status(500).json({ error: error.message }); response.json(data ?? []) })
router.post('/coupons/validate', async (request, response) => { const parsed = z.object({ code: z.string().min(2).max(80), serviceCode: z.string().optional(), amount: z.number().nonnegative() }).safeParse(request.body); if (!parsed.success) return response.status(400).json({ error: 'Invalid coupon request' }); const { data, error } = await supabase.from('coupons').select('*').eq('code', parsed.data.code.toUpperCase()).eq('is_active', true).or('valid_until.is.null,valid_until.gte.' + new Date().toISOString()).maybeSingle(); if (error || !data) return response.status(404).json({ error: 'Coupon is not available' }); response.json({ valid: true, coupon: data }) })
router.use(requireAuth)
router.get('/phone-verification', async (request, response) => {
  const { data: profile, error: profileError } = await supabase.from('profiles').select('phone_e164').eq('id', request.authUser!.id).single()
  if (profileError) return response.status(500).json({ error: profileError.message })
  const phone = String(profile.phone_e164 ?? '').replace(/\D/g, '').slice(-10)
  if (!/^\d{10}$/.test(phone)) return response.json({ phone: '', verified: false })
  const { data: challenge, error } = await supabase.from('guest_otp_challenges').select('id').eq('phone_e164', `+91${phone}`).not('verified_at', 'is', null).order('verified_at', { ascending: false }).limit(1).maybeSingle()
  if (error) return response.status(500).json({ error: error.message })
  response.json({ phone, verified: Boolean(challenge) })
})
router.get('/usage', async (request, response) => { const { data, error } = await supabase.from('bookings').select('quoted_amount_paise,status').eq('customer_id', request.authUser!.id); if (error) return response.status(500).json({ error: error.message }); const delivered = (data ?? []).filter((item) => item.status === 'delivered'); const totalSpend = delivered.reduce((sum, item) => sum + Number(item.quoted_amount_paise ?? 0) / 100, 0); response.json({ deliveries: delivered.length, totalSpend, averageAmount: delivered.length ? Math.round(totalSpend / delivered.length) : 0 }) })
router.get('/orders', async (request, response) => { const { data, error } = await supabase.from('bookings').select('*').eq('customer_id', request.authUser!.id).order('created_at', { ascending: false }); if (error) return response.status(500).json({ error: error.message }); response.json(data ?? []) })
function getBookingServices(data: z.infer<typeof bookingSchema>) {
  const isLegacyPayload = !data.services?.length
  const items = data.services ?? (data.serviceId ?? '').split(',').map((serviceId) => ({
    serviceId,
    capacity: data.capacity,
    details: data.notes,
    deliveryDate: data.deliveryDate,
    location: data.location,
    waterType: undefined,
    tankerCount: undefined,
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
    details: item.serviceId === 'water_tanker' ? undefined : item.details?.trim() ?? '',
    deliveryDate: item.deliveryDate ?? data.deliveryDate ?? '',
    location: item.location ?? data.location,
    phone: item.phone ?? (isLegacyPayload ? data.phone : undefined),
    latitude: item.latitude ?? (isLegacyPayload ? data.latitude : undefined),
    longitude: item.longitude ?? (isLegacyPayload ? data.longitude : undefined),
    phoneVerificationChallengeId: item.phoneVerificationChallengeId,
  })).filter((item) => item.serviceId)
}
async function validateServicePhoneVerification(data: z.infer<typeof bookingSchema>, services: ReturnType<typeof getBookingServices>) {
  const contactChallenges = new Map<string, { phone: string; challengeId?: string; serviceId: string }>()
  for (const service of services) {
    if (service.phone) contactChallenges.set(service.phone, { phone: service.phone, challengeId: service.phoneVerificationChallengeId, serviceId: service.serviceId })
  }
  if (data.phone) contactChallenges.set(data.phone, { phone: data.phone, challengeId: data.phoneVerificationChallengeId, serviceId: 'booking contact' })
  for (const service of contactChallenges.values()) {
    let verificationQuery = supabase.from('guest_otp_challenges').select('id').eq('phone_e164', `+91${service.phone}`).not('verified_at', 'is', null)
    if (service.challengeId) verificationQuery = verificationQuery.eq('id', service.challengeId)
    const { data, error } = await verificationQuery.order('verified_at', { ascending: false }).limit(1).maybeSingle()
    if (error) return { status: 500, message: 'Phone verification could not be confirmed.' }
    if (!data) return { status: 400, message: `Verify the contact number for ${service.serviceId} before booking.` }
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
    customer_phone_e164: data.phone ? `+91${data.phone}` : primaryService.phone ? `+91${primaryService.phone}` : null,
    payment_method: data.paymentMethod,
    vendor_id: vendorId,
    service_code: primaryService.serviceId,
    capacity_litres: (isTankerService || !data.services?.length) && capacityMatch ? Number.parseInt(capacityMatch[1]?.replace(/,/g, '') ?? '', 10) || null : null,
    service_details: serviceDetails,
    address_text: primaryService.location ?? data.location,
    latitude: primaryService.latitude ?? data.latitude ?? null,
    longitude: primaryService.longitude ?? data.longitude ?? null,
    scheduled_for: primaryService.deliveryDate || data.deliveryDate,
    access_notes: data.notes ?? null,
    quoted_amount_paise: quotedAmountPaise,
  }
}
router.post('/orders', async (request, response) => {
  const parsed = bookingSchema.safeParse(request.body)
  if (!parsed.success) return response.status(400).json({ error: 'Invalid booking', details: parsed.error.flatten() })
  const services = getBookingServices(parsed.data)
  if (!services.length) return response.status(400).json({ error: 'At least one service is required' })
  const verificationError = await validateServicePhoneVerification(parsed.data, services)
  if (verificationError) return response.status(verificationError.status).json({ error: verificationError.message })
  const reference = `UT-${Date.now().toString().slice(-8)}`
  const vendor = await findAvailableVendor()
  const { data, error } = await supabase.from('bookings').insert({
    reference,
    customer_id: request.authUser!.id,
    ...bookingInsert(parsed.data, services, vendor?.id ?? null, 0),
  }).select('id,reference,vendor_id').single()
  if (error) return response.status(500).json({ error: error.message })
  if (vendor) {
    await supabase.from('notifications').insert({ recipient_id: vendor.owner_profile_id, event_type: 'vendor_order_created', title: 'New delivery request', payload: { bookingId: data.id, reference: data.reference } })
    pushVendorOrder(vendor.owner_profile_id, data.id, data.reference)
    emitRealtimeToVendor(vendor.id, 'vendor.order.created', { vendorId: vendor.id, bookingId: data.id, reference: data.reference })
  }
  emitRealtimeToUser(request.authUser!.id, 'booking.created', data)
  response.status(201).json(data)
})
router.post('/orders/quote', async (request, response) => {
  const parsed = bookingSchema.safeParse(request.body)
  if (!parsed.success) return response.status(400).json({ error: 'Invalid booking', details: parsed.error.flatten() })
  try {
    const services = getBookingServices(parsed.data)
    if (!services.length) return response.status(400).json({ error: 'At least one service is required' })
    const verificationError = await validateServicePhoneVerification(parsed.data, services)
    if (verificationError) return response.status(verificationError.status).json({ error: verificationError.message })
    const quote = await quoteServices(services.map((item) => item.serviceId), parsed.data.couponCode)
    const reference = `UT-${Date.now().toString().slice(-8)}`
    const vendor = await findAvailableVendor()
    const { data, error } = await supabase.from('bookings').insert({
      reference,
      customer_id: request.authUser!.id,
      ...bookingInsert(parsed.data, services, vendor?.id ?? null, quote.totalPaise),
    }).select('id,reference,vendor_id,quoted_amount_paise,payment_method').single()
    if (error) return response.status(500).json({ error: error.message })
    if (parsed.data.paymentMethod === 'cod') {
      const { error: paymentError } = await supabase.from('payments').insert({ booking_id: data.id, provider: 'cash_on_delivery', amount_paise: quote.totalPaise, currency: 'INR', status: 'pending' })
      if (paymentError) return response.status(500).json({ error: paymentError.message })
    }
    if (vendor) {
      const { error: notificationError } = await supabase.from('notifications').insert({ recipient_id: vendor.owner_profile_id, event_type: 'vendor_order_created', title: 'New delivery request', payload: { bookingId: data.id, reference: data.reference, paymentMethod: parsed.data.paymentMethod } })
      if (notificationError) return response.status(500).json({ error: notificationError.message })
      pushVendorOrder(vendor.owner_profile_id, data.id, data.reference)
      emitRealtimeToVendor(vendor.id, 'vendor.order.created', { vendorId: vendor.id, bookingId: data.id, reference: data.reference })
    }
    emitRealtimeToUser(request.authUser!.id, 'booking.created', data)
    response.status(201).json({ ...data, quote })
  } catch (error) {
    response.status(400).json({ error: error instanceof Error ? error.message : 'Booking quote failed' })
  }
})
router.post('/orders/quote-preview', async (request, response) => {
  const parsed = bookingSchema.safeParse(request.body)
  if (!parsed.success) return response.status(400).json({ error: 'Invalid booking', details: parsed.error.flatten() })
  try {
    const services = getBookingServices(parsed.data)
    if (!services.length) return response.status(400).json({ error: 'At least one service is required' })
    const quote = await quoteServices(services.map((item) => item.serviceId), parsed.data.couponCode)
    response.json({ quote, paymentMethod: parsed.data.paymentMethod ?? 'cod' })
  } catch (error) {
    response.status(400).json({ error: error instanceof Error ? error.message : 'Booking quote failed' })
  }
})
router.get('/invoices', async (request, response) => { const { data, error } = await supabase.from('invoices').select('*').eq('customer_id', request.authUser!.id).order('created_at', { ascending: false }); if (error) return response.status(500).json({ error: error.message }); response.json(data ?? []) })
router.get('/invoices/:invoiceId/download', async (request, response) => { const { data, error } = await supabase.from('invoices').select('*').eq('id', request.params.invoiceId).eq('customer_id', request.authUser!.id).single(); if (error || !data) return response.status(404).json({ error: 'Invoice not found' }); response.json(data) })
router.get('/addresses', async (request, response) => { const { data, error } = await supabase.from('saved_addresses').select('*').eq('user_id', request.authUser!.id).order('is_default', { ascending: false }).order('created_at', { ascending: false }); if (error) return response.status(500).json({ error: error.message }); response.json(data ?? []) })
router.post('/addresses', async (request, response) => { const parsed = z.object({ label: z.string().min(1).max(60), address: z.string().min(3).max(240), city: z.string().min(2).max(80), pincode: z.string().min(4).max(12), latitude: z.number().optional(), longitude: z.number().optional(), isDefault: z.boolean().default(false) }).safeParse(request.body); if (!parsed.success) return response.status(400).json({ error: 'Invalid address' }); if (parsed.data.isDefault) await supabase.from('saved_addresses').update({ is_default: false }).eq('user_id', request.authUser!.id); const { data, error } = await supabase.from('saved_addresses').insert({ user_id: request.authUser!.id, label: parsed.data.label, address: parsed.data.address, city: parsed.data.city, pincode: parsed.data.pincode, latitude: parsed.data.latitude, longitude: parsed.data.longitude, is_default: parsed.data.isDefault }).select().single(); if (error) return response.status(400).json({ error: error.message }); response.status(201).json(data) })
router.patch('/addresses/:id', async (request, response) => { const parsed = z.object({ label: z.string().min(1).max(60).optional(), address: z.string().min(3).max(240).optional(), city: z.string().min(2).max(80).optional(), pincode: z.string().min(4).max(12).optional(), isDefault: z.boolean().optional() }).safeParse(request.body); if (!parsed.success) return response.status(400).json({ error: 'Invalid address update' }); if (parsed.data.isDefault === true) await supabase.from('saved_addresses').update({ is_default: false }).eq('user_id', request.authUser!.id); const update = Object.fromEntries(Object.entries({ label: parsed.data.label, address: parsed.data.address, city: parsed.data.city, pincode: parsed.data.pincode, is_default: parsed.data.isDefault }).filter(([, value]) => value !== undefined)); const { data, error } = await supabase.from('saved_addresses').update(update).eq('id', request.params.id).eq('user_id', request.authUser!.id).select().single(); if (error) return response.status(400).json({ error: error.message }); response.json(data) })
router.delete('/addresses/:id', async (request, response) => { const { error } = await supabase.from('saved_addresses').delete().eq('id', request.params.id).eq('user_id', request.authUser!.id); if (error) return response.status(400).json({ error: error.message }); response.status(204).send() })
router.get('/subscriptions', async (request, response) => { const { data, error } = await supabase.from('subscriptions').select('*').eq('customer_id', request.authUser!.id).order('created_at', { ascending: false }); if (error) return response.status(500).json({ error: error.message }); response.json(data ?? []) })
router.get('/profile', async (request, response) => { const { data, error } = await supabase.from('profiles').select('full_name, phone_e164').eq('id', request.authUser!.id).single(); if (error) return response.status(500).json({ error: error.message }); response.json({ name: data.full_name, email: request.authUser!.email ?? '', phone: String(data.phone_e164 ?? '').replace(/\D/g, '').slice(-10) }) })
router.patch('/profile', async (request, response) => {
  const parsed = z.object({
    name: z.string().min(2).max(60),
    email: z.string().email(),
    phone: z.string().regex(/^\d{10}$/).optional(),
  }).safeParse(request.body)
  if (!parsed.success) return response.status(400).json({ error: 'Invalid profile' })
  let email = request.authUser!.email ?? parsed.data.email
  if (email !== parsed.data.email) {
    const { data, error } = await supabase.auth.admin.updateUserById(request.authUser!.id, { email: parsed.data.email })
    if (error) return response.status(400).json({ error: error.message })
    email = data.user.email ?? parsed.data.email
  }
  const profileUpdate = {
    full_name: parsed.data.name,
    ...(parsed.data.phone ? { phone_e164: parsed.data.phone } : {}),
  }
  const { data, error } = await supabase.from('profiles').update(profileUpdate).eq('id', request.authUser!.id).select().single()
  if (error) return response.status(400).json({ error: error.message })
  response.json({ name: data.full_name, email, phone: String(data.phone_e164 ?? '').replace(/\D/g, '').slice(-10) })
})
export default router
