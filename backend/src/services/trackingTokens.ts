import crypto from 'node:crypto'
import { config } from '../config.js'
import { supabase } from '../supabase.js'

const TOKEN_TTL_DAYS = 30

function hashToken(token: string) {
  return crypto.createHash('sha256').update(token).digest('hex')
}

function createTrackingToken(bookingId: string) {
  return crypto
    .createHmac('sha256', config.OTP_HMAC_SECRET)
    .update(`booking-tracking:${bookingId}`)
    .digest('base64url')
}

export async function getOrCreateTrackingToken(bookingId: string) {
  const token = createTrackingToken(bookingId)
  const expiresAt = new Date(Date.now() + TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString()
  const { error } = await supabase
    .from('bookings')
    .update({ tracking_token_v2_hash: hashToken(token), tracking_token_expires_at: expiresAt })
    .eq('id', bookingId)
  if (error) throw new Error(`Tracking token creation failed: ${error.message}`)
  return { token, expiresAt }
}

export function hashTrackingToken(token: string) {
  return hashToken(token)
}
