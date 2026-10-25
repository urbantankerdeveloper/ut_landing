import crypto from 'node:crypto'
import { supabase } from '../supabase.js'

const TOKEN_TTL_DAYS = 30

function hashToken(token: string) {
  return crypto.createHash('sha256').update(token).digest('hex')
}

export async function getOrCreateTrackingToken(bookingId: string) {
  const token = crypto.randomBytes(32).toString('base64url')
  const expiresAt = new Date(Date.now() + TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString()
  const { error } = await supabase
    .from('bookings')
    .update({ tracking_token_hash: hashToken(token), tracking_token_expires_at: expiresAt })
    .eq('id', bookingId)
  if (error) throw new Error(`Tracking token creation failed: ${error.message}`)
  return { token, expiresAt }
}

export function hashTrackingToken(token: string) {
  return hashToken(token)
}
