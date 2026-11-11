import { logger } from '../lib/logger.js'
import { supabase } from '../supabase.js'
import { emitRealtimeToVendor } from './realtime.js'
import { sendPushNotification } from './pushNotifications.js'
import { sendTemplateSms, type SmsTemplateKey } from './sms.js'

// Statuses before the driver starts the trip, so cash has not been collected yet.
export const codSwitchStatuses: string[] = ['pending_vendor', 'vendor_assigned', 'accepted']

type AlertTarget = { id: string; reference: string | null; vendor_id: string | null; driver_id: string | null }
type Alert = { eventType: string; title: string; detail: string; smsTemplate: SmsTemplateKey }

// Vendor gets an in-app notification, push and a realtime event. Vendor and driver both get an SMS.
async function alertVendorAndDriver(booking: AlertTarget, alert: Alert) {
  const reference = booking.reference ?? booking.id
  const [vendorResult, driverResult] = await Promise.all([
    booking.vendor_id
      ? supabase.from('vendors').select('owner_profile_id,phone_e164').eq('id', booking.vendor_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    booking.driver_id
      ? supabase.from('drivers').select('mobile_e164').eq('id', booking.driver_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ])
  if (vendorResult.error) throw new Error(vendorResult.error.message)
  if (driverResult.error) throw new Error(driverResult.error.message)

  const vendor = vendorResult.data
  if (vendor?.owner_profile_id) {
    const { error: insertError } = await supabase.from('notifications').insert({
      recipient_id: vendor.owner_profile_id,
      event_type: alert.eventType,
      title: alert.title,
      payload: { bookingId: booking.id, reference, detail: alert.detail },
    })
    if (insertError) logger.warn('cod_online.vendor_notification_failed', { bookingId: booking.id, error: insertError.message })
    void sendPushNotification({
      recipientId: vendor.owner_profile_id,
      title: alert.title,
      body: alert.detail,
      data: { eventType: alert.eventType, bookingId: booking.id },
    }).catch((pushError) => logger.warn('cod_online.vendor_push_failed', { bookingId: booking.id, error: pushError instanceof Error ? pushError.message : 'unknown' }))
  }
  if (booking.vendor_id) emitRealtimeToVendor(booking.vendor_id, 'booking.updated', { bookingId: booking.id })

  const recipients = [vendor?.phone_e164, driverResult.data?.mobile_e164].filter((phone): phone is string => Boolean(phone))
  await Promise.all(recipients.map((phone) =>
    sendTemplateSms(alert.smsTemplate, phone, { reference }).catch((smsError) => logger.warn('cod_online.sms_failed', { bookingId: booking.id, error: smsError instanceof Error ? smsError.message : 'unknown' })),
  ))
}

// Runs after a capture is recorded. Tells the vendor and driver the booking is paid, so the driver does not collect cash.
// Never throws: a payment that succeeded must not depend on notification delivery.
export async function notifyPaidOnlineAfterCodSwitch(bookingId: string) {
  try {
    const { data: booking, error } = await supabase
      .from('bookings')
      .select('id,reference,vendor_id,driver_id,payment_method,payment_switched_to_online_at')
      .eq('id', bookingId)
      .maybeSingle()
    if (error) throw new Error(error.message)
    if (!booking?.payment_switched_to_online_at || booking.payment_method !== 'gateway') return

    // Claim before sending so the verify and webhook paths can both run without double alerts.
    const { data: claimed, error: claimError } = await supabase
      .from('bookings')
      .update({ cod_online_notified_at: new Date().toISOString() })
      .eq('id', bookingId)
      .is('cod_online_notified_at', null)
      .select('id')
      .maybeSingle()
    if (claimError) throw new Error(claimError.message)
    if (!claimed) return

    await alertVendorAndDriver(booking, {
      eventType: 'booking_paid_online',
      title: 'Booking paid online',
      detail: `Booking ${booking.reference ?? booking.id} is paid online. Do not collect cash from the customer.`,
      smsTemplate: 'cod_switched_to_online',
    })
  } catch (error) {
    logger.error('cod_online.notification_failed', { bookingId, error: error instanceof Error ? error.message : 'unknown' })
  }
}

// Runs after a booking is back on cash on delivery. Tells the vendor and driver to collect cash again.
// Never throws: the revert is already committed when this runs.
export async function notifyRevertedToCash(bookingId: string) {
  try {
    const { data: booking, error } = await supabase
      .from('bookings')
      .select('id,reference,vendor_id,driver_id')
      .eq('id', bookingId)
      .maybeSingle()
    if (error) throw new Error(error.message)
    if (!booking) return
    await alertVendorAndDriver(booking, {
      eventType: 'booking_reverted_to_cash',
      title: 'Booking is cash on delivery',
      detail: `Booking ${booking.reference ?? booking.id} is back to cash on delivery. Collect payment from the customer.`,
      smsTemplate: 'cod_reverted_to_cash',
    })
  } catch (error) {
    logger.error('cod_online.revert_notification_failed', { bookingId, error: error instanceof Error ? error.message : 'unknown' })
  }
}
