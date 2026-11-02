import crypto from 'node:crypto'
import { config } from '../config.js'

// OTPs are 6 digits, so a plain SHA-256 can be reversed from a database dump. An HMAC keyed by a server-side secret cannot.
export function hashOtp(code: string): string {
  return crypto.createHmac('sha256', config.OTP_HMAC_SECRET).update(code).digest('hex')
}

export function otpMatches(storedHash: string, code: string): boolean {
  const expected = Buffer.from(storedHash, 'hex')
  const received = Buffer.from(hashOtp(code), 'hex')
  return expected.length === received.length && crypto.timingSafeEqual(expected, received)
}
