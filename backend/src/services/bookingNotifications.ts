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
  order_group_reference?: string | null
  customer_id: string
  customer_phone_e164?: string | null
  latitude?: number | null
  longitude?: number | null
  vehicle_id?: string | null
  driver_id?: string | null
}

type CustomerBookingUpdate =
  | 'pending_vendor'
  | 'vendor_assigned'
  | 'accepted'
  | 'en_route'
  | 'arrived'
  | 'cancelled'
  | 'payment_online'
  | 'payment_cod'
  | 'rescheduled'
  | 'delivered'

const customerBookingUpdates: Record<CustomerBookingUpdate, { status: string; detail: string }> = {
  pending_vendor: { status: 'Finding a vendor', detail: 'We are finding a vendor for your booking.' },
  vendor_assigned: { status: 'Vendor assigned', detail: 'A vendor has been assigned to your booking.' },
  accepted: { status: 'Booking accepted', detail: 'A vendor has accepted your booking.' },
  en_route: { status: 'Tanker on the way', detail: 'Your tanker is on the way to the delivery location.' },
  arrived: { status: 'Tanker arrived', detail: 'Your tanker has arrived at the delivery location.' },
  cancelled: { status: 'Booking cancelled', detail: 'Your booking has been cancelled.' },
  payment_online: { status: 'Payment received', detail: 'Your online payment was received. No cash is due on delivery.' },
  payment_cod: { status: 'Payment method changed', detail: 'Your booking is now set to cash on delivery.' },
  rescheduled: { status: 'Booking rescheduled', detail: 'The schedule for your booking has been updated.' },
  delivered: { status: 'Delivery complete', detail: 'Your delivery is complete. Thank you for choosing Urban Tanker.' },
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Unknown error'
}

async function loadCustomerEmail(customerId: string | null | undefined) {
  if (!customerId) return null
  const { data, error } = await supabase.auth.admin.getUserById(customerId)
  if (error) throw new Error(`Customer email lookup failed: ${error.message}`)
  const accountEmail = data.user?.email?.trim()
  if (accountEmail && !accountEmail.toLowerCase().endsWith('@guest.urbantanker.local')) return accountEmail
  const bookingEmail = data.user?.app_metadata?.booking_email
  return typeof bookingEmail === 'string' ? bookingEmail.trim() || null : null
}

async function notifyCustomerEmail(
  bookingId: string,
  customerId: string | null | undefined,
  subject: string,
  message: string,
  event: string,
) {
  try {
    const email = await loadCustomerEmail(customerId)
    if (!email) return { queued: false, reason: 'No customer email' }
    const [result] = await notifyUser({ email }, subject, message)
    if (!result.queued) logger.warn('booking.email_not_queued', {
      bookingId,
      event,
      reason: result.reason ?? 'Email delivery was not queued',
    })
    return result
  } catch (error) {
    logger.warn('booking.email_notification_failed', {
      bookingId,
      event,
      error: errorMessage(error),
    })
    return { queued: false, reason: 'Email notification failed' }
  }
}

async function loadBookingContact(bookingId: string) {
  const { data: booking, error } = await supabase
    .from('bookings')
    .select('id,reference,customer_id,customer_phone_e164,order_group_id,order_group_reference')
    .eq('id', bookingId)
    .maybeSingle()
  if (error) throw new Error(`Booking contact lookup failed: ${error.message}`)
  if (!booking) return null
  let trackingBookingId = booking.id
  if (booking.order_group_id) {
    const { data: leadBooking, error: leadError } = await supabase
      .from('bookings')
      .select('id')
      .eq('order_group_id', booking.order_group_id)
      .order('reference', { ascending: true })
      .limit(1)
      .maybeSingle()
    if (leadError) throw new Error(`Booking group lookup failed: ${leadError.message}`)
    if (!leadBooking) throw new Error('Booking group lead could not be found')
    trackingBookingId = leadBooking.id
  }
  const reference = booking.order_group_reference ?? booking.reference
  if (booking.customer_phone_e164 || !booking.customer_id) {
    return { booking, phone: booking.customer_phone_e164 ?? null, trackingBookingId, reference }
  }
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('phone_e164')
    .eq('id', booking.customer_id)
    .maybeSingle()
  if (profileError) throw new Error(`Customer phone lookup failed: ${profileError.message}`)
  return { booking, phone: profile?.phone_e164 ?? null, trackingBookingId, reference }
}

export async function notifyCustomerOfAssignment(booking: AssignedBooking) {
  const [contact, vehicleResult, driverResult] = await Promise.all([
    loadBookingContact(booking.id),
    booking.vehicle_id ? supabase.from('vehicles').select('registration_number').eq('id', booking.vehicle_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
    booking.driver_id ? supabase.from('drivers').select('name').eq('id', booking.driver_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
  ])
  const queryError = vehicleResult.error ?? driverResult.error
  if (queryError) throw new Error(`Assignment notification lookup failed: ${queryError.message}`)
  const { token } = await getOrCreateTrackingToken(contact?.trackingBookingId ?? booking.id)
  const email = await loadCustomerEmail(booking.customer_id)

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

  const reference = contact?.reference ?? booking.order_group_reference ?? booking.reference ?? booking.id
  const message = `Urban Tanker ${reference}: ${detail} Live tracking: ${trackingUrl}${customerMapUrl ? ` Delivery location: ${customerMapUrl}` : ''}`
  const providerResults = await notifyUser({ email: email ?? undefined }, 'Your Urban Tanker fleet is assigned', message)
  const whatsapp = await notifyCustomerWhatsApp(
    contact?.phone ?? booking.customer_phone_e164,
    'vendor_acceptance',
    {
      reference,
      vehicle,
      driver,
      trackingUrl,
    },
  )
  return { vehicle, driver, trackingUrl, providerResults, whatsapp }
}

export async function notifyCustomerOfBooking(phoneE164: string | null | undefined, bookingId: string, reference: string) {
  try {
    const contact = await loadBookingContact(bookingId)
    if (!contact) return { queued: false, reason: 'Booking not found' }
    const recipient = phoneE164 || contact.phone
    const { token } = await getOrCreateTrackingToken(contact.trackingBookingId)
    const confirmationReference = contact.reference ?? reference
    const trackingUrl = `${config.FRONTEND_ORIGIN}/track/${token}`
    let whatsapp: Awaited<ReturnType<typeof notifyCustomerWhatsApp>> = {
      queued: false,
      reason: recipient ? 'Tracking confirmation already sent' : 'No phone',
    }
    if (recipient) {
      try {
        const claimedAt = new Date().toISOString()
        const { data: claimed, error: claimError } = await supabase
          .from('bookings')
          .update({ tracking_confirmation_sent_at: claimedAt })
          .eq('id', contact.trackingBookingId)
          .is('tracking_confirmation_sent_at', null)
          .select('id')
          .maybeSingle()
        if (claimError) throw new Error(`Tracking confirmation claim failed: ${claimError.message}`)
        if (claimed) {
          whatsapp = await notifyCustomerWhatsApp(recipient, 'guest_booking_confirmation', {
            reference: confirmationReference,
            trackingUrl,
          })
          if (!whatsapp.queued) {
            const { error: releaseError } = await supabase
              .from('bookings')
              .update({ tracking_confirmation_sent_at: null })
              .eq('id', contact.trackingBookingId)
              .eq('tracking_confirmation_sent_at', claimedAt)
            if (releaseError) logger.warn('booking.tracking_confirmation_claim_release_failed', {
              bookingId,
              error: releaseError.message,
            })
          }
        }
      } catch (error) {
        logger.warn('booking.tracking_confirmation_failed', {
          bookingId,
          error: errorMessage(error),
        })
      }
    }
    const email = await notifyBookingConfirmationEmail(
      bookingId,
      contact.booking.customer_id,
      contact.trackingBookingId,
      confirmationReference,
      trackingUrl,
    )
    return { queued: whatsapp.queued || email.queued, whatsapp, email }
  } catch (error) {
    logger.warn('booking.tracking_confirmation_failed', {
      bookingId,
      error: errorMessage(error),
    })
    return { queued: false, reason: 'Tracking confirmation failed' }
  }
}

async function notifyBookingConfirmationEmail(
  bookingId: string,
  customerId: string | null,
  trackingBookingId: string,
  reference: string,
  trackingUrl: string,
) {
  const subject = `Your Urban Tanker booking ${reference} is confirmed`
  const message = `Urban Tanker: Your booking ${reference} is confirmed. Track your order: ${trackingUrl}`
  let claimedAt: string | undefined
  try {
    const email = await loadCustomerEmail(customerId)
    if (!email) return { queued: false, reason: 'No customer email' }

    claimedAt = new Date().toISOString()
    const { data: claimed, error: claimError } = await supabase
      .from('bookings')
      .update({ tracking_confirmation_email_sent_at: claimedAt })
      .eq('id', trackingBookingId)
      .is('tracking_confirmation_email_sent_at', null)
      .select('id')
      .maybeSingle()
    if (claimError) throw new Error(`Booking confirmation email claim failed: ${claimError.message}`)
    if (!claimed) return { queued: false, reason: 'Booking confirmation email already sent' }

    const [result] = await notifyUser({ email }, subject, message)
    if (!result.queued) {
      logger.warn('booking.email_not_queued', {
        bookingId,
        event: 'confirmation',
        reason: result.reason ?? 'Email delivery was not queued',
      })
      await releaseBookingConfirmationEmailClaim(bookingId, trackingBookingId, claimedAt)
      claimedAt = undefined
    }
    return result
  } catch (error) {
    if (claimedAt) await releaseBookingConfirmationEmailClaim(bookingId, trackingBookingId, claimedAt)
    logger.warn('booking.tracking_confirmation_email_failed', {
      bookingId,
      error: errorMessage(error),
    })
    return { queued: false, reason: 'Booking confirmation email failed' }
  }
}

async function releaseBookingConfirmationEmailClaim(
  bookingId: string,
  trackingBookingId: string,
  claimedAt: string,
) {
  try {
    const { error } = await supabase
      .from('bookings')
      .update({ tracking_confirmation_email_sent_at: null })
      .eq('id', trackingBookingId)
      .eq('tracking_confirmation_email_sent_at', claimedAt)
    if (error) logger.warn('booking.tracking_confirmation_email_claim_release_failed', {
      bookingId,
      error: error.message,
    })
  } catch (error) {
    logger.warn('booking.tracking_confirmation_email_claim_release_failed', {
      bookingId,
      error: errorMessage(error),
    })
  }
}

export async function notifyCustomerOfBookingWhatsApp(
  bookingId: string,
  key: SmsTemplateKey,
  vars: Record<string, string>,
) {
  try {
    const contact = await loadBookingContact(bookingId)
    if (!contact) return { queued: false, reason: 'Booking not found' }
    const reference = contact.reference ?? vars.reference ?? bookingId
    if (key === 'delivery_confirmation') {
      const email = await notifyCustomerEmail(
        bookingId,
        contact.booking.customer_id,
        `Delivery complete for Urban Tanker booking ${reference}`,
        `Urban Tanker: Delivery for booking ${reference} is complete. Thank you for choosing Urban Tanker.`,
        key,
      )
      const whatsapp = await notifyCustomerWhatsApp(contact.phone, key, {
        ...vars,
        reference,
      })
      return { queued: whatsapp.queued || email.queued, whatsapp, email }
    }
    if (!contact.phone) return { queued: false, reason: 'No phone' }
    return await notifyCustomerWhatsApp(contact.phone, key, {
      reference,
      ...vars,
    })
  } catch (error) {
    logger.warn('booking.whatsapp_notification_failed', {
      bookingId,
      template: key,
      error: error instanceof Error ? error.message : 'Unknown error',
    })
    return { queued: false, reason: 'WhatsApp notification failed' }
  }
}

export async function notifyCustomerOfBookingStatus(
  bookingId: string,
  event: CustomerBookingUpdate,
) {
  try {
    const contact = await loadBookingContact(bookingId)
    if (!contact) return { queued: false, reason: 'Booking not found' }
    const { token } = await getOrCreateTrackingToken(contact.trackingBookingId)
    const update = customerBookingUpdates[event]
    const reference = contact.reference ?? bookingId
    const trackingUrl = `${config.FRONTEND_ORIGIN}/track/${token}`
    const subject = `Your Urban Tanker booking ${reference}: ${update.status}`
    const message = `Urban Tanker: Booking ${reference} update: ${update.status}. ${update.detail} Track your booking: ${trackingUrl}`
    const [whatsapp, email] = await Promise.all([
      notifyCustomerWhatsApp(contact.phone, 'booking_status_update', {
        reference,
        status: update.status,
        detail: update.detail,
        trackingUrl,
      }),
      notifyCustomerEmail(bookingId, contact.booking.customer_id, subject, message, event),
    ])
    return { queued: whatsapp.queued || email.queued, whatsapp, email }
  } catch (error) {
    logger.warn('booking.status_notification_failed', {
      bookingId,
      event,
      error: errorMessage(error),
    })
    return { queued: false, reason: 'Booking status notification failed' }
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
