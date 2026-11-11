import { logger } from '../lib/logger.js'
import { supabase } from '../supabase.js'
import { emitRealtimeToVendor } from './realtime.js'
import { sendPushNotification } from './pushNotifications.js'
import { sendTemplateSms } from './sms.js'

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

    const detail = `Booking ${reference} is paid online. Do not collect cash from the customer.`
    const vendor = vendorResult.data
    if (vendor?.owner_profile_id) {
      const { error: insertError } = await supabase.from('notifications').insert({
        recipient_id: vendor.owner_profile_id,
        event_type: 'booking_paid_online',
        title: 'Booking paid online',
        payload: { bookingId: booking.id, reference, detail },
      })
      if (insertError) logger.warn('cod_online.vendor_notification_failed', { bookingId, error: insertError.message })
      void sendPushNotification({
        recipientId: vendor.owner_profile_id,
        title: 'Booking paid online',
        body: detail,
        data: { eventType: 'booking_paid_online', bookingId: booking.id },
      }).catch((pushError) => logger.warn('cod_online.vendor_push_failed', { bookingId, error: pushError instanceof Error ? pushError.message : 'unknown' }))
    }
    if (booking.vendor_id) emitRealtimeToVendor(booking.vendor_id, 'booking.updated', { bookingId: booking.id })

    const recipients = [vendor?.phone_e164, driverResult.data?.mobile_e164].filter((phone): phone is string => Boolean(phone))
    await Promise.all(recipients.map((phone) =>
      sendTemplateSms('cod_switched_to_online', phone, { reference }).catch((smsError) => logger.warn('cod_online.sms_failed', { bookingId, error: smsError instanceof Error ? smsError.message : 'unknown' })),
    ))
  } catch (error) {
    logger.error('cod_online.notification_failed', { bookingId, error: error instanceof Error ? error.message : 'unknown' })
  }
}
