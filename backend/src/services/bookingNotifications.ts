import { config } from '../config.js'
import { supabase } from '../supabase.js'
import { notifyCustomer } from './customerNotifications.js'
import { notifyUser } from './providers.js'
import { sendTemplateSms, type SmsTemplateKey } from './sms.js'
import { getOrCreateTrackingToken } from './trackingTokens.js'

type AssignedBooking = {
  id: string
  reference?: string | null
  customer_id: string
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
  const detail = `Fleet assigned: ${vehicle}. Driver: ${driver}. Live tracking: ${trackingUrl}`
  const payload = { vehicle, driver, trackingUrl, customerMapUrl, latitude: booking.latitude ?? null, longitude: booking.longitude ?? null }

  await notifyCustomer({
    customerId: booking.customer_id,
    eventType: 'booking_assignment_shared',
    title: 'Your tanker and driver are assigned',
    detail,
    bookingId: booking.id,
    payload,
  })

  const message = `Urban Tanker ${booking.reference ?? booking.id}: ${detail}${customerMapUrl ? ` Delivery location: ${customerMapUrl}` : ''}`
  const providerResults = await notifyUser({ email: authUser.user.email ?? undefined }, 'Your Urban Tanker fleet is assigned', message)
  const sms = await notifyCustomerSms(profileResult.data?.phone_e164, 'vendor_acceptance', {
    reference: booking.reference ?? booking.id,
    vehicle,
    driver,
    trackingUrl,
  })
  return { vehicle, driver, trackingUrl, providerResults, sms }
}

export async function notifyCustomerSms(phoneE164: string | null | undefined, key: SmsTemplateKey, vars: Record<string, string>) {
  if (!phoneE164) return { queued: false, reason: 'No phone' }
  try {
    return await sendTemplateSms(key, phoneE164, vars)
  } catch (error) {
    console.warn(JSON.stringify({ event: 'sms_failed', template: key, error: error instanceof Error ? error.message : 'unknown' }))
    return { queued: false, reason: 'SMS failed' }
  }
}

export async function notifyCustomerSmsById(customerId: string, key: SmsTemplateKey, vars: Record<string, string>) {
  const { data, error } = await supabase.from('profiles').select('phone_e164').eq('id', customerId).maybeSingle()
  if (error) {
    console.warn(JSON.stringify({ event: 'sms_lookup_failed', template: key, error: error.message }))
    return { queued: false, reason: 'Profile lookup failed' }
  }
  return notifyCustomerSms(data?.phone_e164, key, vars)
}
