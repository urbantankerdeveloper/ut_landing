import { Router, type Response } from 'express'
import crypto from 'node:crypto'
import { z } from 'zod'
import { authSupabase, supabase } from '../supabase.js'
import { requireAuth } from '../middleware/auth.js'
import { credentialsSchema } from '../lib/schemas.js'
import { isEmailConfigured, sendEmail, sendSms } from '../services/providers.js'
import { passwordResetEmail, signupConfirmationEmail } from '../services/signupEmail.js'
import { config } from '../config.js'
import rateLimit from 'express-rate-limit'
const router = Router()
const otpRequestLimit = rateLimit({ windowMs: 10 * 60 * 1000, limit: 5, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many OTP requests. Try again later.' } })
const loginLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many login attempts. Try again later.' } })
const signupLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 5, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many registration attempts. Try again later.' } })
const passwordResetLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 5, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many password reset requests. Try again later.' } })
const passwordUpdateLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many password update attempts. Try again later.' } })
function parseCookies(header: string | undefined) { return Object.fromEntries((header ?? '').split(';').map((part) => part.trim().split('=').map(decodeURIComponent)).filter(([key, value]) => key && value)) }
const refreshCookieSecurity = config.NODE_ENV === 'production' ? '; Secure' : ''
const refreshCookieSameSite = config.NODE_ENV === 'production' ? 'None' : 'Lax'
function setRefreshCookie(response: Response, token: string) { response.setHeader('Set-Cookie', `refresh_token=${encodeURIComponent(token)}; HttpOnly; Path=/api/auth; SameSite=${refreshCookieSameSite}; Max-Age=2592000${refreshCookieSecurity}`) }
function clearRefreshCookie(response: Response) { response.setHeader('Set-Cookie', `refresh_token=; HttpOnly; Path=/api/auth; SameSite=${refreshCookieSameSite}; Max-Age=0${refreshCookieSecurity}`) }
const phoneSchema = z.string().regex(/^\d{10}$/)
router.post('/guest/request-otp', otpRequestLimit, async (request, response) => {
  const parsed = z.object({ phone: phoneSchema }).safeParse(request.body)
  if (!parsed.success) return response.status(400).json({ error: 'Enter a valid 10-digit mobile number.' })
  const otp = config.USE_DEFAULT_VERIFICATION_CODE ? config.DEFAULT_VERIFICATION_CODE : crypto.randomInt(100000, 1000000).toString()
  const { data: challenge, error } = await supabase.from('guest_otp_challenges').insert({ phone_e164: `+91${parsed.data.phone}`, otp_hash: crypto.createHash('sha256').update(otp).digest('hex'), expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString() }).select('id').single()
  if (error || !challenge) return response.status(500).json({ error: error?.message ?? 'OTP could not be created.' })
  if (!config.USE_DEFAULT_VERIFICATION_CODE) {
    try {
      const delivery = await sendSms(`+91${parsed.data.phone}`, `Your Urban Tanker verification code is ${otp}. It expires in 10 minutes.`)
      if (!delivery.queued) return response.status(503).json({ error: 'Mobile verification is not configured yet.' })
    } catch (error) {
      return response.status(502).json({ error: error instanceof Error ? error.message : 'OTP delivery failed.' })
    }
  }
  response.status(202).json({ challengeId: challenge.id, expiresInSeconds: 600 })
})
router.post('/guest/verify-otp', async (request, response) => {
  const parsed = z.object({ challengeId: z.string().uuid(), phone: phoneSchema, otp: z.string().regex(/^\d{6}$/), name: z.string().min(2).max(60).optional() }).safeParse(request.body)
  if (!parsed.success) return response.status(400).json({ error: 'Enter the verification code sent to your mobile.' })
  const { data: challenge, error: challengeError } = await supabase.from('guest_otp_challenges').select('id,phone_e164,otp_hash,expires_at,attempts,verified_at').eq('id', parsed.data.challengeId).eq('phone_e164', `+91${parsed.data.phone}`).maybeSingle()
  if (challengeError || !challenge || challenge.verified_at || challenge.attempts >= 5 || new Date(challenge.expires_at).getTime() <= Date.now()) return response.status(400).json({ error: 'This verification code is invalid or expired.' })
  await supabase.from('guest_otp_challenges').update({ attempts: challenge.attempts + 1 }).eq('id', challenge.id)
  const expected = Buffer.from(challenge.otp_hash, 'hex')
  const received = crypto.createHash('sha256').update(parsed.data.otp).digest()
  if (expected.length !== received.length || !crypto.timingSafeEqual(expected, received)) return response.status(400).json({ error: 'The verification code is incorrect.' })
  const password = crypto.randomBytes(24).toString('base64url')
  const email = `guest-${parsed.data.phone}-${crypto.randomBytes(6).toString('hex')}@guest.urbantanker.local`
  const { data: created, error: createError } = await authSupabase.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: parsed.data.name ?? 'Guest customer', phone: `+91${parsed.data.phone}`, role: 'customer' } })
  if (createError || !created.user) return response.status(500).json({ error: createError?.message ?? 'Guest account could not be created.' })
  const { error: profileError } = await supabase.from('profiles').upsert({ id: created.user.id, full_name: parsed.data.name ?? 'Guest customer', phone_e164: `+91${parsed.data.phone}`, username: `guest_${parsed.data.phone}`, role: 'customer' })
  if (profileError) return response.status(500).json({ error: profileError.message })
  const { data: session, error: sessionError } = await authSupabase.auth.signInWithPassword({ email, password })
  if (sessionError || !session.session) return response.status(500).json({ error: sessionError?.message ?? 'Guest session could not be created.' })
  await supabase.from('guest_otp_challenges').update({ verified_at: new Date().toISOString() }).eq('id', challenge.id)
  setRefreshCookie(response, session.session.refresh_token)
  response.json({ accessToken: session.session.access_token, user: { username: `guest_${parsed.data.phone}`, name: parsed.data.name ?? 'Guest customer', role: 'customer' } })
})
router.post('/guest/verify-phone', requireAuth, async (request, response) => {
  const parsed = z.object({ challengeId: z.string().uuid(), phone: phoneSchema, otp: z.string().regex(/^\d{6}$/) }).safeParse(request.body)
  if (!parsed.success) return response.status(400).json({ error: 'Enter the verification code sent to this mobile number.' })
  const { data: challenge, error: challengeError } = await supabase.from('guest_otp_challenges').select('id,otp_hash,expires_at,attempts,verified_at').eq('id', parsed.data.challengeId).eq('phone_e164', `+91${parsed.data.phone}`).maybeSingle()
  if (challengeError) return response.status(500).json({ error: challengeError.message })
  if (!challenge || challenge.verified_at || challenge.attempts >= 5 || new Date(challenge.expires_at).getTime() <= Date.now()) return response.status(400).json({ error: 'This verification code is invalid or expired.' })
  const { error: attemptError } = await supabase.from('guest_otp_challenges').update({ attempts: challenge.attempts + 1 }).eq('id', challenge.id)
  if (attemptError) return response.status(500).json({ error: attemptError.message })
  const expected = Buffer.from(challenge.otp_hash, 'hex')
  const received = crypto.createHash('sha256').update(parsed.data.otp).digest()
  if (expected.length !== received.length || !crypto.timingSafeEqual(expected, received)) return response.status(400).json({ error: 'The verification code is incorrect.' })
  const { error: verifiedError } = await supabase.from('guest_otp_challenges').update({ verified_at: new Date().toISOString() }).eq('id', challenge.id)
  if (verifiedError) return response.status(500).json({ error: verifiedError.message })
  response.json({ verified: true })
})
router.post('/login', loginLimit, async (request, response) => { const parsed = credentialsSchema.safeParse(request.body); if (!parsed.success) return response.status(400).json({ error: 'Invalid credentials', details: parsed.error.flatten() }); const credential = (parsed.data.email ?? parsed.data.username!).trim().toLowerCase(); let email = credential; let username = credential; if (!credential.includes('@')) { const { data: profile } = await supabase.from('profiles').select('id,username').ilike('username', credential).maybeSingle(); if (!profile) return response.status(401).json({ error: 'Invalid credentials' }); const { data: authUser } = await authSupabase.auth.admin.getUserById(profile.id); email = authUser.user?.email ?? ''; username = profile.username ?? credential } const { data, error } = await authSupabase.auth.signInWithPassword({ email, password: parsed.data.password }); if (error || !data.session || !data.user) return response.status(401).json({ error: 'Invalid credentials' }); const { data: profile } = await supabase.from('profiles').select('id,role,full_name,username').eq('id', data.user.id).single(); setRefreshCookie(response, data.session.refresh_token); const user = { id: data.user.id, email: data.user.email, username: profile?.username ?? username ?? data.user.email, name: profile?.full_name ?? data.user.email, role: profile?.role ?? 'customer' }; return response.json({ accessToken: data.session.access_token, ...(request.header('x-client-platform') === 'mobile' ? { refreshToken: data.session.refresh_token } : {}), user }) })
router.post('/signup', signupLimit, async (request, response) => {
  const parsed = z.object({
    email: z.string().email(),
    username: z.string().min(3).max(40).regex(/^[a-zA-Z0-9._-]+$/).optional(),
    password: z.string().min(8),
    name: z.string().min(2).max(60),
    phone: phoneSchema,
    role: z.enum(['customer', 'vendor', 'admin']).optional(),
    adminKey: z.string().optional(),
  }).safeParse(request.body)
  if (!parsed.success) return response.status(400).json({ error: 'Invalid registration', details: parsed.error.flatten() })
  if (parsed.data.role && parsed.data.role !== 'customer') return response.status(403).json({ error: 'Public signup creates customer accounts only.' })
  if (!isEmailConfigured()) return response.status(503).json({ error: 'Email confirmation is unavailable. Configure Gmail SMTP_USER, SMTP_PASSWORD, and MAIL_FROM on the backend, then try again.' })

  const username = parsed.data.username?.toLowerCase() ?? parsed.data.email.split('@')[0]?.toLowerCase() ?? 'user'
  const { data, error } = await authSupabase.auth.admin.generateLink({
    type: 'signup',
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      data: { full_name: parsed.data.name, phone: parsed.data.phone, role: 'customer', username },
      redirectTo: `${config.FRONTEND_ORIGIN}/login`,
    },
  })
  if (error) return response.status(400).json({ error: error.message })
  const userId = data.user.id
  const { error: profileError } = await supabase.from('profiles').upsert({
    id: userId,
    full_name: parsed.data.name,
    phone_e164: parsed.data.phone,
    username,
    role: 'customer',
  })
  if (profileError) {
    const { error: deleteError } = await authSupabase.auth.admin.deleteUser(userId)
    if (deleteError) console.error(JSON.stringify({ event: 'signup.rollback_failed', userId, error: deleteError.message }))
    return response.status(400).json({ error: profileError.message })
  }

  const cleanupUnconfirmedAccount = async () => {
    const { error: deleteProfileError } = await supabase.from('profiles').delete().eq('id', userId)
    const { error: deleteUserError } = await authSupabase.auth.admin.deleteUser(userId)
    if (deleteProfileError || deleteUserError) {
      const errors = [deleteProfileError?.message, deleteUserError?.message].filter(Boolean).join('; ')
      console.error(JSON.stringify({ event: 'signup.rollback_failed', userId, error: errors }))
      return false
    }
    return true
  }

  try {
    const actionLink = data.properties.action_link
    if (!actionLink) {
      await cleanupUnconfirmedAccount()
      return response.status(502).json({ error: 'We could not create an email confirmation link. Please try again.' })
    }
    const email = signupConfirmationEmail(parsed.data.name, actionLink)
    const delivery = await sendEmail(parsed.data.email, email.subject, email.html)
    if (!delivery.queued) {
      const cleanedUp = await cleanupUnconfirmedAccount()
      if (!cleanedUp) console.error(JSON.stringify({ event: 'signup.unconfirmed_account_retained', userId, reason: 'email_delivery_not_configured' }))
      return response.status(503).json({ error: 'Email confirmation is unavailable. Configure SMTP_USER, SMTP_PASSWORD, and MAIL_FROM on the backend, then try again.' })
    }
  } catch (deliveryError) {
    const cleanedUp = await cleanupUnconfirmedAccount()
    console.error(JSON.stringify({
      event: 'signup.confirmation_email_failed',
      userId,
      error: deliveryError instanceof Error ? deliveryError.message : 'Unknown email delivery error',
      cleanedUp,
    }))
    return response.status(502).json({ error: 'The confirmation email could not be sent. Please try again in a few minutes.' })
  }

  response.status(201).json({ requiresEmailVerification: true, emailSent: true, userId })
})
router.post('/password-reset', passwordResetLimit, async (request, response) => {
  const parsed = z.object({ email: z.string().email() }).safeParse(request.body)
  if (!parsed.success) return response.status(400).json({ error: 'Valid email is required' })
  if (!isEmailConfigured()) return response.status(503).json({ error: 'Password reset email is unavailable. Configure Gmail SMTP_USER, SMTP_PASSWORD, and MAIL_FROM on the backend, then try again.' })

  const { data, error } = await authSupabase.auth.admin.generateLink({
    type: 'recovery',
    email: parsed.data.email,
    options: { redirectTo: `${config.FRONTEND_ORIGIN}/login` },
  })
  if (error || !data?.properties.action_link) {
    if (error && /user not found|not found/i.test(error.message)) {
      return response.status(202).json({ accepted: true })
    }
    if (error) {
      console.error(JSON.stringify({ event: 'auth.password_reset_link_failed', error: error.message }))
      return response.status(502).json({ error: 'Password reset instructions could not be prepared. Please try again shortly.' })
    }
    return response.status(502).json({ error: 'Password reset instructions could not be prepared. Please try again shortly.' })
  }

  try {
    const email = passwordResetEmail(data.properties.action_link)
    const delivery = await sendEmail(parsed.data.email, email.subject, email.html)
    if (!delivery.queued) throw new Error(delivery.reason)
  } catch (deliveryError) {
    console.error(JSON.stringify({
      event: 'auth.password_reset_email_failed',
      error: deliveryError instanceof Error ? deliveryError.message : 'Unknown email delivery error',
    }))
    return response.status(502).json({ error: 'The password reset email could not be sent. Please try again in a few minutes.' })
  }
  response.status(202).json({ accepted: true })
})
router.post('/password-update', passwordUpdateLimit, async (request, response) => {
  const parsed = z.object({
    accessToken: z.string().min(20).max(4096),
    password: z.string().min(8).max(128),
  }).safeParse(request.body)
  if (!parsed.success) return response.status(400).json({ error: 'A valid recovery link and password are required.' })

  const { data, error } = await authSupabase.auth.getUser(parsed.data.accessToken)
  if (error || !data.user) return response.status(401).json({ error: 'The password reset link is invalid or expired.' })

  const { error: updateError } = await authSupabase.auth.admin.updateUserById(data.user.id, {
    password: parsed.data.password,
  })
  if (updateError) {
    console.error(JSON.stringify({ event: 'auth.password_update_failed', userId: data.user.id, error: updateError.message }))
    return response.status(500).json({ error: 'The password could not be updated. Please try again.' })
  }
  return response.json({ updated: true })
})
router.post('/refresh', async (request, response) => { const cookies = parseCookies(request.headers.cookie); const refreshToken = cookies.refresh_token ?? request.body?.refreshToken; if (!refreshToken) return response.status(401).json({ error: 'Refresh token required' }); const { data, error } = await authSupabase.auth.refreshSession({ refresh_token: refreshToken }); if (error || !data.session) return response.status(401).json({ error: 'Session expired' }); setRefreshCookie(response, data.session.refresh_token); return response.json({ accessToken: data.session.access_token }) })
router.post('/mobile-refresh', async (request, response) => { const parsed = z.object({ refreshToken: z.string().min(20).max(4096) }).safeParse(request.body); if (!parsed.success) return response.status(400).json({ error: 'Refresh token required' }); const { data, error } = await authSupabase.auth.refreshSession({ refresh_token: parsed.data.refreshToken }); if (error || !data.session || !data.user) return response.status(401).json({ error: 'Session expired' }); const { data: profile } = await supabase.from('profiles').select('id,role,full_name,username').eq('id', data.user.id).single(); return response.json({ accessToken: data.session.access_token, refreshToken: data.session.refresh_token, user: { id: data.user.id, email: data.user.email, username: profile?.username ?? data.user.email, name: profile?.full_name ?? data.user.email, role: profile?.role ?? 'customer' } }) })
router.post('/logout', (_request, response) => { clearRefreshCookie(response); return response.status(204).send() })
export default router
