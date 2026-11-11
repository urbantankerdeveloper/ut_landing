import { Router, type Request, type Response } from 'express'
import crypto from 'node:crypto'
import { z } from 'zod'
import rateLimit from 'express-rate-limit'
import { authSupabase, supabase } from '../supabase.js'
import { requireAuth } from '../middleware/auth.js'
import { toE164IndianMobile } from '../lib/phone.js'
import { clientPlatformFromHeader, credentialsSchema, themeModeSchema } from '../lib/schemas.js'
import { decodeSelfieJpeg, selfieBucket, selfieObjectPath } from '../services/selfie.js'
import { isEmailConfigured, sendEmail } from '../services/providers.js'
import { sendTemplateSms } from '../services/sms.js'
import { emailCodeEmail, passwordResetEmail } from '../services/signupEmail.js'
import { hashOtp, otpMatches } from '../services/otp.js'
import { config } from '../config.js'
import { logger } from '../lib/logger.js'
import { isAllowedCorsOrigin } from '../lib/corsOrigins.js'
import { limiterStore } from '../services/scaling.js'

const router = Router()
const minute = 60 * 1000
const bcryptPasswordMaxBytes = 72
const unmatchedLoginEmail = 'no-account@login.urbantanker.local'
const invalidCodeMessage = 'This verification code is invalid or expired.'
const incorrectCodeMessage = 'The verification code is incorrect.'
const verificationFailedMessage = 'The verification could not be completed. Try again shortly.'
const adminApprovalPendingMessage = 'Your account is waiting for approval from an existing admin.'
const signupFailedMessage = 'Registration could not be completed. Check your details or sign in to an existing account.'

const otpRequestLimit = rateLimit({ windowMs: 10 * minute, limit: 5, standardHeaders: true, legacyHeaders: false, store: limiterStore('rl:auth:otp-request:', 'memory'), message: { error: 'Too many OTP requests. Try again later.' } })
const otpPhoneLimit = rateLimit({ windowMs: 10 * minute, limit: 3, standardHeaders: true, legacyHeaders: false, store: limiterStore('rl:auth:otp-phone:', 'memory'), keyGenerator: (request) => `phone:${phoneLimitKey(request.body?.phone)}`, message: { error: 'Too many OTP requests for this number. Try again later.' } })
const loginLimit = rateLimit({ windowMs: 15 * minute, limit: 20, standardHeaders: true, legacyHeaders: false, store: limiterStore('rl:auth:login:', 'memory'), message: { error: 'Too many login attempts. Try again later.' } })
const loginAccountLimit = rateLimit({ windowMs: 15 * minute, limit: 10, skipSuccessfulRequests: true, standardHeaders: true, legacyHeaders: false, store: limiterStore('rl:auth:login-account:', 'memory'), keyGenerator: (request) => `account:${loginAccountKey(request.body)}`, message: { error: 'Too many login attempts for this account. Try again later.' } })
const signupLimit = rateLimit({ windowMs: 15 * minute, limit: 5, standardHeaders: true, legacyHeaders: false, store: limiterStore('rl:auth:signup:', 'memory'), message: { error: 'Too many registration attempts. Try again later.' } })
const signupEmailLimit = rateLimit({ windowMs: 60 * minute, limit: 3, standardHeaders: true, legacyHeaders: false, store: limiterStore('rl:auth:signup-email:', 'memory'), keyGenerator: (request) => `signup:${normalizeIdentifier(request.body?.email)}`, message: { error: 'Too many registration emails for this address. Try again later.' } })
const passwordResetLimit = rateLimit({ windowMs: 15 * minute, limit: 5, standardHeaders: true, legacyHeaders: false, store: limiterStore('rl:auth:password-reset:', 'memory'), message: { error: 'Too many password reset requests. Try again later.' } })
const passwordResetEmailLimit = rateLimit({ windowMs: 60 * minute, limit: 3, standardHeaders: true, legacyHeaders: false, store: limiterStore('rl:auth:password-reset-email:', 'memory'), keyGenerator: (request) => `reset:${normalizeIdentifier(request.body?.email)}`, handler: (_request, response) => { response.status(202).json({ accepted: true }) } })
const passwordUpdateLimit = rateLimit({ windowMs: 15 * minute, limit: 10, standardHeaders: true, legacyHeaders: false, store: limiterStore('rl:auth:password-update:', 'memory'), message: { error: 'Too many password update attempts. Try again later.' } })
const phoneOtpVerifyLimit = rateLimit({ windowMs: 15 * minute, limit: 20, standardHeaders: true, legacyHeaders: false, store: limiterStore('rl:auth:phone-otp-verify:', 'memory'), message: { error: 'Too many verification attempts. Try again later.' } })
const emailOtpRequestLimit = rateLimit({ windowMs: 10 * minute, limit: 10, standardHeaders: true, legacyHeaders: false, store: limiterStore('rl:auth:email-otp-request:', 'memory'), message: { error: 'Too many code requests. Try again later.' } })
const emailOtpEmailLimit = rateLimit({ windowMs: 15 * minute, limit: 5, standardHeaders: true, legacyHeaders: false, store: limiterStore('rl:auth:email-otp-email:', 'memory'), keyGenerator: (request) => `email:${normalizeIdentifier(request.body?.email)}`, message: { error: 'Too many codes requested for this email. Try again later.' } })
const emailOtpVerifyLimit = rateLimit({ windowMs: 15 * minute, limit: 20, standardHeaders: true, legacyHeaders: false, store: limiterStore('rl:auth:email-otp-verify:', 'memory'), message: { error: 'Too many verification attempts. Try again later.' } })
const resendConfirmationLimit = rateLimit({ windowMs: 60 * minute, limit: 3, standardHeaders: true, legacyHeaders: false, store: limiterStore('rl:auth:resend-confirmation:', 'memory'), keyGenerator: (request) => `resend:${normalizeIdentifier(request.body?.email)}`, handler: (_request, response) => { response.status(202).json({ accepted: true }) } })

function normalizeIdentifier(value: unknown) {
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
}
function phoneLimitKey(value: unknown) {
  const raw = typeof value === 'string' ? value : ''
  return toE164IndianMobile(raw) ?? raw.replace(/\D/g, '')
}
function loginAccountKey(body: unknown) {
  const source = (typeof body === 'object' && body ? body : {}) as { email?: unknown; username?: unknown }
  return normalizeIdentifier(source.email) || normalizeIdentifier(source.username)
}
export function escapeIlike(value: string) {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`)
}
export function passwordWithinBcryptLimit(value: string) {
  return Buffer.byteLength(value, 'utf8') <= bcryptPasswordMaxBytes
}
export function hashMpinForUser(userId: string, pin: string) {
  return crypto.createHmac('sha256', config.OTP_HMAC_SECRET)
    .update(`urban-tanker:mpin:v1:${userId}:${pin}`)
    .digest('hex')
}
export function refreshTokenForClient(platform: string | undefined, refreshToken: string): { refreshToken?: string } {
  return platform === 'mobile' ? { refreshToken } : {}
}
export function hasRecoveryClaim(accessToken: string) {
  const segment = accessToken.split('.')[1]
  if (!segment) return false
  let claims: unknown
  try {
    claims = JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'))
  } catch {
    return false
  }
  const amr = (claims as { amr?: unknown } | null)?.amr
  return Array.isArray(amr) && amr.some((entry) => entry === 'recovery' || (typeof entry === 'object' && entry !== null && (entry as { method?: unknown }).method === 'recovery'))
}

function parseCookies(header: string | undefined) { return Object.fromEntries((header ?? '').split(';').map((part) => part.trim().split('=').map(decodeURIComponent)).filter(([key, value]) => key && value)) }
const refreshCookieSecurity = config.NODE_ENV === 'production' ? '; Secure' : ''
const refreshCookieSameSite = config.NODE_ENV === 'production' ? 'None' : 'Lax'
function setRefreshCookie(response: Response, token: string) { response.setHeader('Set-Cookie', `refresh_token=${encodeURIComponent(token)}; HttpOnly; Path=/api/auth; SameSite=${refreshCookieSameSite}; Max-Age=2592000${refreshCookieSecurity}`) }
function clearRefreshCookie(response: Response) { response.setHeader('Set-Cookie', `refresh_token=; HttpOnly; Path=/api/auth; SameSite=${refreshCookieSameSite}; Max-Age=0${refreshCookieSecurity}`) }
function originAllowed(request: Request) {
  const origin = request.header('origin')
  return isAllowedCorsOrigin(origin, [config.FRONTEND_ORIGIN, ...config.CORS_ORIGINS], config.NODE_ENV)
}
function refreshTokenFromRequest(request: Request) {
  const bodyToken = typeof request.body?.refreshToken === 'string' ? request.body.refreshToken : undefined
  return bodyToken || parseCookies(request.headers.cookie).refresh_token
}
function bearerToken(request: Request) {
  return request.headers.authorization?.match(/^Bearer\s+(.+)$/i)?.[1]
}
function logFailure(event: string, requestId: unknown, detail?: string) {
  logger.error(event, { requestId, error: detail })
}
function mailErrorCode(error: unknown) {
  const code = (error as { code?: unknown } | null)?.code
  return typeof code === 'string' ? code : 'unknown'
}

const phoneSchema = z.string().regex(/^\d{10}$/)

async function issueOtpChallenge(response: Response, phone: string, template: 'booking_verification_otp' | 'user_registration_otp') {
  const otp = config.USE_DEFAULT_VERIFICATION_CODE ? config.DEFAULT_VERIFICATION_CODE : crypto.randomInt(100000, 1000000).toString()
  const { data: challenge, error } = await supabase
    .from('guest_otp_challenges')
    .insert({ phone_e164: phone, otp_hash: hashOtp(otp), expires_at: new Date(Date.now() + 10 * minute).toISOString() })
    .select('id')
    .single()
  if (error || !challenge) {
    logFailure('otp.challenge_create_failed', response.locals.requestId, error?.message)
    return response.status(500).json({ error: 'OTP could not be created.' })
  }
  if (!config.USE_DEFAULT_VERIFICATION_CODE) {
    try {
      const delivery = await sendTemplateSms(template, phone, { otp })
      if (!delivery.queued) {
        await supabase.from('guest_otp_challenges').delete().eq('id', challenge.id)
        return response.status(503).json({ error: 'Mobile verification is not configured yet.' })
      }
    } catch (deliveryError) {
      logFailure('otp.delivery_failed', response.locals.requestId, deliveryError instanceof Error ? deliveryError.message : undefined)
      await supabase.from('guest_otp_challenges').delete().eq('id', challenge.id)
      return response.status(502).json({ error: 'OTP delivery failed.' })
    }
  }
  return response.status(202).json({ challengeId: challenge.id, expiresInSeconds: 600, resendAfterSeconds: emailCodeResendAfterSeconds })
}

// Signup never fails because of SMS. When SMS is not configured the phone leg is reported as not sent and the email flow continues.
async function sendPhoneOtpBestEffort(requestId: unknown, phone: string, template: 'booking_verification_otp' | 'user_registration_otp' = 'user_registration_otp'): Promise<{ sent: boolean; challengeId: string | null }> {
  const otp = config.USE_DEFAULT_VERIFICATION_CODE ? config.DEFAULT_VERIFICATION_CODE : crypto.randomInt(100000, 1000000).toString()
  const { data: challenge, error } = await supabase
    .from('guest_otp_challenges')
    .insert({ phone_e164: phone, otp_hash: hashOtp(otp), expires_at: new Date(Date.now() + 10 * minute).toISOString() })
    .select('id')
    .single()
  if (error || !challenge) {
    logFailure('signup.phone_challenge_failed', requestId, error?.message)
    return { sent: false, challengeId: null }
  }
  if (config.USE_DEFAULT_VERIFICATION_CODE) return { sent: true, challengeId: challenge.id }
  try {
    const delivery = await sendTemplateSms(template, phone, { otp })
    if (delivery.queued) return { sent: true, challengeId: challenge.id }
    logFailure('signup.phone_not_sent', requestId, 'reason' in delivery ? delivery.reason : undefined)
  } catch (deliveryError) {
    logFailure('signup.phone_delivery_failed', requestId, deliveryError instanceof Error ? deliveryError.message : undefined)
  }
  await supabase.from('guest_otp_challenges').delete().eq('id', challenge.id)
  return { sent: false, challengeId: null }
}

// The attempt counter is incremented atomically in SQL before the code is compared, so guesses cannot race past the limit.
async function passesChallengeAttempt(response: Response, challengeId: string, phone: string, otp: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('consume_guest_otp_attempt', { p_challenge_id: challengeId, p_phone: phone })
  if (error) {
    logFailure('otp.attempt_failed', response.locals.requestId, error.message)
    response.status(500).json({ error: verificationFailedMessage })
    return false
  }
  const row = (data as Array<{ otp_hash: string }> | null)?.[0]
  if (!row) {
    response.status(400).json({ error: invalidCodeMessage })
    return false
  }
  if (!otpMatches(row.otp_hash, otp)) {
    response.status(400).json({ error: incorrectCodeMessage })
    return false
  }
  return true
}

async function markChallengeVerified(response: Response, challengeId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('guest_otp_challenges')
    .update({ verified_at: new Date().toISOString() })
    .eq('id', challengeId)
    .is('verified_at', null)
    .gt('expires_at', new Date().toISOString())
    .select('id')
    .maybeSingle()
  if (error) {
    logFailure('otp.consume_failed', response.locals.requestId, error.message)
    response.status(500).json({ error: verificationFailedMessage })
    return false
  }
  if (!data) {
    response.status(400).json({ error: invalidCodeMessage })
    return false
  }
  return true
}

type EmailCodePurpose = 'sign_in' | 'signup' | 'link' | 'booking'
type EmailChallengeRow = { otp_hash: string; purpose: EmailCodePurpose; user_id: string | null }
type AuthUserLookup = { user: { id: string; email_confirmed: boolean } | null; error: string | null }

const emailCodeExpiresInSeconds = 600
const emailCodeResendAfterSeconds = 30
const emailSchema = z.string().trim().toLowerCase().email()
const emailCodeSchema = z.string().regex(/^\d{6}$/)

async function authUserForEmail(email: string): Promise<AuthUserLookup> {
  const { data, error } = await supabase.rpc('auth_user_by_email', { p_email: email })
  if (error) return { user: null, error: error.message }
  return { user: (data as Array<{ id: string; email_confirmed: boolean }> | null)?.[0] ?? null, error: null }
}

type IssuedEmailCode = { ok: true; challengeId: string } | { ok: false; status: number; error: string }

async function issueEmailCode(requestId: unknown, email: string, purpose: EmailCodePurpose, userId: string | null): Promise<IssuedEmailCode> {
  if (!isEmailConfigured()) return { ok: false, status: 503, error: 'Email sign-in is unavailable right now.' }
  const otp = config.USE_DEFAULT_VERIFICATION_CODE ? config.DEFAULT_VERIFICATION_CODE : crypto.randomInt(100000, 1000000).toString()
  const { data: challenge, error } = await supabase
    .from('email_otp_challenges')
    .insert({ email, purpose, user_id: userId, otp_hash: hashOtp(otp), expires_at: new Date(Date.now() + emailCodeExpiresInSeconds * 1000).toISOString() })
    .select('id')
    .single()
  if (error || !challenge) {
    logFailure('email.challenge_create_failed', requestId, error?.message)
    return { ok: false, status: 500, error: 'The verification code could not be created.' }
  }
  // Same as SMS: the default-code mode skips real delivery (local and test only, enforced in config).
  if (config.USE_DEFAULT_VERIFICATION_CODE) return { ok: true, challengeId: challenge.id }
  const template = emailCodeEmail(otp, purpose)
  try {
    const delivery = await sendEmail(email, template.subject, template.html)
    if (!delivery.queued) throw new Error(delivery.reason)
  } catch (deliveryError) {
    await supabase.from('email_otp_challenges').delete().eq('id', challenge.id)
    logFailure('email.delivery_failed', requestId, deliveryError instanceof Error ? deliveryError.message : undefined)
    return { ok: false, status: 502, error: 'The verification email could not be sent. Try again shortly.' }
  }
  return { ok: true, challengeId: challenge.id }
}

// Same atomic attempt counting as the phone code. The purpose list is checked in SQL, so a signup code cannot be used for linking and the reverse.
async function consumeEmailChallenge(response: Response, challengeId: string, email: string, purposes: EmailCodePurpose[], otp: string): Promise<EmailChallengeRow | null> {
  const { data, error } = await supabase.rpc('consume_email_otp_attempt', { p_challenge_id: challengeId, p_email: email, p_purposes: purposes })
  if (error) {
    logFailure('email.attempt_failed', response.locals.requestId, error.message)
    response.status(500).json({ error: verificationFailedMessage })
    return null
  }
  const row = (data as EmailChallengeRow[] | null)?.[0]
  if (!row) {
    response.status(400).json({ error: invalidCodeMessage })
    return null
  }
  if (!otpMatches(row.otp_hash, otp)) {
    response.status(400).json({ error: incorrectCodeMessage })
    return null
  }
  return row
}

async function markEmailChallengeVerified(response: Response, challengeId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('email_otp_challenges')
    .update({ verified_at: new Date().toISOString() })
    .eq('id', challengeId)
    .is('verified_at', null)
    .gt('expires_at', new Date().toISOString())
    .select('id')
    .maybeSingle()
  if (error) {
    logFailure('email.consume_failed', response.locals.requestId, error.message)
    response.status(500).json({ error: verificationFailedMessage })
    return false
  }
  if (!data) {
    response.status(400).json({ error: invalidCodeMessage })
    return false
  }
  return true
}

async function magicLinkSession(response: Response, email: string): Promise<{ accessToken: string; refreshToken: string; user: { id: string; email?: string | null } } | null> {
  const { data: link, error: linkError } = await authSupabase.auth.admin.generateLink({ type: 'magiclink', email })
  const tokenHash = link?.properties?.hashed_token
  if (linkError || !tokenHash) {
    logFailure('email.magiclink_failed', response.locals.requestId, linkError?.message)
    response.status(500).json({ error: 'A sign-in session could not be created.' })
    return null
  }
  const { data: verified, error: verifyError } = await authSupabase.auth.verifyOtp({ token_hash: tokenHash, type: 'magiclink' })
  if (verifyError || !verified.session || !verified.user) {
    logFailure('email.magiclink_verify_failed', response.locals.requestId, verifyError?.message)
    response.status(500).json({ error: 'A sign-in session could not be created.' })
    return null
  }
  return { accessToken: verified.session.access_token, refreshToken: verified.session.refresh_token, user: { id: verified.user.id, email: verified.user.email } }
}

function sendSignedInUser(request: Request, response: Response, session: { accessToken: string; refreshToken: string }, authUser: { id: string; email?: string | null }, profile: ProfileRow, fallbackUsername: string) {
  setRefreshCookie(response, session.refreshToken)
  return response.json({
    accessToken: session.accessToken,
    ...refreshTokenForClient(request.header('x-client-platform'), session.refreshToken),
    user: {
      id: authUser.id,
      email: authUser.email,
      username: profile.username ?? authUser.email ?? fallbackUsername,
      name: profile.full_name,
      role: profile.role,
      themeMode: profile.theme_mode ?? 'system',
      selfieRequired: profile.selfie_required === true,
    },
  })
}

type ProfileRow = {
  id: string
  role: string
  full_name: string
  username: string | null
  phone_e164: string | null
  theme_mode: string | null
  selfie_required: boolean | null
  approval_status: string | null
}

router.post('/guest/request-otp', otpRequestLimit, otpPhoneLimit, async (request, response) => {
  const parsed = z.object({ phone: phoneSchema, email: emailSchema.optional() }).safeParse(request.body)
  if (!parsed.success) return response.status(400).json({ error: 'Enter a valid 10-digit mobile number.' })
  const phone = toE164IndianMobile(parsed.data.phone)
  if (!phone) return response.status(400).json({ error: 'Enter a valid 10-digit mobile number.' })
  if (!parsed.data.email) return issueOtpChallenge(response, phone, 'booking_verification_otp')

  // With an email, the code goes to both channels. When SMS is off, the email code alone verifies the booking.
  const phoneCode = await sendPhoneOtpBestEffort(response.locals.requestId, phone, 'booking_verification_otp')
  const emailCode = await issueEmailCode(response.locals.requestId, parsed.data.email, 'booking', null)
  if (!phoneCode.sent && !emailCode.ok) {
    return response.status(503).json({ error: 'Verification codes could not be sent. Check your mobile number and email, then try again.' })
  }
  return response.status(202).json({
    challengeId: phoneCode.challengeId,
    phoneOtpSent: phoneCode.sent,
    emailChallengeId: emailCode.ok ? emailCode.challengeId : null,
    emailOtpSent: emailCode.ok,
    expiresInSeconds: emailCodeExpiresInSeconds,
  })
})

router.post('/booking/email-fallback', requireAuth, otpRequestLimit, otpPhoneLimit, async (request, response) => {
  const parsed = z.object({ phone: phoneSchema }).safeParse(request.body)
  if (!parsed.success) return response.status(400).json({ error: 'Enter a valid 10-digit mobile number.' })
  const phone = toE164IndianMobile(parsed.data.phone)
  if (!phone) return response.status(400).json({ error: 'Enter a valid 10-digit mobile number.' })

  const user = request.authUser!
  const email = user.email?.trim().toLowerCase()
  if (!email || !user.email_confirmed_at || email.endsWith('@guest.urbantanker.local')) {
    return response.status(403).json({ error: 'Email verification is unavailable for this account.' })
  }
  const issued = await issueEmailCode(response.locals.requestId, email, 'booking', user.id)
  if (!issued.ok) return response.status(issued.status).json({ error: issued.error })
  return response.status(202).json({
    emailChallengeId: issued.challengeId,
    emailOtpSent: true,
    expiresInSeconds: emailCodeExpiresInSeconds,
    resendAfterSeconds: emailCodeResendAfterSeconds,
  })
})

router.post('/guest/verify-otp', async (request, response) => {
  const parsed = z.object({
    challengeId: z.string().uuid().optional(),
    phone: phoneSchema,
    otp: z.string().regex(/^\d{6}$/).optional(),
    email: emailSchema.optional(),
    emailChallengeId: z.string().uuid().optional(),
    emailOtp: emailCodeSchema.optional(),
    name: z.string().min(2).max(60).optional(),
  }).safeParse(request.body)
  if (!parsed.success) return response.status(400).json({ error: 'Enter the verification code sent to your mobile or email.' })
  if (!parsed.data.challengeId && !parsed.data.emailChallengeId) return response.status(400).json({ error: 'Enter the verification code sent to your mobile or email.' })
  if (parsed.data.challengeId && !parsed.data.otp) return response.status(400).json({ error: 'Enter the verification code sent to your mobile.' })
  if (parsed.data.emailChallengeId && (!parsed.data.email || !parsed.data.emailOtp)) return response.status(400).json({ error: 'Enter the verification code sent to your email.' })
  const phone = toE164IndianMobile(parsed.data.phone)
  if (!phone) return response.status(400).json({ error: 'Enter the verification code sent to your mobile.' })
  if (parsed.data.challengeId && !(await passesChallengeAttempt(response, parsed.data.challengeId, phone, parsed.data.otp!))) return
  if (parsed.data.emailChallengeId && !(await consumeEmailChallenge(response, parsed.data.emailChallengeId, parsed.data.email!, ['booking'], parsed.data.emailOtp!))) return
  if (parsed.data.challengeId && !(await markChallengeVerified(response, parsed.data.challengeId))) return
  if (parsed.data.emailChallengeId && !(await markEmailChallengeVerified(response, parsed.data.emailChallengeId))) return

  const password = crypto.randomBytes(24).toString('base64url')
  const email = `guest-${parsed.data.phone}-${crypto.randomBytes(6).toString('hex')}@guest.urbantanker.local`
  const name = parsed.data.name ?? 'Guest customer'
  const { data: created, error: createError } = await authSupabase.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: name, phone }, app_metadata: { role: 'customer' } })
  if (createError || !created.user) {
    logFailure('guest.user_create_failed', response.locals.requestId, createError?.message)
    return response.status(500).json({ error: 'Guest account could not be created.' })
  }
  const { error: profileError } = await supabase.from('profiles').upsert({ id: created.user.id, full_name: name, phone_e164: phone, phone_verified_at: new Date().toISOString(), username: `guest_${parsed.data.phone}`, role: 'customer' })
  if (profileError) {
    logFailure('guest.profile_failed', response.locals.requestId, profileError.message)
    const { error: rollbackError } = await authSupabase.auth.admin.deleteUser(created.user.id)
    if (rollbackError) logFailure('guest.rollback_failed', response.locals.requestId, rollbackError.message)
    return response.status(500).json({ error: 'Guest account could not be created.' })
  }
  const { data: session, error: sessionError } = await authSupabase.auth.signInWithPassword({ email, password })
  if (sessionError || !session.session) {
    logFailure('guest.session_failed', response.locals.requestId, sessionError?.message)
    return response.status(500).json({ error: 'Guest session could not be created.' })
  }
  setRefreshCookie(response, session.session.refresh_token)
  response.json({ accessToken: session.session.access_token, ...refreshTokenForClient(request.header('x-client-platform'), session.session.refresh_token), user: { username: `guest_${parsed.data.phone}`, name, role: 'customer' } })
})

router.post('/guest/verify-phone', requireAuth, async (request, response) => {
  // Accepts the SMS code, the booking email code, or both. At least one pair is required, and every pair sent must verify.
  const parsed = z.object({
    challengeId: z.string().uuid().optional(),
    phone: phoneSchema,
    otp: z.string().regex(/^\d{6}$/).optional(),
    email: emailSchema.optional(),
    emailChallengeId: z.string().uuid().optional(),
    emailOtp: emailCodeSchema.optional(),
  }).safeParse(request.body)
  const invalid = 'Enter the verification code sent to this mobile number or email.'
  if (!parsed.success) return response.status(400).json({ error: invalid })
  if (!parsed.data.challengeId && !parsed.data.emailChallengeId) return response.status(400).json({ error: invalid })
  if (parsed.data.challengeId && !parsed.data.otp) return response.status(400).json({ error: 'Enter the verification code sent to this mobile number.' })
  if (parsed.data.emailChallengeId && (!parsed.data.email || !parsed.data.emailOtp)) return response.status(400).json({ error: 'Enter the verification code sent to your email.' })
  const phone = toE164IndianMobile(parsed.data.phone)
  if (!phone) return response.status(400).json({ error: 'Enter the verification code sent to this mobile number.' })
  if (parsed.data.emailChallengeId && parsed.data.email?.trim().toLowerCase() !== request.authUser!.email?.trim().toLowerCase()) {
    return response.status(403).json({ error: 'Only the registered account email can verify this booking.' })
  }
  if (parsed.data.challengeId && !(await passesChallengeAttempt(response, parsed.data.challengeId, phone, parsed.data.otp!))) return
  if (parsed.data.emailChallengeId && !(await consumeEmailChallenge(response, parsed.data.emailChallengeId, parsed.data.email!, ['booking'], parsed.data.emailOtp!))) return
  if (parsed.data.challengeId && !(await markChallengeVerified(response, parsed.data.challengeId))) return
  if (parsed.data.emailChallengeId && !(await markEmailChallengeVerified(response, parsed.data.emailChallengeId))) return
  response.json({ verified: true })
})

router.post('/phone/request-otp', otpRequestLimit, otpPhoneLimit, async (request, response) => {
  const parsed = z.object({ phone: phoneSchema }).safeParse(request.body)
  if (!parsed.success) return response.status(400).json({ error: 'Enter a valid 10-digit mobile number.' })
  const phone = toE164IndianMobile(parsed.data.phone)
  if (!phone) return response.status(400).json({ error: 'Enter a valid 10-digit mobile number.' })
  return issueOtpChallenge(response, phone, 'user_registration_otp')
})

router.post('/phone/verify-otp', phoneOtpVerifyLimit, async (request, response) => {
  const parsed = z.object({
    challengeId: z.string().uuid(),
    phone: phoneSchema,
    otp: z.string().regex(/^\d{6}$/),
    name: z.string().trim().min(2).max(60).optional(),
  }).safeParse(request.body)
  if (!parsed.success) {
    return response.status(400).json({ error: 'Enter the verification code sent to this mobile number.' })
  }
  const phone = toE164IndianMobile(parsed.data.phone)
  if (!phone) {
    return response.status(400).json({ error: 'Enter the verification code sent to this mobile number.' })
  }
  if (!(await passesChallengeAttempt(response, parsed.data.challengeId, phone, parsed.data.otp))) return

  const { data: matchedProfile, error: lookupError } = await supabase
    .from('profiles')
    .select('id,role,full_name,username,phone_e164,theme_mode,selfie_required')
    .eq('phone_e164', phone)
    .not('phone_verified_at', 'is', null)
    .maybeSingle()
  if (lookupError) {
    logFailure('phone.profile_lookup_failed', response.locals.requestId, lookupError.message)
    return response.status(500).json({ error: 'The phone account could not be checked.' })
  }
  const existingProfile = matchedProfile as ProfileRow | null
  if (!existingProfile && !parsed.data.name) {
    return response.status(400).json({ error: 'Enter your name to create a new customer account.' })
  }
  if (!(await markChallengeVerified(response, parsed.data.challengeId))) return

  let profile: ProfileRow
  let session: { access_token: string; refresh_token: string }
  let authUser: { id: string; email?: string | null }
  if (existingProfile) {
    profile = existingProfile
    const { data: existingUser, error: userError } = await authSupabase.auth.admin.getUserById(profile.id)
    if (userError || !existingUser.user?.email) {
      return response.status(403).json({ error: 'The phone account is unavailable.' })
    }
    const { data: link, error: linkError } = await authSupabase.auth.admin.generateLink({
      type: 'magiclink',
      email: existingUser.user.email,
    })
    const tokenHash = link?.properties?.hashed_token
    if (linkError || !tokenHash) {
      logFailure('phone.magiclink_failed', response.locals.requestId, linkError?.message)
      return response.status(500).json({ error: 'A phone sign-in session could not be created.' })
    }
    const { data: verified, error: verifyError } = await authSupabase.auth.verifyOtp({
      token_hash: tokenHash,
      type: 'magiclink',
    })
    if (verifyError || !verified.session || !verified.user) {
      logFailure('phone.magiclink_verify_failed', response.locals.requestId, verifyError?.message)
      return response.status(500).json({ error: 'A phone sign-in session could not be created.' })
    }
    session = {
      access_token: verified.session.access_token,
      refresh_token: verified.session.refresh_token,
    }
    authUser = { id: verified.user.id, email: verified.user.email }
  } else {
    const username = `phone_${parsed.data.phone}_${crypto.randomBytes(3).toString('hex')}`
    const email = `phone-${parsed.data.phone}@phone.urbantanker.local`
    const password = crypto.randomBytes(32).toString('base64url')
    const { data: created, error: createError } = await authSupabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        full_name: parsed.data.name,
        phone,
        role: 'customer',
        username,
      },
    })
    if (createError || !created.user) {
      logFailure('phone.user_create_failed', response.locals.requestId, createError?.message)
      return response.status(409).json({ error: 'The phone account could not be created. Try signing in again.' })
    }

    const signupPlatform = clientPlatformFromHeader(request.header('x-client-platform'))
    const { data: createdProfile, error: profileError } = await supabase
      .from('profiles')
      .upsert({
        id: created.user.id,
        full_name: parsed.data.name,
        phone_e164: phone,
        phone_verified_at: new Date().toISOString(),
        username,
        role: 'customer',
        signup_platform: signupPlatform,
        selfie_required: signupPlatform === 'mobile',
      })
      .select('id,role,full_name,username,phone_e164,theme_mode,selfie_required')
      .single()
    if (profileError || !createdProfile) {
      logFailure('phone.profile_create_failed', response.locals.requestId, profileError?.message)
      const { error: rollbackError } = await authSupabase.auth.admin.deleteUser(created.user.id)
      if (rollbackError) logFailure('phone.rollback_failed', response.locals.requestId, rollbackError.message)
      return response.status(500).json({ error: 'The customer account could not be created.' })
    }
    profile = createdProfile as ProfileRow

    const { data: signedIn, error: signInError } = await authSupabase.auth.signInWithPassword({
      email,
      password,
    })
    if (signInError || !signedIn.session) {
      logFailure('phone.session_failed', response.locals.requestId, signInError?.message)
      return response.status(500).json({ error: 'The customer account was created but could not be signed in.' })
    }
    session = {
      access_token: signedIn.session.access_token,
      refresh_token: signedIn.session.refresh_token,
    }
    authUser = { id: signedIn.user.id, email: signedIn.user.email }
  }

  setRefreshCookie(response, session.refresh_token)
  return response.json({
    accessToken: session.access_token,
    ...refreshTokenForClient(request.header('x-client-platform'), session.refresh_token),
    user: {
      id: authUser.id,
      email: authUser.email,
      username: profile.username ?? authUser.email ?? parsed.data.phone,
      name: profile.full_name,
      role: profile.role,
      themeMode: profile.theme_mode ?? 'system',
      selfieRequired: profile.selfie_required === true,
    },
  })
})

router.post('/email/request-otp', emailOtpRequestLimit, emailOtpEmailLimit, async (request, response) => {
  const parsed = z.object({ email: emailSchema }).safeParse(request.body)
  if (!parsed.success) return response.status(400).json({ error: 'Enter a valid email address.' })
  const lookup = await authUserForEmail(parsed.data.email)
  if (lookup.error) {
    logFailure('email.user_lookup_failed', response.locals.requestId, lookup.error)
    return response.status(500).json({ error: verificationFailedMessage })
  }
  const issued = await issueEmailCode(response.locals.requestId, parsed.data.email, 'sign_in', lookup.user?.id ?? null)
  if (!issued.ok) return response.status(issued.status).json({ error: issued.error })
  response.status(202).json({ challengeId: issued.challengeId, expiresInSeconds: emailCodeExpiresInSeconds, resendAfterSeconds: emailCodeResendAfterSeconds })
})

// A code for an unknown email creates a new customer account, which needs a name. Existing accounts sign in without one.
router.post('/email/verify-otp', emailOtpVerifyLimit, async (request, response) => {
  const parsed = z.object({
    challengeId: z.string().uuid(),
    email: emailSchema,
    otp: emailCodeSchema,
    name: z.string().trim().min(2).max(60).optional(),
  }).safeParse(request.body)
  if (!parsed.success) return response.status(400).json({ error: 'Enter the verification code sent to your email.' })
  const { challengeId, email, otp, name } = parsed.data
  const row = await consumeEmailChallenge(response, challengeId, email, ['sign_in', 'signup'], otp)
  if (!row) return

  if (row.user_id) {
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('id,role,full_name,username,phone_e164,theme_mode,selfie_required,approval_status')
      .eq('id', row.user_id)
      .maybeSingle()
    if (profileError) {
      logFailure('email.profile_lookup_failed', response.locals.requestId, profileError.message)
      return response.status(500).json({ error: verificationFailedMessage })
    }
    const existing = profile as ProfileRow | null
    const pendingApproval = (existing?.role === 'admin' || existing?.role === 'vendor') && existing.approval_status === 'pending'
    if (!existing || (!['customer', 'vendor'].includes(existing.role) && !pendingApproval)) {
      return response.status(403).json({ error: 'This account cannot sign in here.' })
    }
    if (!(await markEmailChallengeVerified(response, challengeId))) return
    const { data: confirmed, error: confirmError } = await authSupabase.auth.admin.updateUserById(row.user_id, { email_confirm: true })
    if (confirmError || !confirmed.user) {
      logFailure('email.confirm_failed', response.locals.requestId, confirmError?.message)
      return response.status(500).json({ error: verificationFailedMessage })
    }
    if (pendingApproval) {
      return response.status(202).json({ approvalPending: true, message: adminApprovalPendingMessage })
    }
    const session = await magicLinkSession(response, confirmed.user.email ?? email)
    if (!session) return
    return sendSignedInUser(request, response, session, session.user, existing, email)
  }

  if (!name) return response.status(400).json({ error: 'Enter your name to create a new customer account.' })
  if (!(await markEmailChallengeVerified(response, challengeId))) return

  const password = crypto.randomBytes(32).toString('base64url')
  const username = `email_${crypto.randomBytes(4).toString('hex')}`
  const { data: created, error: createError } = await authSupabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: name, role: 'customer', username },
  })
  if (createError || !created.user) {
    logFailure('email.user_create_failed', response.locals.requestId, createError?.message)
    return response.status(409).json({ error: 'The account could not be created. Try signing in again.' })
  }
  const signupPlatform = clientPlatformFromHeader(request.header('x-client-platform'))
  const { data: createdProfile, error: profileError } = await supabase
    .from('profiles')
    .upsert({ id: created.user.id, full_name: name, username, role: 'customer', signup_platform: signupPlatform, selfie_required: false })
    .select('id,role,full_name,username,phone_e164,theme_mode,selfie_required')
    .single()
  if (profileError || !createdProfile) {
    logFailure('email.profile_create_failed', response.locals.requestId, profileError?.message)
    const { error: rollbackError } = await authSupabase.auth.admin.deleteUser(created.user.id)
    if (rollbackError) logFailure('email.rollback_failed', response.locals.requestId, rollbackError.message)
    return response.status(500).json({ error: 'The customer account could not be created.' })
  }
  const { data: signedIn, error: signInError } = await authSupabase.auth.signInWithPassword({ email, password })
  if (signInError || !signedIn.session || !signedIn.user) {
    logFailure('email.session_failed', response.locals.requestId, signInError?.message)
    return response.status(500).json({ error: 'The customer account was created but could not be signed in.' })
  }
  return sendSignedInUser(
    request,
    response,
    { accessToken: signedIn.session.access_token, refreshToken: signedIn.session.refresh_token },
    { id: signedIn.user.id, email: signedIn.user.email },
    createdProfile as ProfileRow,
    email,
  )
})

// Always 202 so the reply does not reveal whether the account exists. The code is sent after the reply.
router.post('/resend-confirmation', resendConfirmationLimit, async (request, response) => {
  response.status(202).json({ accepted: true })
  const parsed = z.object({ email: emailSchema }).safeParse(request.body)
  if (!parsed.success) return
  const requestId = response.locals.requestId
  const lookup = await authUserForEmail(parsed.data.email)
  if (lookup.error) return logFailure('email.resend_lookup_failed', requestId, lookup.error)
  if (!lookup.user || lookup.user.email_confirmed) return
  const issued = await issueEmailCode(requestId, parsed.data.email, 'signup', lookup.user.id)
  if (!issued.ok) logFailure('email.resend_failed', requestId, issued.error)
})

router.post('/email/link/request-otp', requireAuth, emailOtpRequestLimit, emailOtpEmailLimit, async (request, response) => {
  const parsed = z.object({ email: emailSchema }).safeParse(request.body)
  if (!parsed.success) return response.status(400).json({ error: 'Enter a valid email address.' })
  const userId = request.authUser!.id
  const lookup = await authUserForEmail(parsed.data.email)
  if (lookup.error) {
    logFailure('email.user_lookup_failed', response.locals.requestId, lookup.error)
    return response.status(500).json({ error: verificationFailedMessage })
  }
  if (lookup.user && lookup.user.id !== userId) return response.status(400).json({ error: 'This email address cannot be used.' })
  const issued = await issueEmailCode(response.locals.requestId, parsed.data.email, 'link', userId)
  if (!issued.ok) return response.status(issued.status).json({ error: issued.error })
  response.status(202).json({ challengeId: issued.challengeId, expiresInSeconds: emailCodeExpiresInSeconds, resendAfterSeconds: emailCodeResendAfterSeconds })
})

router.post('/email/link/verify-otp', requireAuth, emailOtpVerifyLimit, async (request, response) => {
  const parsed = z.object({ challengeId: z.string().uuid(), email: emailSchema, otp: emailCodeSchema }).safeParse(request.body)
  if (!parsed.success) return response.status(400).json({ error: 'Enter the verification code sent to your email.' })
  const userId = request.authUser!.id
  const { challengeId, email, otp } = parsed.data
  const row = await consumeEmailChallenge(response, challengeId, email, ['link'], otp)
  if (!row) return
  if (row.user_id !== userId) return response.status(400).json({ error: invalidCodeMessage })
  const lookup = await authUserForEmail(email)
  if (lookup.error) {
    logFailure('email.user_lookup_failed', response.locals.requestId, lookup.error)
    return response.status(500).json({ error: verificationFailedMessage })
  }
  if (lookup.user && lookup.user.id !== userId) return response.status(400).json({ error: 'This email address cannot be used.' })
  if (!(await markEmailChallengeVerified(response, challengeId))) return
  const { error: updateError } = await authSupabase.auth.admin.updateUserById(userId, { email, email_confirm: true })
  if (updateError) {
    logFailure('email.link_update_failed', response.locals.requestId, updateError.message)
    return response.status(400).json({ error: 'This email address cannot be used.' })
  }
  response.json({ email })
})

router.post('/login', loginLimit, loginAccountLimit, async (request, response) => {
  const parsed = credentialsSchema.safeParse(request.body)
  if (!parsed.success) return response.status(400).json({ error: 'Invalid credentials', details: parsed.error.flatten() })
  const credential = (parsed.data.email ?? parsed.data.username!).trim().toLowerCase()
  let email = credential
  let username = credential
  if (!credential.includes('@')) {
    const { data: usernameProfile } = await supabase.from('profiles').select('id,username').ilike('username', escapeIlike(credential)).maybeSingle()
    let matchedEmail: string | undefined
    if (usernameProfile) {
      const { data: authUser } = await authSupabase.auth.admin.getUserById(usernameProfile.id)
      matchedEmail = authUser.user?.email ?? undefined
      username = usernameProfile.username ?? credential
    }
    // An unknown username still goes through the password check so both cases take similar time.
    email = matchedEmail ?? unmatchedLoginEmail
  }
  const { data, error } = await authSupabase.auth.signInWithPassword({ email, password: parsed.data.password })
  if (error || !data.session || !data.user) return response.status(401).json({ error: 'Invalid credentials' })
  const { data: profile, error: profileError } = await supabase.from('profiles').select('id,role,full_name,username,phone_e164,theme_mode,selfie_required,approval_status').eq('id', data.user.id).single()
  if (profileError || !profile) return response.status(403).json({ error: 'Account profile is unavailable.' })
  if ((profile.role === 'admin' || profile.role === 'vendor') && profile.approval_status !== 'approved') {
    return response.status(403).json({ error: adminApprovalPendingMessage })
  }
  if (profile.role === 'vendor') {
    const { data: vendor, error: vendorLookupError } = await supabase.from('vendors').select('id').eq('owner_profile_id', profile.id).maybeSingle()
    if (vendorLookupError) return response.status(500).json({ error: 'Vendor profile could not be checked.' })
    if (!vendor) {
      const rawPhone = profile.phone_e164 ?? (typeof data.user.user_metadata?.phone === 'string' ? data.user.user_metadata.phone : null) ?? data.user.phone
      const phone = rawPhone ? toE164IndianMobile(rawPhone) : null
      if (phone) {
        const { error: vendorCreateError } = await supabase.from('vendors').insert({
          owner_profile_id: profile.id,
          business_name: profile.full_name?.trim() || 'Vendor account setup required',
          phone_e164: phone,
          service_zone: 'Unassigned',
          verification: 'pending',
          is_online: false,
        })
        if (vendorCreateError) {
          logFailure('login.vendor_create_failed', response.locals.requestId, vendorCreateError.message)
          return response.status(500).json({ error: 'Vendor profile could not be created.' })
        }
      }
    }
  }
  setRefreshCookie(response, data.session.refresh_token)
  const user = { id: data.user.id, email: data.user.email, username: profile.username ?? username ?? data.user.email, name: profile.full_name ?? data.user.email, role: profile.role ?? 'customer', themeMode: profile.theme_mode ?? 'system', selfieRequired: profile.selfie_required === true }
  return response.json({ accessToken: data.session.access_token, ...refreshTokenForClient(request.header('x-client-platform'), data.session.refresh_token), user })
})

router.post('/signup', signupLimit, signupEmailLimit, async (request, response) => {
  const parsed = z.object({
    email: z.string().email(),
    username: z.string().min(3).max(40).regex(/^[a-zA-Z0-9._-]+$/).optional(),
    password: z.string().min(8).refine(passwordWithinBcryptLimit, 'Password must be 72 bytes or fewer.'),
    name: z.string().min(2).max(60),
    phone: phoneSchema,
    role: z.enum(['customer', 'vendor', 'admin']).optional(),
    businessName: z.string().trim().min(2).max(120).optional(),
    serviceZone: z.string().trim().min(2).max(120).optional(),
    latitude: z.number().finite().min(-90).max(90).optional(),
    longitude: z.number().finite().min(-180).max(180).optional(),
    adminKey: z.string().optional(),
    themeMode: themeModeSchema.optional(),
    selfieJpegBase64: z.string().min(1).max(2_000_000).optional(),
  }).safeParse(request.body)
  if (!parsed.success) return response.status(400).json({ error: 'Invalid registration', details: parsed.error.flatten() })
  const role = parsed.data.role ?? 'customer'
  if ((parsed.data.latitude === undefined) !== (parsed.data.longitude === undefined)) return response.status(400).json({ error: 'Latitude and longitude must be provided together.' })
  if (role === 'vendor' && (!parsed.data.businessName || !parsed.data.serviceZone)) return response.status(400).json({ error: 'Enter your business name and service zone to create a vendor account.' })
  const selfie = parsed.data.selfieJpegBase64 === undefined ? null : decodeSelfieJpeg(parsed.data.selfieJpegBase64)
  if (parsed.data.selfieJpegBase64 !== undefined && !selfie) return response.status(400).json({ error: 'Choose a JPEG photo.' })
  if (!isEmailConfigured()) return response.status(503).json({ error: 'Email confirmation is unavailable. Configure Gmail SMTP_USER, SMTP_PASSWORD, and MAIL_FROM on the backend, then try again.' })

  const signupPlatform = clientPlatformFromHeader(request.header('x-client-platform'))
  const themeMode = parsed.data.themeMode ?? 'system'
  const username = parsed.data.username?.toLowerCase() ?? parsed.data.email.split('@')[0]?.toLowerCase() ?? 'user'
  // The phone is not stored here. It is written by the phone verify route after the OTP passes.
  const { data: created, error } = await authSupabase.auth.admin.createUser({
    email: parsed.data.email,
    password: parsed.data.password,
    email_confirm: false,
    user_metadata: { full_name: parsed.data.name, role, username },
  })
  if (error || !created.user) {
    logFailure('signup.user_create_failed', response.locals.requestId, error?.message)
    return response.status(400).json({ error: 'This email may already be registered. Try signing in.' })
  }
  const userId = created.user.id
  const { error: profileError } = await supabase.from('profiles').upsert({
    id: userId,
    full_name: parsed.data.name,
    username,
    role,
    approval_status: role === 'admin' || role === 'vendor' ? 'pending' : 'approved',
    signup_platform: signupPlatform,
    theme_mode: themeMode,
  })
  if (profileError) {
    logFailure('signup.profile_failed', response.locals.requestId, profileError.message)
    const { error: deleteError } = await authSupabase.auth.admin.deleteUser(userId)
    if (deleteError) logFailure('signup.rollback_failed', response.locals.requestId, deleteError.message)
    return response.status(400).json({ error: signupFailedMessage })
  }

  const cleanupUnconfirmedAccount = async () => {
    const { error: removePhotoError } = await supabase.storage.from(selfieBucket).remove([selfieObjectPath(userId)])
    const { error: deleteVendorError } = await supabase.from('vendors').delete().eq('owner_profile_id', userId)
    const { error: deleteProfileError } = await supabase.from('profiles').delete().eq('id', userId)
    const { error: deleteUserError } = await authSupabase.auth.admin.deleteUser(userId)
    if (removePhotoError || deleteVendorError || deleteProfileError || deleteUserError) {
      const errors = [removePhotoError?.message, deleteVendorError?.message, deleteProfileError?.message, deleteUserError?.message].filter(Boolean).join('; ')
      logger.error('signup.rollback_failed', { userId, error: errors })
      return false
    }
    return true
  }

  if (role === 'vendor') {
    const { error: vendorError } = await supabase.from('vendors').insert({
      owner_profile_id: userId,
      business_name: parsed.data.businessName,
      phone_e164: toE164IndianMobile(parsed.data.phone),
      service_zone: parsed.data.serviceZone,
      latitude: parsed.data.latitude ?? null,
      longitude: parsed.data.longitude ?? null,
      verification: 'pending',
      is_online: false,
    })
    if (vendorError) {
      logFailure('signup.vendor_failed', response.locals.requestId, vendorError.message)
      await cleanupUnconfirmedAccount()
      return response.status(400).json({ error: signupFailedMessage })
    }
  }

  if (selfie) {
    const path = selfieObjectPath(userId)
    let photoError: string | null = null
    const { error: uploadError } = await supabase.storage.from(selfieBucket).upload(path, selfie, { contentType: 'image/jpeg', upsert: true })
    if (uploadError) {
      photoError = uploadError.message
    } else {
      const { error: recordError } = await supabase.from('profiles').update({ selfie_path: path, selfie_captured_at: new Date().toISOString() }).eq('id', userId)
      if (recordError) {
        photoError = recordError.message
        await supabase.storage.from(selfieBucket).remove([path])
      }
    }
    if (photoError) {
      logFailure('signup.selfie_failed', response.locals.requestId, photoError)
      await cleanupUnconfirmedAccount()
      return response.status(500).json({ error: 'Your photo could not be saved. Please try again.' })
    }
  }

  const code = await issueEmailCode(response.locals.requestId, parsed.data.email, 'signup', userId)
  if (!code.ok) {
    await cleanupUnconfirmedAccount()
    return response.status(code.status).json({ error: code.error })
  }

  const phoneCode = await sendPhoneOtpBestEffort(response.locals.requestId, parsed.data.phone)

  response.status(201).json({
    requiresEmailVerification: true,
    emailSent: true,
    challengeId: code.challengeId,
    expiresInSeconds: emailCodeExpiresInSeconds,
    resendAfterSeconds: emailCodeResendAfterSeconds,
    phoneOtpSent: phoneCode.sent,
    phoneChallengeId: phoneCode.challengeId,
    userId,
    role,
    approvalPending: role === 'admin' || role === 'vendor',
    signupPlatform,
    themeMode,
  })
})

// Sends the reset email after the response, so the reply never depends on whether the account exists or the mail went out.
function deliverPasswordReset(email: string, requestId: unknown) {
  void (async () => {
    try {
      const { data, error } = await authSupabase.auth.admin.generateLink({ type: 'recovery', email, options: { redirectTo: `${config.FRONTEND_ORIGIN}/login` } })
      const actionLink = data?.properties?.action_link
      if (error || !actionLink) {
        logFailure('auth.password_reset_link_failed', requestId, error?.message)
        return
      }
      const reset = passwordResetEmail(actionLink)
      const delivery = await sendEmail(email, reset.subject, reset.html)
      if (!delivery.queued) throw new Error(delivery.reason)
    } catch (deliveryError) {
      logFailure('auth.password_reset_email_failed', requestId, mailErrorCode(deliveryError))
    }
  })()
}

router.post('/password-reset', passwordResetLimit, passwordResetEmailLimit, async (request, response) => {
  const parsed = z.object({ email: z.string().email() }).safeParse(request.body)
  if (!parsed.success) return response.status(400).json({ error: 'Valid email is required' })
  if (!isEmailConfigured()) return response.status(503).json({ error: 'Password reset email is unavailable. Configure Gmail SMTP_USER, SMTP_PASSWORD, and MAIL_FROM on the backend, then try again.' })
  deliverPasswordReset(parsed.data.email, response.locals.requestId)
  response.status(202).json({ accepted: true })
})

router.post('/password-update', passwordUpdateLimit, async (request, response) => {
  const parsed = z.object({
    accessToken: z.string().min(20).max(4096),
    password: z.string().min(8).max(128).refine(passwordWithinBcryptLimit, 'Password must be 72 bytes or fewer.'),
  }).safeParse(request.body)
  if (!parsed.success) return response.status(400).json({ error: 'A valid recovery link and password are required.' })

  const { data, error } = await authSupabase.auth.getUser(parsed.data.accessToken)
  if (error || !data.user || !hasRecoveryClaim(parsed.data.accessToken)) return response.status(401).json({ error: 'The password reset link is invalid or expired.' })

  const { error: updateError } = await authSupabase.auth.admin.updateUserById(data.user.id, {
    password: parsed.data.password,
  })
  if (updateError) {
    logFailure('auth.password_update_failed', response.locals.requestId, updateError.message)
    return response.status(500).json({ error: 'The password could not be updated. Please try again.' })
  }
  const { error: signOutError } = await authSupabase.auth.admin.signOut(parsed.data.accessToken, 'others')
  if (signOutError) logFailure('auth.password_update_signout_failed', response.locals.requestId, signOutError.message)
  return response.json({ updated: true })
})

router.post('/refresh', async (request, response) => {
  if (!originAllowed(request)) return response.status(403).json({ error: 'Request origin is not allowed.' })
  const refreshToken = refreshTokenFromRequest(request)
  if (!refreshToken) return response.status(401).json({ error: 'Refresh token required' })
  const { data, error } = await authSupabase.auth.refreshSession({ refresh_token: refreshToken })
  if (error || !data.session) return response.status(401).json({ error: 'Session expired' })
  setRefreshCookie(response, data.session.refresh_token)
  return response.json({ accessToken: data.session.access_token, ...refreshTokenForClient(request.header('x-client-platform'), data.session.refresh_token) })
})

router.post('/mobile-refresh', async (request, response) => {
  const parsed = z.object({ refreshToken: z.string().min(20).max(4096) }).safeParse(request.body)
  if (!parsed.success) return response.status(400).json({ error: 'Refresh token required' })
  const { data, error } = await authSupabase.auth.refreshSession({ refresh_token: parsed.data.refreshToken })
  if (error || !data.session || !data.user) return response.status(401).json({ error: 'Session expired' })
  const { data: profile } = await supabase.from('profiles').select('id,role,full_name,username,theme_mode').eq('id', data.user.id).single()
  return response.json({ accessToken: data.session.access_token, ...refreshTokenForClient(request.header('x-client-platform'), data.session.refresh_token), user: { id: data.user.id, email: data.user.email, username: profile?.username ?? data.user.email, name: profile?.full_name ?? data.user.email, role: profile?.role ?? 'customer', themeMode: profile?.theme_mode ?? 'system' } })
})

router.get('/preferences', requireAuth, async (request, response) => {
  const { data, error } = await supabase.from('profiles').select('theme_mode').eq('id', request.authUser!.id).single()
  if (error || !data) return response.status(404).json({ error: 'Profile not found' })
  return response.json({ themeMode: data.theme_mode ?? 'system' })
})
router.patch('/preferences', requireAuth, async (request, response) => {
  const parsed = z.object({ themeMode: themeModeSchema }).safeParse(request.body)
  if (!parsed.success) return response.status(400).json({ error: 'Invalid preferences' })
  const { data, error } = await supabase.from('profiles').update({ theme_mode: parsed.data.themeMode }).eq('id', request.authUser!.id).select('theme_mode').single()
  if (error || !data) return response.status(400).json({ error: 'Preferences could not be saved' })
  return response.json({ themeMode: data.theme_mode })
})

router.put('/mpin', requireAuth, async (request, response) => {
  const parsed = z.object({ pin: z.string().regex(/^\d{4,6}$/) }).safeParse(request.body)
  if (!parsed.success) return response.status(400).json({ error: 'MPIN must be 4 to 6 digits.' })
  const userId = request.authUser!.id
  const { error } = await supabase.from('user_mpin_credentials').upsert({
    user_id: userId,
    pin_digest: hashMpinForUser(userId, parsed.data.pin),
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id' })
  if (error) {
    logFailure('auth.mpin_save_failed', response.locals.requestId, error.message)
    return response.status(500).json({ error: 'MPIN could not be saved.' })
  }
  return response.status(204).send()
})

router.delete('/mpin', requireAuth, async (request, response) => {
  const { error } = await supabase.from('user_mpin_credentials')
    .delete()
    .eq('user_id', request.authUser!.id)
  if (error) {
    logFailure('auth.mpin_delete_failed', response.locals.requestId, error.message)
    return response.status(500).json({ error: 'MPIN could not be removed.' })
  }
  return response.status(204).send()
})

// Revokes every session for the user. Without an access token, the refresh cookie or body token is exchanged for one first.
router.post('/logout', async (request, response) => {
  if (!originAllowed(request)) return response.status(403).json({ error: 'Request origin is not allowed.' })
  let accessToken = bearerToken(request)
  if (!accessToken) {
    const refreshToken = refreshTokenFromRequest(request)
    if (refreshToken) {
      const { data } = await authSupabase.auth.refreshSession({ refresh_token: refreshToken })
      accessToken = data.session?.access_token
    }
  }
  if (accessToken) {
    const { error } = await authSupabase.auth.admin.signOut(accessToken, 'global').catch((signOutError: unknown) => ({ error: { message: signOutError instanceof Error ? signOutError.message : 'unknown' } }))
    if (error) {
      logFailure('auth.logout_failed', response.locals.requestId, error.message)
      return response.status(502).json({ error: 'Sign-out could not be completed. Please try again.' })
    }
  }
  clearRefreshCookie(response)
  return response.status(204).send()
})

export default router
