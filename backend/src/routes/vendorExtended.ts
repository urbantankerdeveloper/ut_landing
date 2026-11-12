import { databaseFailure } from '../lib/httpErrors.js'
import { Router, type Request, type Response } from 'express'
import { z } from 'zod'
import { requireAuth, requireRole } from '../middleware/auth.js'
import { supabase } from '../supabase.js'
import { emitRealtime, emitRealtimeToBooking, emitRealtimeToUser, emitRealtimeToVendor } from '../services/realtime.js'
import { notifyCustomer } from '../services/customerNotifications.js'
import { notifyCustomerOfAssignment, notifyCustomerSmsById } from '../services/bookingNotifications.js'
import { transitionBooking, type BookingStatus } from '../services/bookingLifecycle.js'
import { analyticsEventNames, recordAnalyticsEvent } from '../lib/analytics.js'
import { failure } from '../lib/httpErrors.js'
import { logger } from '../lib/logger.js'
import { otpMatches } from '../services/otp.js'
import { deliveryVerificationMethod } from '../services/deliveryVerification.js'
import { listWindow, sendList, type ListWindow } from '../lib/listParams.js'
const exactCount = (range: ListWindow) => (range.mode === 'paged' ? { count: 'exact' as const } : undefined)
const router = Router(); router.use(requireAuth, requireRole('vendor'))
async function vendorId(userId: string) { const { data } = await supabase.from('vendors').select('id').eq('owner_profile_id', userId).single(); return data?.id }
function ownedStoragePath(path: string, userId: string) { return path.startsWith(`${userId}/`) && !path.includes('..') }
const maxDeliveryOtpAttempts = 5
router.get('/profile', async (request, response) => {
  const { data, error } = await supabase.from('vendors').select('id,business_name,service_zone,latitude,longitude').eq('owner_profile_id', request.authUser!.id).maybeSingle()
  if (error) return databaseFailure(response, 'vendorExtended.database_error', error, 500)
  if (!data) return response.status(404).json({ error: 'Vendor profile not found' })
  response.json(data)
})
router.patch('/profile/location', async (_request, response) => response.status(403).json({ error: 'Vendor coordinates are managed by Urban Tanker operations.' }))
const statusMap: Record<string, string> = { Accepted: 'accepted', accepted: 'accepted', 'En route': 'en_route', en_route: 'en_route', Arrived: 'arrived', arrived: 'arrived', Delivered: 'delivered', delivered: 'delivered', Rejected: 'cancelled', rejected: 'cancelled', cancelled: 'cancelled' }
const vendorOrderMutationSchema = z.object({ action: z.enum(['accept','reject','status','assign']), status: z.string().optional(), reason: z.string().trim().min(2).max(500).optional(), vehicleId: z.string().uuid().optional(), driverId: z.string().uuid().optional() }).superRefine((value, context) => {
  const requestedStatus = value.action === 'reject' ? 'cancelled' : value.action === 'status' && value.status ? statusMap[value.status] : undefined
  if (requestedStatus === 'cancelled' && !value.reason) context.addIssue({ code: 'custom', path: ['reason'], message: 'Cancellation reason is required' })
})
async function ensureAssignmentForAcceptance(bookingId: string, vendor: string, vehicleId?: string, driverId?: string) {
  const { data, error } = await supabase.from('bookings').select('vendor_id,vehicle_id,driver_id').eq('id', bookingId).maybeSingle()
  if (error) return { assigned: false, conflict: false, error: error.message, vehicleId, driverId }
  if (!data || (data.vendor_id && data.vendor_id !== vendor)) return { assigned: false, conflict: true, vehicleId, driverId }
  const selectedVehicleId = vehicleId ?? data.vehicle_id ?? undefined
  const selectedDriverId = driverId ?? data.driver_id ?? undefined
  return { assigned: Boolean(selectedVehicleId && selectedDriverId), conflict: false, vehicleId: selectedVehicleId, driverId: selectedDriverId }
}
async function vendorOffer(ownerProfileId: string, bookingId: string) {
  const { data, error } = await supabase.from('notifications').select('id,event_type,payload').eq('recipient_id', ownerProfileId).in('event_type', ['vendor_order_created', 'vendor_order_taken']).order('created_at', { ascending: false }).limit(200)
  if (error) return { offer: null, error: error.message }
  const offer = (data ?? []).find((item) => (item.payload as { bookingId?: string } | null)?.bookingId === bookingId)
  return { offer: offer ?? null, error: null }
}
async function markOtherVendorOffersTaken(bookingId: string, winnerVendorId: string, reference: string) {
  const { data: winner } = await supabase.from('vendors').select('owner_profile_id').eq('id', winnerVendorId).maybeSingle()
  const { data: offers, error } = await supabase.from('notifications').select('id,recipient_id,payload').eq('event_type', 'vendor_order_created').limit(500)
  if (error) { logger.warn('vendor_order.offers_lookup_failed', { bookingId, error: error.message }); return }
  const matching = (offers ?? []).filter((offer) => (offer.payload as { bookingId?: string } | null)?.bookingId === bookingId)
  const losers = matching.filter((offer) => offer.recipient_id && offer.recipient_id !== winner?.owner_profile_id)
  for (const offer of losers) {
    const payload = { ...((offer.payload ?? {}) as Record<string, unknown>), outcome: 'accepted_elsewhere', winningVendorId: winnerVendorId }
    const { error: updateError } = await supabase.from('notifications').update({ event_type: 'vendor_order_taken', title: 'Order already accepted by another vendor', payload }).eq('id', offer.id)
    if (updateError) { logger.warn('vendor_order.offer_update_failed', { bookingId, error: updateError.message }); continue }
    const { data: vendor } = await supabase.from('vendors').select('id').eq('owner_profile_id', offer.recipient_id).maybeSingle()
    if (vendor) emitRealtimeToVendor(vendor.id, 'vendor.order.taken', { bookingId, reference, status: 'unavailable', message: 'Already accepted by another vendor.' })
  }
}
async function handleVendorOrderTransition(request: Request, response: Response) {
  const vendor = await vendorId(request.authUser!.id)
  if (!vendor) return response.status(404).json({ error: 'Vendor profile not found' })
  const parsed = vendorOrderMutationSchema.safeParse(request.body)
  if (!parsed.success) return response.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid order mutation' })
  const { data: current, error: currentError } = await supabase.from('bookings').select('id,reference,status,vendor_id,vehicle_id,driver_id,customer_id').eq('id', request.params.id).maybeSingle()
  if (currentError) return databaseFailure(response, 'vendorExtended.database_error', currentError, 500)
  if (!current) return response.status(404).json({ error: 'Booking not found' })
  if (parsed.data.action === 'reject' && current.status === 'pending_vendor' && !current.vendor_id) {
    const { data: vendorProfile } = await supabase.from('vendors').select('owner_profile_id').eq('id', vendor).maybeSingle()
    if (!vendorProfile?.owner_profile_id) return response.status(404).json({ error: 'Vendor profile not found' })
    const { offer, error: offerError } = await vendorOffer(vendorProfile.owner_profile_id, current.id)
    if (offerError) return failure(response, 500, 'Order offer could not be checked.', 'vendor.offer_lookup_failed', offerError)
    if (!offer || offer.event_type !== 'vendor_order_created') return response.status(404).json({ error: 'Order offer not found' })
    const payload = { ...((offer.payload ?? {}) as Record<string, unknown>), outcome: 'declined', declineReason: parsed.data.reason }
    const { error } = await supabase.from('notifications').update({ event_type: 'vendor_order_declined', title: 'You declined this delivery request', payload }).eq('id', offer.id)
    if (error) return databaseFailure(response, 'vendorExtended.database_error', error, 500)
    emitRealtimeToVendor(vendor, 'vendor.order.declined', { bookingId: current.id, reference: current.reference })
    return response.json({ id: current.id, status: 'Rejected' })
  }
  const requestedStatus = parsed.data.action === 'accept' ? 'accepted' : parsed.data.action === 'reject' ? 'cancelled' : parsed.data.status ? statusMap[parsed.data.status] : parsed.data.action === 'assign' ? 'vendor_assigned' : undefined
  if (parsed.data.action === 'status' && requestedStatus === 'accepted') return response.status(409).json({ error: 'Use accept to take this order.' })
  if (parsed.data.action === 'status' && requestedStatus === 'cancelled' && !current.vendor_id) return response.status(409).json({ error: 'Use reject to decline this order.' })
  if (!requestedStatus) return response.status(400).json({ error: 'Invalid order transition' })
  if (parsed.data.action === 'assign' && current.status === 'pending_vendor' && !current.vendor_id) return response.status(409).json({ error: 'Choose a vehicle and driver when accepting the shared order.' })
  let vehicleId = parsed.data.vehicleId ?? undefined
  let driverId = parsed.data.driverId ?? undefined
  if (parsed.data.action === 'accept') {
    const { data: vendorProfile } = await supabase.from('vendors').select('owner_profile_id').eq('id', vendor).maybeSingle()
    if (!vendorProfile?.owner_profile_id) return response.status(404).json({ error: 'Vendor profile not found' })
    if (!current.vendor_id) {
      const { offer, error: offerError } = await vendorOffer(vendorProfile.owner_profile_id, current.id)
      if (offerError) return failure(response, 500, 'Order offer could not be checked.', 'vendor.offer_lookup_failed', offerError)
      if (!offer || offer.event_type !== 'vendor_order_created') return response.status(404).json({ error: 'Order offer not found' })
    }
    const assignment = await ensureAssignmentForAcceptance(current.id, vendor, vehicleId, driverId)
    if (assignment.error) return response.status(500).json({ error: 'Booking assignment could not be verified' })
    if (assignment.conflict) {
      if (current.vendor_id && current.vendor_id !== vendor) return response.status(409).json({ error: 'Order already accepted by another vendor.' })
      return response.status(404).json({ error: 'Booking not found' })
    }
    if (!assignment.assigned) return response.status(409).json({ error: 'Select an approved fleet vehicle and driver before accepting the booking' })
    vehicleId = assignment.vehicleId
    driverId = assignment.driverId
  }
  const { data, error } = await transitionBooking({ bookingId: current.id, actorId: request.authUser!.id, status: requestedStatus as BookingStatus, cancellationReason: parsed.data.reason, vendorId: vendor, vehicleId, driverId })
  if (error || !data) {
    const message = error?.message ?? 'Booking transition failed'
    if (parsed.data.action === 'accept' && /BOOKING_VENDOR_MISMATCH|INVALID_BOOKING_TRANSITION/.test(message)) return response.status(409).json({ error: 'Order already accepted by another vendor.' })
    return failure(response, message.includes('NOT_FOUND') ? 404 : 409, message.includes('NOT_FOUND') ? 'Booking not found.' : 'The booking cannot be updated in its current state.', 'vendor.transition_failed', error)
  }
  const customerId = (data as { customer_id?: string }).customer_id
  if (requestedStatus === 'accepted') {
    void recordAnalyticsEvent(analyticsEventNames.vendorAccepted, { bookingId: current.id })
  }
  if (requestedStatus === 'cancelled') { const { data: vendorRecord } = await supabase.from('vendors').select('business_name').eq('id', vendor).maybeSingle(); void recordAnalyticsEvent(analyticsEventNames.rejected, { bookingId: current.id, vendorId: vendor, vendorName: vendorRecord?.business_name ?? 'Unknown vendor', reason: parsed.data.reason ?? 'Vendor rejected booking' }) }
  if (requestedStatus === 'delivered') void recordAnalyticsEvent(analyticsEventNames.delivered, { bookingId: current.id })
  emitRealtime('booking.updated', { bookingId: current.id, status: requestedStatus }, customerId)
  if (customerId) emitRealtimeToUser(customerId, 'notification.created', { bookingId: current.id, status: requestedStatus })
  if (requestedStatus === 'accepted') {
    await markOtherVendorOffersTaken(current.id, vendor, current.reference)
    await shareAssignment(data as Record<string, unknown>)
  }
  return response.json(data)
}
async function shareAssignment(data: Record<string, unknown>) { try { await notifyCustomerOfAssignment(data as Parameters<typeof notifyCustomerOfAssignment>[0]) } catch (error) { logger.warn('booking.assignment_notification_failed', { bookingId: data.id, error: error instanceof Error ? error.message : 'Unknown error' }) } }
router.post('/offline-mutations', async (request, response) => { const parsed = z.object({ mutationType: z.string().min(2), entityType: z.string().min(2), entityId: z.string().uuid().optional(), payload: z.record(z.string(), z.unknown()).default({}), clientVersion: z.number().int().positive().default(1) }).safeParse(request.body); if (!parsed.success) return response.status(400).json({ error: 'Invalid offline mutation' }); const { data, error } = await supabase.from('offline_mutations').insert({ actor_id: request.authUser!.id, mutation_type: parsed.data.mutationType, entity_type: parsed.data.entityType, entity_id: parsed.data.entityId, payload: parsed.data.payload, client_version: parsed.data.clientVersion }).select().single(); if (error) return databaseFailure(response, 'vendorExtended.database_error', error, 400); response.status(201).json(data) })
router.get('/offline-mutations', async (request, response) => { const { data, error } = await supabase.from('offline_mutations').select('*').eq('actor_id', request.authUser!.id).order('created_at', { ascending: false }).limit(100); if (error) return databaseFailure(response, 'vendorExtended.database_error', error, 500); response.json(data ?? []) })
router.post('/offline-mutations/:id/retry', async (request, response) => { const { data, error } = await supabase.from('offline_mutations').update({ conflict_status: 'queued', last_error: null, updated_at: new Date().toISOString() }).eq('id', request.params.id).eq('actor_id', request.authUser!.id).select().single(); if (error) return databaseFailure(response, 'vendorExtended.database_error', error, 400); response.json(data) })
router.delete('/offline-mutations/:id', async (request, response) => { const { error } = await supabase.from('offline_mutations').update({ conflict_status: 'discarded', updated_at: new Date().toISOString() }).eq('id', request.params.id).eq('actor_id', request.authUser!.id); if (error) return databaseFailure(response, 'vendorExtended.database_error', error, 400); response.status(204).send() })
router.patch('/orders/:id/transition', handleVendorOrderTransition)
router.patch('/orders/:id', handleVendorOrderTransition)
router.post('/location', async (request, response) => { const vendor = await vendorId(request.authUser!.id); const parsed = z.object({ bookingId: z.string().uuid(), latitude: z.number().finite().min(-90).max(90), longitude: z.number().finite().min(-180).max(180), accuracy: z.number().finite().nonnegative().optional() }).safeParse(request.body); if (!vendor || !parsed.success) return response.status(400).json({ error: 'Invalid location' }); const { data: booking, error: bookingError } = await supabase.from('bookings').select('id,status').eq('id', parsed.data.bookingId).eq('vendor_id', vendor).single(); if (bookingError || !booking) return response.status(404).json({ error: 'Vendor booking not found' }); if (!['en_route', 'arrived'].includes(booking.status)) return response.status(409).json({ error: 'Location updates are only allowed while a booking is en route or arrived' }); const { data, error } = await supabase.from('vendor_location_updates').insert({ booking_id: parsed.data.bookingId, vendor_id: vendor, latitude: parsed.data.latitude, longitude: parsed.data.longitude, accuracy_metres: parsed.data.accuracy }).select().single(); if (error) return databaseFailure(response, 'vendor.location_failed', error, 400); const locationPayload = { bookingId: parsed.data.bookingId, latitude: parsed.data.latitude, longitude: parsed.data.longitude, accuracy: parsed.data.accuracy, recorded_at: data.recorded_at }; emitRealtimeToBooking(parsed.data.bookingId, 'booking.location.updated', locationPayload); response.status(201).json(data) })
router.patch('/vehicles/:id', async (request, response) => { const vendor = await vendorId(request.authUser!.id); const parsed = z.object({ registrationNumber: z.string().min(3).optional(), capacityLitres: z.number().int().positive().optional(), isActive: z.boolean().optional() }).safeParse(request.body); if (!vendor || !parsed.success) return response.status(400).json({ error: 'Invalid vehicle update' }); const { data, error } = await supabase.from('vehicles').update(Object.fromEntries(Object.entries({ registration_number: parsed.data.registrationNumber, capacity_litres: parsed.data.capacityLitres, is_active: parsed.data.isActive }).filter(([, value]) => value !== undefined))).eq('id', request.params.id).eq('vendor_id', vendor).select().single(); if (error) return databaseFailure(response, 'vendorExtended.database_error', error, 400); response.json(data) })
router.post('/vehicles', async (request, response) => { const vendor = await vendorId(request.authUser!.id); const parsed = z.object({ registrationNumber: z.string().min(3).max(40), capacityLitres: z.number().int().positive(), isActive: z.boolean().default(true) }).safeParse(request.body); if (!vendor || !parsed.success) return response.status(400).json({ error: 'Invalid vehicle' }); const { data, error } = await supabase.from('vehicles').insert({ vendor_id: vendor, registration_number: parsed.data.registrationNumber, capacity_litres: parsed.data.capacityLitres, is_active: parsed.data.isActive }).select().single(); if (error) return databaseFailure(response, 'vendorExtended.database_error', error, 400); response.status(201).json(data) })
router.patch('/drivers/:id', async (request, response) => { const vendor = await vendorId(request.authUser!.id); const parsed = z.object({ name: z.string().min(2).optional(), mobileE164: z.string().regex(/^\d{10}$/).optional(), licenceNumber: z.string().min(3).optional(), isActive: z.boolean().optional() }).safeParse(request.body); if (!vendor || !parsed.success) return response.status(400).json({ error: 'Invalid driver update' }); const { data, error } = await supabase.from('drivers').update(Object.fromEntries(Object.entries({ name: parsed.data.name, mobile_e164: parsed.data.mobileE164, licence_number: parsed.data.licenceNumber, is_active: parsed.data.isActive }).filter(([, value]) => value !== undefined))).eq('id', request.params.id).eq('vendor_id', vendor).select().single(); if (error) return databaseFailure(response, 'vendorExtended.database_error', error, 400); response.json(data) })
router.post('/drivers', async (request, response) => { const vendor = await vendorId(request.authUser!.id); const parsed = z.object({ name: z.string().min(2).max(80), mobileE164: z.string().regex(/^\d{10}$/), licenceNumber: z.string().min(3).max(60), isActive: z.boolean().default(false) }).safeParse(request.body); if (!vendor || !parsed.success) return response.status(400).json({ error: 'Invalid driver' }); const { data, error } = await supabase.from('drivers').insert({ vendor_id: vendor, name: parsed.data.name, mobile_e164: parsed.data.mobileE164, licence_number: parsed.data.licenceNumber, is_active: parsed.data.isActive }).select().single(); if (error) return databaseFailure(response, 'vendorExtended.database_error', error, 400); response.status(201).json(data) })
router.post('/orders/:id/delivery/verify', async (request, response) => {
  const vendor = await vendorId(request.authUser!.id)
  const parsed = z.object({
    otp: z.string().regex(/^\d{6}$/).optional(),
    proofPath: z.string().trim().min(1).max(250).optional(),
  }).safeParse(request.body)
  if (!vendor || !parsed.success) return response.status(400).json({ error: 'Invalid delivery verification' })
  if (parsed.data.proofPath && !ownedStoragePath(parsed.data.proofPath, request.authUser!.id)) {
    return response.status(400).json({ error: 'Delivery proof must be uploaded from your account.' })
  }

  const { data: booking, error: bookingError } = await supabase
    .from('bookings')
    .select('id,status,customer_id,reference,delivery_otp_hash,delivery_otp_expires_at,delivery_otp_attempts,delivery_otp_sms_sent')
    .eq('id', request.params.id)
    .eq('vendor_id', vendor)
    .single()
  if (bookingError || !booking) return response.status(404).json({ error: 'Vendor booking not found' })
  if (booking.status !== 'arrived') return response.status(409).json({ error: 'Booking is not ready for delivery verification' })

  const verificationMethod = deliveryVerificationMethod({
    otp: parsed.data.otp,
    smsSent: booking.delivery_otp_sms_sent,
    proofPath: parsed.data.proofPath,
  })
  if (!verificationMethod) {
    return response.status(400).json({
      error: 'Enter the customer OTP. A delivery photo can replace it only when the OTP SMS was not sent.',
    })
  }

  if (verificationMethod === 'otp') {
    if (!parsed.data.otp) return response.status(400).json({ error: 'Enter the customer OTP.' })
    if (!booking.delivery_otp_hash || !booking.delivery_otp_expires_at || new Date(booking.delivery_otp_expires_at).getTime() < Date.now()) {
      return response.status(400).json({ error: 'Delivery OTP is missing or expired' })
    }

    const attempts = Number(booking.delivery_otp_attempts ?? 0)
    if (attempts >= maxDeliveryOtpAttempts) {
      return response.status(429).json({ error: 'Too many incorrect attempts. Ask the customer for a new delivery code.' })
    }
    const { data: claimed, error: claimError } = await supabase
      .from('bookings')
      .update({ delivery_otp_attempts: attempts + 1 })
      .eq('id', booking.id)
      .eq('delivery_otp_attempts', attempts)
      .select('id')
      .maybeSingle()
    if (claimError) return databaseFailure(response, 'vendor.delivery_attempt_failed', claimError, 500)
    if (!claimed) return response.status(409).json({ error: 'Please submit the delivery code again.' })
    if (!otpMatches(booking.delivery_otp_hash, parsed.data.otp)) {
      return response.status(400).json({ error: 'Invalid delivery OTP' })
    }
  }

  if (parsed.data.proofPath) {
    const { error: proofError } = await supabase.from('documents').insert({
      owner_type: 'booking',
      owner_id: booking.id,
      document_type: 'delivery_proof',
      object_key: parsed.data.proofPath,
      verification: 'submitted',
    })
    if (proofError) return response.status(400).json({ error: 'Delivery proof could not be registered' })
  }

  const { data, error } = await transitionBooking({
    bookingId: booking.id,
    actorId: request.authUser!.id,
    status: 'delivered',
    vendorId: vendor,
  })
  if (error || !data) {
    return failure(response, 409, 'Delivery could not be completed.', 'vendor.delivery_transition_failed', error)
  }
  const { error: clearError } = await supabase
    .from('bookings')
    .update({
      delivery_otp_hash: null,
      delivery_otp_expires_at: null,
      delivery_otp_sms_sent: null,
    })
    .eq('id', booking.id)
    .eq('status', 'delivered')
  if (clearError) return response.status(500).json({ error: 'Delivery completed but OTP cleanup failed' })

  if (booking.customer_id) {
    await notifyCustomer({
      customerId: booking.customer_id,
      eventType: 'booking_delivered',
      title: 'Delivery completed',
      detail: 'Your Urban Tanker delivery is complete.',
      bookingId: booking.id,
    })
    void notifyCustomerSmsById(booking.customer_id, 'delivery_confirmation', {
      reference: booking.reference ?? booking.id,
    })
  }
  response.json(data)
})
router.post('/attendance', async (request, response) => { const vendor = await vendorId(request.authUser!.id); const parsed = z.object({ driverId: z.string().uuid(), status: z.enum(['present','absent','on_leave']), date: z.string() }).safeParse(request.body); if (!vendor || !parsed.success) return response.status(400).json({ error: 'Invalid attendance' }); const { data: driver, error: driverError } = await supabase.from('drivers').select('id').eq('id', parsed.data.driverId).eq('vendor_id', vendor).maybeSingle(); if (driverError) return databaseFailure(response, 'vendor.attendance_driver_failed', driverError, 500); if (!driver) return response.status(404).json({ error: 'Driver not found' }); const { data, error } = await supabase.from('driver_attendance').upsert({ vendor_id: vendor, driver_id: parsed.data.driverId, status: parsed.data.status, attendance_date: parsed.data.date }, { onConflict: 'driver_id,attendance_date' }).select().single(); if (error) return databaseFailure(response, 'vendor.attendance_failed', error, 400); response.status(201).json(data) })
router.get('/attendance', async (request, response) => { const vendor = await vendorId(request.authUser!.id); if (!vendor) return response.status(404).json({ error: 'Vendor profile not found' }); const parsed = z.object({ driverId: z.string().uuid().optional(), date: z.string().optional() }).safeParse(request.query); if (!parsed.success) return response.status(400).json({ error: 'Invalid attendance filter' }); let query = supabase.from('driver_attendance').select('*').eq('vendor_id', vendor).order('attendance_date', { ascending: false }).limit(200); if (parsed.data.driverId) query = query.eq('driver_id', parsed.data.driverId); if (parsed.data.date) query = query.eq('attendance_date', parsed.data.date); const { data, error } = await query; if (error) return databaseFailure(response, 'vendorExtended.database_error', error, 500); response.json(data ?? []) })
router.get('/complaints', async (request, response) => { const vendor = await vendorId(request.authUser!.id); if (!vendor) return response.status(404).json({ error: 'Vendor profile not found' }); const listRange = listWindow(request.query); const { data, error, count } = await supabase.from('complaints').select('*', exactCount(listRange)).eq('vendor_id', vendor).order('created_at', { ascending: false }).range(listRange.from, listRange.to); if (error) return databaseFailure(response, 'vendorExtended.database_error', error, 500); sendList(response, listRange, data ?? [], count) })
router.post('/complaints', async (request, response) => { const vendor = await vendorId(request.authUser!.id); const parsed = z.object({ subject: z.string().min(2).max(120), bookingId: z.string().uuid(), message: z.string().min(2).max(2000) }).safeParse(request.body); if (!vendor || !parsed.success) return response.status(400).json({ error: 'Invalid complaint' }); const { data: owned, error: ownedError } = await supabase.from('bookings').select('id').eq('id', parsed.data.bookingId).eq('vendor_id', vendor).maybeSingle(); if (ownedError) return databaseFailure(response, 'vendor.complaint_booking_failed', ownedError, 500); if (!owned) return response.status(404).json({ error: 'Vendor booking not found' }); const { data, error } = await supabase.from('complaints').insert({ vendor_id: vendor, booking_id: parsed.data.bookingId, subject: parsed.data.subject, message: parsed.data.message, status: 'open' }).select().single(); if (error) return databaseFailure(response, 'vendor.complaint_failed', error, 400); response.status(201).json(data) })
router.patch('/complaints/:id', async (request, response) => { const vendor = await vendorId(request.authUser!.id); const parsed = z.object({ status: z.enum(['open', 'in_progress', 'resolved']), resolution: z.string().min(2).max(2000) }).safeParse(request.body); if (!vendor || !parsed.success) return response.status(400).json({ error: 'Invalid complaint update' }); const { data, error } = await supabase.from('complaints').update({ status: parsed.data.status, response: parsed.data.resolution }).eq('id', request.params.id).eq('vendor_id', vendor).select().single(); if (error) return databaseFailure(response, 'vendor.complaint_update_failed', error, 400); response.json(data) })
router.get('/documents', async (request, response) => { const vendor = await vendorId(request.authUser!.id); if (!vendor) return response.status(404).json({ error: 'Vendor profile not found' }); const listRange = listWindow(request.query); const { data, error, count } = await supabase.from('documents').select('*', exactCount(listRange)).eq('owner_type', 'vendor').eq('owner_id', vendor).order('created_at', { ascending: false }).range(listRange.from, listRange.to); if (error) return databaseFailure(response, 'vendorExtended.database_error', error, 500); sendList(response, listRange, data ?? [], count) })
router.post('/documents', async (request, response) => { const vendor = await vendorId(request.authUser!.id); const parsed = z.object({ documentType: z.string().min(2).max(60), objectKey: z.string().min(3).max(250), expiresOn: z.string().date().optional() }).safeParse(request.body); if (!vendor || !parsed.success || !ownedStoragePath(parsed.data.objectKey, request.authUser!.id)) return response.status(400).json({ error: 'Invalid document' }); const { data, error } = await supabase.from('documents').insert({ owner_type: 'vendor', owner_id: vendor, document_type: parsed.data.documentType, object_key: parsed.data.objectKey, expires_on: parsed.data.expiresOn, verification: 'pending' }).select().single(); if (error) return databaseFailure(response, 'vendor.document_failed', error, 400); response.status(201).json(data) })
router.patch('/documents/:id', async (request, response) => { const vendor = await vendorId(request.authUser!.id); const parsed = z.object({ expiresOn: z.string().date().optional() }).safeParse(request.body); if (!vendor || !parsed.success) return response.status(400).json({ error: 'Invalid document update' }); const { data, error } = await supabase.from('documents').update(Object.fromEntries(Object.entries({ expires_on: parsed.data.expiresOn }).filter(([, value]) => value !== undefined))).eq('id', request.params.id).eq('owner_type', 'vendor').eq('owner_id', vendor).select().single(); if (error) return databaseFailure(response, 'vendor.document_update_failed', error, 400); response.json(data) })
router.post('/payouts/request', async (request, response) => { const vendor = await vendorId(request.authUser!.id); const parsed = z.object({ amount: z.number().positive().max(10_000_000) }).safeParse(request.body); if (!vendor || !parsed.success) return response.status(400).json({ error: 'Invalid payout request' }); const amountPaise = Math.round(parsed.data.amount * 100); if (!Number.isSafeInteger(amountPaise) || amountPaise <= 0 || Math.abs(parsed.data.amount * 100 - amountPaise) > 1e-6) return response.status(400).json({ error: 'Enter an amount with at most two decimal places.' }); const { data: rows, error: rowsError } = await supabase.from('vendor_payouts').select('amount,status,period_start').eq('vendor_id', vendor).neq('status', 'failed'); if (rowsError) return databaseFailure(response, 'vendor.payout_lookup_failed', rowsError, 500); const toPaise = (value: unknown) => Math.round(Number(value ?? 0) * 100); const settledPaise = (rows ?? []).filter((row) => row.period_start).reduce((sum, row) => sum + toPaise(row.amount), 0); const requestedPaise = (rows ?? []).filter((row) => !row.period_start).reduce((sum, row) => sum + toPaise(row.amount), 0); if ((rows ?? []).some((row) => !row.period_start && ['pending', 'processing'].includes(row.status))) return response.status(409).json({ error: 'You already have a payout request awaiting review.' }); if (amountPaise > settledPaise - requestedPaise) return response.status(400).json({ error: 'The requested amount is more than your settled earnings.' }); const { data, error } = await supabase.from('vendor_payouts').insert({ vendor_id: vendor, amount: amountPaise / 100, status: 'pending' }).select().single(); if (error) return databaseFailure(response, 'vendor.payout_request_failed', error, 400); response.status(201).json(data) })
router.post('/orders/:id/delivery/realtime', async (request, response) => { const vendor = await vendorId(request.authUser!.id); if (!vendor) return response.status(404).json({ error: 'Vendor profile not found' }); const { data: booking } = await supabase.from('bookings').select('id,customer_id,status').eq('id', request.params.id).eq('vendor_id', vendor).single(); if (!booking) return response.status(404).json({ error: 'Booking not found' }); if (booking.status === 'delivered' && booking.customer_id) { try { await notifyCustomer({ customerId: booking.customer_id, eventType: 'delivery_completed', title: 'Delivery completed', detail: 'Your delivery has been verified and completed.', bookingId: booking.id }) } catch { /* Delivery is complete even if notification persistence is temporarily unavailable. */ } } response.status(204).send() })
router.patch('/services/:code/availability', async (request, response) => { const vendor = await vendorId(request.authUser!.id); const parsed = z.object({ enabled: z.boolean() }).safeParse(request.body); if (!vendor || !parsed.success) return response.status(400).json({ error: 'Invalid service availability' }); const { data, error } = await supabase.from('vendor_service_availability').upsert({ vendor_id: vendor, service_code: request.params.code, is_enabled: parsed.data.enabled, updated_at: new Date().toISOString() }, { onConflict: 'vendor_id,service_code' }).select().single(); if (error) return databaseFailure(response, 'vendorExtended.database_error', error, 400); response.json(data) })
router.post('/services', async (_request, response) => response.status(403).json({ error: 'Only Urban Tanker operations can add services.' }))
router.get('/notifications', async (request, response) => { const listRange = listWindow(request.query); const { data, error, count } = await supabase.from('notifications').select('*', exactCount(listRange)).eq('recipient_id', request.authUser!.id).order('created_at', { ascending: false }).range(listRange.from, listRange.to); if (error) return databaseFailure(response, 'vendorExtended.database_error', error, 500); sendList(response, listRange, data ?? [], count) })
router.patch('/notifications/:id/read', async (request, response) => { const { data, error } = await supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', request.params.id).eq('recipient_id', request.authUser!.id).select().single(); if (error) return databaseFailure(response, 'vendorExtended.database_error', error, 400); response.json(data) })
export default router
