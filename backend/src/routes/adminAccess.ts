import { Router } from 'express'
import crypto from 'node:crypto'
import rateLimit from 'express-rate-limit'
import { z } from 'zod'
import { authSupabase, supabase } from '../supabase.js'
import { requireAuth, requireRole } from '../middleware/auth.js'
import { config } from '../config.js'
import { limiterStore } from '../services/scaling.js'
import { toE164IndianMobile } from '../lib/phone.js'
import { logger } from '../lib/logger.js'
import { isEmailConfigured, sendEmail } from '../services/providers.js'
import { adminAccessGrantedEmail } from '../services/signupEmail.js'

const router = Router()
const requestLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  store: limiterStore('rl:admin-access-request:', 'open'),
  passOnStoreError: true,
  message: { error: 'Too many admin access requests. Try again later.' },
})
const phone = z.string().regex(/^\d{10}$/)
const decisionSchema = z.object({ decision: z.enum(['approved', 'rejected']) })
const genericSubmission = {
  accepted: true,
  message: 'Your request has been received and will be reviewed.',
}

function isEnabled() {
  return config.featureFlags.admin_approval_required_enabled
}

function requireAdmin(request: Parameters<typeof requireAuth>[0], response: Parameters<typeof requireAuth>[1], next: Parameters<typeof requireAuth>[2]) {
  return requireAuth(request, response, (error?: unknown) => {
    if (error) return next(error)
    return requireRole('admin')(request, response, next)
  })
}

function approvalAdminOnly(request: Parameters<typeof requireAuth>[0], response: Parameters<typeof requireAuth>[1], next: Parameters<typeof requireAuth>[2]) {
  if (!isEnabled()) return response.status(404).json({ error: 'Admin access requests are disabled.' })
  return requireAdmin(request, response, next)
}

router.post('/requests', requestLimit, async (request, response) => {
  if (!isEnabled()) return response.status(404).json({ error: 'Admin access requests are disabled.' })
  const parsed = z.object({
    name: z.string().trim().min(2).max(60),
    email: z.string().trim().email().max(160),
    phone,
    reason: z.string().trim().min(10).max(2000),
    phoneChallengeId: z.string().uuid(),
  }).safeParse(request.body)
  if (!parsed.success) {
    return response.status(400).json({ error: 'Enter your name, a valid email and phone, a reason, and verify your phone.' })
  }
  const phoneE164 = toE164IndianMobile(parsed.data.phone)
  if (!phoneE164) return response.status(400).json({ error: 'Enter a valid 10-digit phone number.' })

  const { data: challenge, error: challengeError } = await supabase
    .from('guest_otp_challenges')
    .select('id')
    .eq('id', parsed.data.phoneChallengeId)
    .eq('phone_e164', phoneE164)
    .is('user_id', null)
    .not('verified_at', 'is', null)
    .gt('expires_at', new Date().toISOString())
    .maybeSingle()
  if (challengeError) {
    logger.error('admin_access.phone_challenge_lookup_failed', {
      requestId: response.locals.requestId,
      error: challengeError.message,
    })
    return response.status(500).json({ error: 'Phone verification could not be confirmed. Please try again.' })
  }
  if (!challenge) return response.status(400).json({ error: 'Verify your phone before submitting the request.' })

  const { error } = await supabase.from('admin_access_requests').insert({
    name: parsed.data.name,
    email: parsed.data.email.toLowerCase(),
    phone_e164: phoneE164,
    reason: parsed.data.reason,
    status: 'pending',
  })
  if (error && error.code !== '23505') {
    logger.error('admin_access.request_create_failed', {
      requestId: response.locals.requestId,
      error: error.message,
    })
    return response.status(500).json({ error: 'Your request could not be submitted. Please try again.' })
  }
  return response.status(202).json(genericSubmission)
})

router.get('/admins', requireAdmin, async (_request, response) => {
  const [{ data: profiles, error: profilesError }, { data: requests, error: requestsError }] = await Promise.all([
    supabase
      .from('profiles')
      .select('id,full_name,phone_e164,admin_approval_status,approval_status,is_active,created_at')
      .eq('role', 'admin')
      .order('full_name', { ascending: true }),
    supabase
      .from('admin_access_requests')
      .select('id,name,email,phone_e164,reason,status,requested_at,reviewed_by,reviewed_at,provisioned_user_id')
      .order('requested_at', { ascending: false }),
  ])
  if (profilesError || requestsError) {
    logger.error('admin_access.admin_list_failed', {
      requestId: response.locals.requestId,
      profilesError: profilesError?.message,
      requestsError: requestsError?.message,
    })
    return response.status(500).json({ error: 'Admin users could not be loaded.' })
  }

  const profileRows = profiles ?? []
  const profileIds = new Set(profileRows.map((profile) => profile.id))
  const requestRows = requests ?? []
  const accounts = await Promise.all(profileRows.map(async (profile) => {
    const { data: authUser, error } = await authSupabase.auth.admin.getUserById(profile.id)
    if (error) throw error
    const provisionedRequest = requestRows.find((item) => item.provisioned_user_id === profile.id)
    return {
      id: profile.id,
      kind: 'admin',
      name: profile.full_name,
      email: provisionedRequest?.email ?? authUser.user?.email ?? '',
      phone_e164: profile.phone_e164,
      reason: provisionedRequest?.reason ?? null,
      status: profile.admin_approval_status ?? (profile.approval_status === 'pending' ? 'pending' : 'approved'),
      is_active: profile.is_active !== false,
      requested_at: provisionedRequest?.requested_at ?? profile.created_at,
      reviewed_by: provisionedRequest?.reviewed_by ?? null,
      reviewed_at: provisionedRequest?.reviewed_at ?? null,
    }
  })).catch((error: unknown) => {
    logger.error('admin_access.admin_identity_lookup_failed', {
      requestId: response.locals.requestId,
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  })
  if (!accounts) return response.status(500).json({ error: 'Admin users could not be loaded.' })

  const unprovisionedRequests = requestRows
    .filter((item) => !item.provisioned_user_id || !profileIds.has(item.provisioned_user_id))
    .map((item) => ({
      id: item.id,
      kind: 'request',
      name: item.name,
      email: item.email,
      phone_e164: item.phone_e164,
      reason: item.reason,
      status: item.status,
      is_active: null,
      requested_at: item.requested_at,
      reviewed_by: item.reviewed_by,
      reviewed_at: item.reviewed_at,
    }))
  return response.json([...unprovisionedRequests, ...accounts])
})

router.patch('/admins/:id/status', requireAdmin, async (request, response) => {
  if (!z.string().uuid().safeParse(request.params.id).success) {
    return response.status(400).json({ error: 'Invalid admin account.' })
  }
  const parsed = z.object({ isActive: z.boolean() }).safeParse(request.body)
  if (!parsed.success) return response.status(400).json({ error: 'Choose whether this admin account is active.' })

  const { data, error } = await supabase
    .from('profiles')
    .update({ is_active: parsed.data.isActive })
    .eq('id', request.params.id)
    .eq('role', 'admin')
    .eq('admin_approval_status', 'approved')
    .select('id,is_active')
    .maybeSingle()
  if (error) {
    logger.error('admin_access.admin_status_update_failed', {
      requestId: response.locals.requestId,
      error: error.message,
    })
    return response.status(500).json({ error: 'The admin account status could not be updated.' })
  }
  if (!data) return response.status(409).json({ error: 'Only approved admin accounts can be activated or deactivated.' })
  return response.json({ id: data.id, is_active: data.is_active })
})

router.get('/requests', approvalAdminOnly, async (_request, response) => {
  const { data, error } = await supabase
    .from('admin_access_requests')
    .select('id,name,email,phone_e164,reason,status,requested_at')
    .eq('status', 'pending')
    .order('requested_at', { ascending: true })
  if (error) {
    logger.error('admin_access.request_list_failed', {
      requestId: response.locals.requestId,
      error: error.message,
    })
    return response.status(500).json({ error: 'Admin access requests could not be loaded.' })
  }
  return response.json(data ?? [])
})

router.patch('/requests/:id', approvalAdminOnly, async (request, response) => {
  if (!z.string().uuid().safeParse(request.params.id).success) {
    return response.status(400).json({ error: 'Invalid admin access request.' })
  }
  const parsed = decisionSchema.safeParse(request.body)
  if (!parsed.success) return response.status(400).json({ error: 'Choose approve or reject.' })

  const now = new Date().toISOString()
  const { data: claimed, error: claimError } = await supabase
    .from('admin_access_requests')
    .update({
      status: parsed.data.decision,
      reviewed_by: request.authUser!.id,
      reviewed_at: now,
    })
    .eq('id', request.params.id)
    .eq('status', 'pending')
    .select('id,name,email,phone_e164,reason')
    .maybeSingle()
  if (claimError) {
    logger.error('admin_access.request_review_claim_failed', {
      requestId: response.locals.requestId,
      error: claimError.message,
    })
    return response.status(500).json({ error: 'The request could not be reviewed. Please try again.' })
  }
  if (!claimed) return response.status(409).json({ error: 'This request is no longer waiting for review.' })

  if (parsed.data.decision === 'rejected') {
    return response.json({ id: claimed.id, status: 'rejected' })
  }
  if (!isEmailConfigured()) {
    await restorePendingRequest(claimed.id, response.locals.requestId)
    return response.status(503).json({ error: 'Admin account email delivery is not configured.' })
  }

  const password = crypto.randomBytes(32).toString('base64url')
  const { data: created, error: createError } = await authSupabase.auth.admin.createUser({
    email: claimed.email,
    password,
    email_confirm: true,
    user_metadata: { full_name: claimed.name, phone: claimed.phone_e164 },
    app_metadata: { role: 'admin' },
  })
  if (createError || !created.user) {
    await restorePendingRequest(claimed.id, response.locals.requestId)
    if (createError?.code === 'email_exists' || createError?.code === 'user_already_exists') {
      return response.status(409).json({ error: 'An account already uses this email. Reject this request or ask the applicant to use another email.' })
    }
    logger.error('admin_access.account_create_failed', {
      requestId: response.locals.requestId,
      error: createError?.message,
    })
    return response.status(500).json({ error: 'The admin account could not be created.' })
  }

  const { error: profileError } = await supabase.from('profiles').upsert({
    id: created.user.id,
    full_name: claimed.name,
    phone_e164: claimed.phone_e164,
    phone_verified: true,
    phone_verified_at: now,
    role: 'admin',
    approval_status: 'approved',
    admin_approval_status: 'approved',
  })
  if (profileError) {
    await rollbackCreatedAdmin(created.user.id, claimed.id, response.locals.requestId)
    if (profileError.code === '23505') {
      return response.status(409).json({ error: 'The applicant phone number is already assigned to an account.' })
    }
    return response.status(500).json({ error: 'The admin profile could not be created.' })
  }

  const { data: recovery, error: recoveryError } = await authSupabase.auth.admin.generateLink({
    type: 'recovery',
    email: claimed.email,
    options: { redirectTo: `${config.FRONTEND_ORIGIN}/login` },
  })
  const actionLink = recovery?.properties?.action_link
  if (recoveryError || !actionLink) {
    logger.error('admin_access.password_link_failed', {
      requestId: response.locals.requestId,
      error: recoveryError?.message,
    })
    await rollbackCreatedAdmin(created.user.id, claimed.id, response.locals.requestId)
    return response.status(500).json({ error: 'The admin account setup email could not be prepared.' })
  }

  try {
    const email = adminAccessGrantedEmail(claimed.name, actionLink)
    const delivery = await sendEmail(claimed.email, email.subject, email.html)
    if (!delivery.queued) throw new Error(delivery.reason)
  } catch (deliveryError) {
    logger.error('admin_access.password_email_failed', {
      requestId: response.locals.requestId,
      error: deliveryError instanceof Error ? deliveryError.message : String(deliveryError),
    })
    await rollbackCreatedAdmin(created.user.id, claimed.id, response.locals.requestId)
    return response.status(503).json({ error: 'The admin account setup email could not be sent.' })
  }

  const { error: requestUpdateError } = await supabase
    .from('admin_access_requests')
    .update({ provisioned_user_id: created.user.id })
    .eq('id', claimed.id)
  if (requestUpdateError) {
    logger.error('admin_access.request_provisioning_record_failed', {
      requestId: response.locals.requestId,
      error: requestUpdateError.message,
    })
    await rollbackCreatedAdmin(created.user.id, claimed.id, response.locals.requestId)
    return response.status(500).json({ error: 'The approved request could not be recorded.' })
  }
  return response.json({ id: claimed.id, status: 'approved' })
})

async function restorePendingRequest(requestId: string, requestLogId: unknown) {
  const { error } = await supabase
    .from('admin_access_requests')
    .update({ status: 'pending', reviewed_by: null, reviewed_at: null })
    .eq('id', requestId)
  if (error) {
    logger.error('admin_access.request_restore_failed', {
      requestId: requestLogId,
      error: error.message,
    })
  }
}

async function rollbackCreatedAdmin(userId: string, requestId: string, requestLogId: unknown) {
  const { error: deleteError } = await authSupabase.auth.admin.deleteUser(userId)
  if (deleteError) {
    logger.error('admin_access.account_rollback_failed', {
      requestId: requestLogId,
      error: deleteError.message,
    })
  }
  await restorePendingRequest(requestId, requestLogId)
}

export default router
