import { Router, type Response } from 'express'
import crypto from 'node:crypto'
import { z } from 'zod'
import { authSupabase, supabase } from '../supabase.js'
import { credentialsSchema } from '../lib/schemas.js'
import { sendSms } from '../services/providers.js'
const router = Router()
function parseCookies(header: string | undefined) { return Object.fromEntries((header ?? '').split(';').map((part) => part.trim().split('=').map(decodeURIComponent)).filter(([key, value]) => key && value)) }
function setRefreshCookie(response: Response, token: string) { const secure = process.env.NODE_ENV === 'production' ? '; Secure' : ''; response.setHeader('Set-Cookie', `refresh_token=${encodeURIComponent(token)}; HttpOnly; Path=/api/auth; SameSite=Lax; Max-Age=2592000${secure}`) }
function clearRefreshCookie(response: Response) { response.setHeader('Set-Cookie', 'refresh_token=; HttpOnly; Path=/api/auth; SameSite=Lax; Max-Age=0') }
const phoneSchema = z.string().regex(/^\d{10}$/)
router.post('/guest/request-otp', async (request, response) => {
  const parsed = z.object({ phone: phoneSchema }).safeParse(request.body)
  if (!parsed.success) return response.status(400).json({ error: 'Enter a valid 10-digit mobile number.' })
  const otp = crypto.randomInt(100000, 1000000).toString()
  const { data: challenge, error } = await supabase.from('guest_otp_challenges').insert({ phone_e164: `+91${parsed.data.phone}`, otp_hash: crypto.createHash('sha256').update(otp).digest('hex'), expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString() }).select('id').single()
  if (error || !challenge) return response.status(500).json({ error: error?.message ?? 'OTP could not be created.' })
  try {
    const delivery = await sendSms(`+91${parsed.data.phone}`, `Your Urban Tanker verification code is ${otp}. It expires in 10 minutes.`)
    if (!delivery.queued) return response.status(503).json({ error: 'Mobile verification is not configured yet.' })
  } catch (error) {
    return response.status(502).json({ error: error instanceof Error ? error.message : 'OTP delivery failed.' })
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
  response.json({ accessToken: session.session.access_token, refreshToken: session.session.refresh_token, user: { username: `guest_${parsed.data.phone}`, name: parsed.data.name ?? 'Guest customer', role: 'customer' } })
})
router.post('/login', async (request, response) => { const parsed = credentialsSchema.safeParse(request.body); if (!parsed.success) return response.status(400).json({ error: 'Invalid credentials', details: parsed.error.flatten() }); const credential = (parsed.data.email ?? parsed.data.username!).trim().toLowerCase(); let email = credential; let username = credential; if (!credential.includes('@')) { const { data: profile } = await supabase.from('profiles').select('id,username').ilike('username', credential).maybeSingle(); if (!profile) return response.status(401).json({ error: 'Invalid credentials' }); const { data: authUser } = await authSupabase.auth.admin.getUserById(profile.id); email = authUser.user?.email ?? ''; username = profile.username ?? credential } const { data, error } = await authSupabase.auth.signInWithPassword({ email, password: parsed.data.password }); if (error || !data.session || !data.user) return response.status(401).json({ error: 'Invalid credentials' }); const { data: profile } = await supabase.from('profiles').select('id,role,full_name,username').eq('id', data.user.id).single(); setRefreshCookie(response, data.session.refresh_token); return response.json({ accessToken: data.session.access_token, refreshToken: data.session.refresh_token, user: { id: data.user.id, email: data.user.email, username: profile?.username ?? username ?? data.user.email, name: profile?.full_name ?? data.user.email, role: profile?.role ?? 'customer' } }) })
router.post('/signup', async (request, response) => { const parsed = z.object({ email: z.string().email(), username: z.string().min(3).max(40).regex(/^[a-zA-Z0-9._-]+$/).optional(), password: z.string().min(8), name: z.string().min(2).max(60), phone: z.string().regex(/^\d{10}$/), role: z.enum(['customer','vendor','admin']).optional(), adminKey: z.string().optional() }).safeParse(request.body); if (!parsed.success) return response.status(400).json({ error: 'Invalid registration', details: parsed.error.flatten() }); if (parsed.data.role && parsed.data.role !== 'customer') return response.status(403).json({ error: 'Public signup creates customer accounts only.' }); const username = parsed.data?.username?.toLowerCase() ?? parsed.data?.email?.split('@')[0]?.toLowerCase() ?? 'user'; const { data, error } = await authSupabase.auth.signUp({ email: parsed.data.email, password: parsed.data.password, options: { data: { full_name: parsed.data.name, phone: parsed.data.phone, role: 'customer', username } } }); if (error) return response.status(400).json({ error: error.message }); if (data?.user) { const { error: profileError } = await supabase.from('profiles').upsert({ id: data.user.id, full_name: parsed.data.name, phone_e164: parsed.data.phone, username, role: 'customer' }); if (profileError) return response.status(400).json({ error: profileError.message }) } response.status(201).json({ requiresEmailVerification: !data?.session, userId: data?.user?.id }) })
router.post('/password-reset', async (request, response) => { const parsed = z.object({ email: z.string().email(), redirectTo: z.string().url().optional() }).safeParse(request.body); if (!parsed.success) return response.status(400).json({ error: 'Valid email is required' }); const { error } = await authSupabase.auth.resetPasswordForEmail(parsed.data.email, { redirectTo: parsed.data.redirectTo }); if (error) return response.status(400).json({ error: error.message }); response.status(202).json({ accepted: true }) })
router.post('/refresh', async (request, response) => { const cookies = parseCookies(request.headers.cookie); const refreshToken = cookies.refresh_token ?? request.body?.refreshToken; if (!refreshToken) return response.status(401).json({ error: 'Refresh token required' }); const { data, error } = await authSupabase.auth.refreshSession({ refresh_token: refreshToken }); if (error || !data.session) return response.status(401).json({ error: 'Session expired' }); setRefreshCookie(response, data.session.refresh_token); return response.json({ accessToken: data.session.access_token, refreshToken: data.session.refresh_token }) })
router.post('/logout', (_request, response) => { clearRefreshCookie(response); return response.status(204).send() })
export default router
