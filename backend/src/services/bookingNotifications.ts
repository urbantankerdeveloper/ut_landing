import { config } from '../config.js'
import { logger } from '../lib/logger.js'
import { supabase } from '../supabase.js'
import { notifyCustomer } from './customerNotifications.js'
import { notifyUser } from './providers.js'
import { sendTemplateWhatsApp, type SmsTemplateKey } from './whatsapp.js'
import { getOrCreateTrackingToken } from './trackingTokens.js'

type AssignedBooking = {
  id: string
  reference?: string | null
  customer_id: string
  customer_phone_e164?: string | null
  latitude?: number | null
  longitude?: number | null
  vehicle_id?: string | null
  driver_id?: string | null
}

export async function notifyCustomerOfAssignment(booking: AssignedBooking) {
  const [{ token }, profileResult, vehicleResult, driverResult] = await Promise.all([
    getOrCreateTrackingToken(booking.id),
    supabase.from('profiles').select('phone_e164').eq('id', booking.customer_id).maybeSingle(),
    booking.vehicle_id ? supabase.from('vehicles').select('registration_number').eq('id', booking.vehicle_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
    booking.driver_id ? supabase.from('drivers').select('name').eq('id', booking.driver_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
  ])
  const queryError = profileResult.error ?? vehicleResult.error ?? driverResult.error
  if (queryError) throw new Error(`Assignment notification lookup failed: ${queryError.message}`)
  const { data: authUser, error: authError } = await supabase.auth.admin.getUserById(booking.customer_id)
  if (authError) throw new Error(`Assignment email lookup failed: ${authError.message}`)

  const vehicle = vehicleResult.data?.registration_number ?? 'Assigned tanker'
  const driver = driverResult.data?.name ?? 'Assigned driver'
  const trackingUrl = `${config.FRONTEND_ORIGIN}/track/${token}`
  const customerMapUrl = booking.latitude !== null && booking.longitude !== null && booking.latitude !== undefined && booking.longitude !== undefined
    ? `https://www.google.com/maps/search/?api=1&query=${booking.latitude},${booking.longitude}`
    : null
  const detail = `Fleet assigned: ${vehicle}. Driver: ${driver}. Open your booking to follow live tracking.`
  // The tracking link is sent by email and WhatsApp only. It is not stored in notifications or push payloads.
  const payload = { vehicle, driver, customerMapUrl, latitude: booking.latitude ?? null, longitude: booking.longitude ?? null }

  await notifyCustomer({
    customerId: booking.customer_id,
    eventType: 'booking_assignment_shared',
    title: 'Your tanker and driver are assigned',
    detail,
    bookingId: booking.id,
    payload,
  })

  const message = `Urban Tanker ${booking.reference ?? booking.id}: ${detail} Live tracking: ${trackingUrl}${customerMapUrl ? ` Delivery location: ${customerMapUrl}` : ''}`
  const providerResults = await notifyUser({ email: authUser.user.email ?? undefined }, 'Your Urban Tanker fleet is assigned', message)
  const whatsapp = await notifyCustomerWhatsApp(
    booking.customer_phone_e164 ?? profileResult.data?.phone_e164,
    'vendor_acceptance',
    {
      reference: booking.reference ?? booking.id,
      vehicle,
      driver,
      trackingUrl,
    },
  )
  return { vehicle, driver, trackingUrl, providerResults, whatsapp }
}

export async function notifyCustomerOfBooking(phoneE164: string | null | undefined, bookingId: string, reference: string) {
  if (!phoneE164) return { queued: false, reason: 'No phone' }
  try {
    const { token } = await getOrCreateTrackingToken(bookingId)
    const claimedAt = new Date().toISOString()
    const { data: claimed, error: claimError } = await supabase
      .from('bookings')
      .update({ tracking_confirmation_sent_at: claimedAt })
      .eq('id', bookingId)
      .is('tracking_confirmation_sent_at', null)
      .select('id')
      .maybeSingle()
    if (claimError) throw new Error(`Tracking confirmation claim failed: ${claimError.message}`)
    if (!claimed) return { queued: false, reason: 'Tracking confirmation already sent' }

    const result = await notifyCustomerWhatsApp(phoneE164, 'guest_booking_confirmation', {
      reference,
      trackingUrl: `${config.FRONTEND_ORIGIN}/track/${token}`,
    })
    if (!result.queued) {
      const { error: releaseError } = await supabase
        .from('bookings')
        .update({ tracking_confirmation_sent_at: null })
        .eq('id', bookingId)
        .eq('tracking_confirmation_sent_at', claimedAt)
      if (releaseError) logger.warn('booking.tracking_confirmation_claim_release_failed', {
        bookingId,
        error: releaseError.message,
      })
    }
    return result
  } catch (error) {
    logger.warn('booking.tracking_confirmation_failed', {
      bookingId,
      error: error instanceof Error ? error.message : 'Unknown error',
    })
    return { queued: false, reason: 'Tracking confirmation failed' }
  }
}

export async function notifyCustomerWhatsApp(phoneE164: string | null | undefined, key: SmsTemplateKey, vars: Record<string, string>) {
  if (!phoneE164) return { queued: false, reason: 'No phone' }
  try {
    return await sendTemplateWhatsApp(key, phoneE164, vars)
  } catch (error) {
    logger.warn('whatsapp_failed', { template: key, error: error instanceof Error ? error.message : 'unknown' })
    return { queued: false, reason: 'WhatsApp failed' }
  }
}

export async function notifyCustomerWhatsAppById(customerId: string, key: SmsTemplateKey, vars: Record<string, string>) {
  const { data, error } = await supabase.from('profiles').select('phone_e164').eq('id', customerId).maybeSingle()
  if (error) {
    logger.warn('whatsapp_lookup_failed', { template: key, error: error.message })
    return { queued: false, reason: 'Profile lookup failed' }
  }
  return notifyCustomerWhatsApp(data?.phone_e164, key, vars)
}
