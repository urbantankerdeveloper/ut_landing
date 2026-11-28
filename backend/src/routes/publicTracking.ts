import { Router } from 'express'
import crypto from 'node:crypto'
import rateLimit from 'express-rate-limit'
import { z } from 'zod'
import { supabase } from '../supabase.js'
import { hashTrackingToken } from '../services/trackingTokens.js'
import { resolveTrackingLocation } from '../services/trackingLocation.js'
import { config } from '../config.js'
import { limiterStore } from '../services/scaling.js'
import { toE164IndianMobile } from '../lib/phone.js'
import { hashOtp, otpMatches } from '../services/otp.js'
import { sendTemplateSms } from '../services/sms.js'
import { sendTemplateWhatsApp } from '../services/whatsapp.js'
import { logger } from '../lib/logger.js'

const router = Router()
const requestTrackingOtpLimit = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  store: limiterStore('rl:public-tracking:otp-request:', 'open'),
  passOnStoreError: true,
  message: { error: 'Too many tracking verification requests. Try again later.' },
})
const verifyTrackingOtpLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  store: limiterStore('rl:public-tracking:otp-verify:', 'open'),
  passOnStoreError: true,
  message: { error: 'Too many tracking verification attempts. Try again later.' },
})
const orderReferenceSchema = z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9-]+$/).transform((value) => value.toUpperCase())
const phoneSchema = z.string().regex(/^\d{10}$/)
const trackingRequestSchema = z.object({ reference: orderReferenceSchema, phone: phoneSchema })
const trackingVerifySchema = trackingRequestSchema.extend({
  challengeId: z.string().uuid(),
  otp: z.string().regex(/^\d{6}$/),
})
const trackingDetailsSchema = z.object({ reference: orderReferenceSchema, accessToken: z.string().min(20).max(512) })
const trackingOtpTemplate = 'booking_verification_otp'
const trackingOtpTtlSeconds = 5 * 60
const trackingAccessTtlSeconds = 15 * 60

// The driver is named only while the delivery is in progress.
const driverVisibleStatuses = ['vendor_assigned', 'accepted', 'en_route', 'arrived']
// After arrival the location is rounded to about 110 m.
const coarseLocationStatuses = ['arrived', 'delivered']

export function publicDriverName(status: string, name: string | null | undefined) {
  if (!driverVisibleStatuses.includes(status)) return null
  return name?.trim().split(/\s+/)[0] || null
}

export function publicCoordinate(
  value: number,
  status: string,
  source: 'live' | 'registered' = 'live',
) {
  if (source === 'registered') return Math.round(value * 100) / 100
  return coarseLocationStatuses.includes(status) ? Math.round(value * 1000) / 1000 : value
}

function createTrackingAccessToken(bookingId: string) {
  const expiresAt = Math.floor(Date.now() / 1000) + trackingAccessTtlSeconds
  const payload = Buffer.from(`${bookingId}.${expiresAt}`).toString('base64url')
  const signature = crypto.createHmac('sha256', config.OTP_HMAC_SECRET).update(payload).digest('base64url')
  return { accessToken: `${payload}.${signature}`, expiresAt: new Date(expiresAt * 1000).toISOString() }
}

function trackingBookingIdFromToken(token: string) {
  const [payload, signature, extra] = token.split('.')
  if (!payload || !signature || extra !== undefined) return null
  const expected = crypto.createHmac('sha256', config.OTP_HMAC_SECRET).update(payload).digest()
  let received: Buffer
  try { received = Buffer.from(signature, 'base64url') } catch { return null }
  if (received.length !== expected.length || !crypto.timingSafeEqual(received, expected)) return null
  let decoded: string
  try { decoded = Buffer.from(payload, 'base64url').toString('utf8') } catch { return null }
  const separator = decoded.lastIndexOf('.')
  if (separator < 0) return null
  const bookingId = decoded.slice(0, separator)
  const expiresAt = Number(decoded.slice(separator + 1))
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(bookingId)) return null
  if (!Number.isInteger(expiresAt) || expiresAt <= Date.now() / 1000) return null
  return bookingId
}

async function loadPublicTracking(booking: {
  id: string
  reference: string
  status: string
  service_code: string
  scheduled_for: string | null
  vehicle_id: string | null
  driver_id: string | null
}) {
  const [eventsResult, locationResult, vehicleResult, driverResult, serviceResult] = await Promise.all([
    supabase.from('booking_events').select('from_status,to_status,note,created_at').eq('booking_id', booking.id).order('created_at', { ascending: true }),
    supabase.from('vendor_location_updates').select('latitude,longitude,accuracy_metres,recorded_at').eq('booking_id', booking.id).order('recorded_at', { ascending: false }).limit(1).maybeSingle(),
    booking.vehicle_id ? supabase.from('vehicles').select('registration_number').eq('id', booking.vehicle_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
    booking.driver_id && driverVisibleStatuses.includes(booking.status) ? supabase.from('drivers').select('name,latitude,longitude').eq('id', booking.driver_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
    supabase.from('service_catalog').select('name').eq('code', booking.service_code).maybeSingle(),
  ])
  const queryError = eventsResult.error ?? locationResult.error ?? vehicleResult.error ?? driverResult.error ?? serviceResult.error
  if (queryError) return { error: true as const }

  const lastLocation = resolveTrackingLocation(
    booking.status,
    locationResult.data && {
      latitude: locationResult.data.latitude,
      longitude: locationResult.data.longitude,
      accuracy: locationResult.data.accuracy_metres,
      recordedAt: locationResult.data.recorded_at,
    },
    driverResult.data && {
      latitude: driverResult.data.latitude,
      longitude: driverResult.data.longitude,
    },
  )

  return {
    error: false as const,
    tracking: {
      bookingReference: booking.reference,
      status: booking.status,
      serviceName: serviceResult.data?.name ?? booking.service_code,
      expectedDelivery: booking.scheduled_for,
      vehicle: vehicleResult.data?.registration_number ?? null,
      driver: publicDriverName(booking.status, driverResult.data?.name),
      lastLocation: lastLocation ? {
        latitude: publicCoordinate(lastLocation.latitude, booking.status, lastLocation.source),
        longitude: publicCoordinate(lastLocation.longitude, booking.status, lastLocation.source),
        accuracy: lastLocation.accuracy,
        recordedAt: lastLocation.recordedAt,
        source: lastLocation.source,
      } : null,
      events: (eventsResult.data ?? []).map((event) => ({
        status: event.to_status,
        note: event.note,
        createdAt: event.created_at,
      })),
      trackingAvailable: lastLocation !== null,
    },
  }
}

router.post('/tracking/request-otp', requestTrackingOtpLimit, async (request, response) => {
  response.setHeader('Cache-Control', 'no-store')
  const parsed = trackingRequestSchema.safeParse(request.body)
  if (!parsed.success) return response.status(400).json({ error: 'Enter the order reference and a valid 10-digit phone number.' })
  const phone = toE164IndianMobile(parsed.data.phone)
  if (!phone) return response.status(400).json({ error: 'Enter the order reference and a valid 10-digit phone number.' })

  const { data: booking, error: bookingError } = await supabase
    .from('bookings')
    .select('id')
    .eq('reference', parsed.data.reference)
    .eq('customer_phone_e164', phone)
    .maybeSingle()
  if (bookingError) return response.status(500).json({ error: 'Tracking verification could not be started. Try again shortly.' })

  let challengeId: string = crypto.randomUUID()
  if (booking) {
    const otp = config.USE_DEFAULT_VERIFICATION_CODE
      ? config.DEFAULT_VERIFICATION_CODE
      : crypto.randomInt(100000, 1000000).toString()
    const { data: challenges, error: challengeError } = await supabase.rpc('claim_guest_otp_challenge', {
      p_phone_e164: phone,
      p_template_key: trackingOtpTemplate,
      p_otp_hash: hashOtp(otp),
      p_expires_at: new Date(Date.now() + trackingOtpTtlSeconds * 1000).toISOString(),
      p_resend_after_seconds: 30,
      p_user_id: null,
    })
    const challenge = (challenges as Array<{ challenge_id: string; delivery_channel: string | null; is_new: boolean }> | null)?.[0]
    if (challengeError || !challenge) return response.status(500).json({ error: 'Tracking verification could not be started. Try again shortly.' })
    challengeId = challenge.challenge_id

    if (challenge.is_new) {
      let channel: 'whatsapp' | 'sms' | null = config.USE_DEFAULT_VERIFICATION_CODE ? 'whatsapp' : null
      if (!config.USE_DEFAULT_VERIFICATION_CODE) {
        try {
          const whatsapp = await sendTemplateWhatsApp(trackingOtpTemplate, phone, { otp })
          if (whatsapp.queued) channel = 'whatsapp'
        } catch (error) {
          logger.warn('public_tracking.otp_whatsapp_failed', { error: error instanceof Error ? error.message : 'unknown' })
        }
        if (!channel && config.featureFlags.otp_sms_fallback_enabled) {
          try {
            const sms = await sendTemplateSms(trackingOtpTemplate, phone, { otp })
            if (sms.queued) channel = 'sms'
          } catch (error) {
            logger.warn('public_tracking.otp_sms_failed', { error: error instanceof Error ? error.message : 'unknown' })
          }
        }
      }
      if (!channel) {
        await supabase.from('guest_otp_challenges').delete().eq('id', challengeId)
        return response.status(503).json({ error: 'The verification code could not be delivered. Try again shortly.' })
      }
      const { error: updateError } = await supabase
        .from('guest_otp_challenges')
        .update({ delivery_channel: channel })
        .eq('id', challengeId)
      if (updateError) return response.status(500).json({ error: 'Tracking verification could not be started. Try again shortly.' })
    } else if (challenge.delivery_channel !== 'whatsapp' && challenge.delivery_channel !== 'sms') {
      return response.status(503).json({ error: 'The verification code is still being prepared. Try again shortly.' })
    }
  }

  response.status(202).json({
    challengeId,
    expiresInSeconds: trackingOtpTtlSeconds,
    message: 'If the order reference and phone number match, a verification code has been sent.',
  })
})

router.post('/tracking/verify-otp', verifyTrackingOtpLimit, async (request, response) => {
  response.setHeader('Cache-Control', 'no-store')
  const parsed = trackingVerifySchema.safeParse(request.body)
  if (!parsed.success) return response.status(400).json({ error: 'The order reference, phone number, and verification code could not be verified.' })
  const phone = toE164IndianMobile(parsed.data.phone)
  if (!phone) return response.status(400).json({ error: 'The order reference, phone number, and verification code could not be verified.' })

  const { data: booking, error: bookingError } = await supabase
    .from('bookings')
    .select('id,reference,status,service_code,scheduled_for,vehicle_id,driver_id')
    .eq('reference', parsed.data.reference)
    .eq('customer_phone_e164', phone)
    .maybeSingle()
  if (bookingError) return response.status(500).json({ error: 'Tracking details could not be loaded. Try again shortly.' })
  if (!booking) return response.status(400).json({ error: 'The order reference, phone number, and verification code could not be verified.' })

  const { data: attempts, error: attemptError } = await supabase.rpc('consume_guest_otp_attempt', {
    p_challenge_id: parsed.data.challengeId,
    p_phone: phone,
  })
  if (attemptError) return response.status(500).json({ error: 'The verification could not be completed. Try again shortly.' })
  const challenge = (attempts as Array<{ otp_hash: string }> | null)?.[0]
  if (!challenge || !otpMatches(challenge.otp_hash, parsed.data.otp)) {
    return response.status(400).json({ error: 'The order reference, phone number, and verification code could not be verified.' })
  }
  const { data: verifiedChallenge, error: verifyError } = await supabase
    .from('guest_otp_challenges')
    .update({ verified_at: new Date().toISOString() })
    .eq('id', parsed.data.challengeId)
    .eq('phone_e164', phone)
    .eq('template_key', trackingOtpTemplate)
    .is('user_id', null)
    .is('verified_at', null)
    .gt('expires_at', new Date().toISOString())
    .select('id')
    .maybeSingle()
  if (verifyError) return response.status(500).json({ error: 'The verification could not be completed. Try again shortly.' })
  if (!verifiedChallenge) return response.status(400).json({ error: 'The order reference, phone number, and verification code could not be verified.' })

  const tracking = await loadPublicTracking(booking)
  if (tracking.error) return response.status(500).json({ error: 'Tracking details could not be loaded. Try again shortly.' })
  const access = createTrackingAccessToken(booking.id)
  response.json({ ...tracking.tracking, ...access })
})

router.post('/tracking/details', async (request, response) => {
  response.setHeader('Cache-Control', 'no-store')
  const parsed = trackingDetailsSchema.safeParse(request.body)
  if (!parsed.success) return response.status(401).json({ error: 'Tracking access has expired. Verify your phone number again.' })
  const bookingId = trackingBookingIdFromToken(parsed.data.accessToken)
  if (!bookingId) return response.status(401).json({ error: 'Tracking access has expired. Verify your phone number again.' })
  const { data: booking, error: bookingError } = await supabase
    .from('bookings')
    .select('id,reference,status,service_code,scheduled_for,vehicle_id,driver_id')
    .eq('id', bookingId)
    .eq('reference', parsed.data.reference)
    .maybeSingle()
  if (bookingError) return response.status(500).json({ error: 'Tracking details could not be loaded. Try again shortly.' })
  if (!booking) return response.status(404).json({ error: 'Tracking details are no longer available.' })
  const tracking = await loadPublicTracking(booking)
  if (tracking.error) return response.status(500).json({ error: 'Tracking details could not be loaded. Try again shortly.' })
  response.json(tracking.tracking)
})

router.get('/tracking/:token', async (request, response) => {
  const token = request.params.token
  if (!/^[A-Za-z0-9_-]{40,60}$/.test(token)) return response.status(404).json({ error: 'Tracking link not found' })

  const { data: booking, error: bookingError } = await supabase
    .from('bookings')
    .select('id,reference,status,service_code,scheduled_for,vehicle_id,driver_id,tracking_token_expires_at')
    .or(`tracking_token_hash.eq.${hashTrackingToken(token)},tracking_token_v2_hash.eq.${hashTrackingToken(token)}`)
    .maybeSingle()
  if (bookingError) return response.status(500).json({ error: bookingError.message })
  if (!booking || !booking.tracking_token_expires_at || new Date(booking.tracking_token_expires_at).getTime() <= Date.now()) {
    return response.status(404).json({ error: 'Tracking link not found or expired' })
  }

  const result = await loadPublicTracking(booking)
  if (result.error) return response.status(500).json({ error: 'Tracking details could not be loaded.' })
  response.json(result.tracking)
})

export default router
