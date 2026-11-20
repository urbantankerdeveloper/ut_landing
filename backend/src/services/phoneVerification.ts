import { config } from '../config.js'
import { logger } from '../lib/logger.js'

export function isPhoneVerificationRequired(now = Date.now()) {
  const deadline = config.PHONE_VERIFY_REQUIRED_AFTER
  return config.PHONE_VERIFY_DIALOG_ENABLED && Boolean(deadline && Date.parse(deadline) <= now)
}

export function isPhoneVerified(profile: { phone_verified?: boolean | null; phone_verified_at?: string | null }) {
  return profile.phone_verified === true || Boolean(profile.phone_verified_at)
}

export function maskedIndianPhone(phone: string) {
  return `+91******${phone.replace(/\D/g, '').slice(-4)}`
}

export function logPhoneVerificationAudit(event: {
  action: string
  userId: string
  phone?: string
  ip?: string
  details?: Record<string, unknown>
}) {
  logger.info('phone_verification.audit', {
    action: event.action,
    userId: event.userId,
    phone: event.phone ? maskedIndianPhone(event.phone) : null,
    timestamp: new Date().toISOString(),
    ip: event.ip ?? null,
    ...event.details,
  })
}
