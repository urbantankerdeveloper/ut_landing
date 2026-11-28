import { databaseFailure } from '../lib/httpErrors.js'
import { z } from 'zod'
import express, { Router } from 'express'
import { requireAuth, requireRole } from '../middleware/auth.js'
import { config } from '../config.js'
import { authSupabase, supabase } from '../supabase.js'
import { selfieBucket } from '../services/selfie.js'
import { toE164IndianMobile } from '../lib/phone.js'
import { failure } from '../lib/httpErrors.js'
import { listWindow, sendList, type ListWindow } from '../lib/listParams.js'
import { invalidateCatalog } from '../services/catalogCache.js'
import { invalidateAuthProfile } from '../services/authCache.js'
import { salesRowsFromFulfilments, type SalesFulfilment } from '../lib/salesReports.js'
import { notifyVendorByEmail } from '../services/vendorNotifications.js'
const exactCount = (range: ListWindow) => (range.mode === 'paged' ? { count: 'exact' as const } : undefined)
const legacyRouterAuth = (request: express.Request, response: express.Response, next: express.NextFunction) => config.featureFlags.AUTH_MOUNT_ONCE ? next() : requireAuth(request, response, next)
const adminOnly = requireRole('admin')
const router = Router(); router.use(legacyRouterAuth, requireRole('admin', 'dispatcher'))
router.get('/orders', async (request, response) => { const page = Math.max(1, Number(request.query.page ?? 1)); const pageSize = Math.min(100, Math.max(1, Number(request.query.pageSize ?? 25))); const from = (page - 1) * pageSize; const to = from + pageSize - 1; let query = supabase.from('bookings').select('*', { count: 'exact' }).order('created_at', { ascending: false }).range(from, to); if (typeof request.query.status === 'string') query = query.eq('status', request.query.status); if (typeof request.query.service === 'string') query = query.eq('service_code', request.query.service); if (typeof request.query.vendorId === 'string') query = query.eq('vendor_id', request.query.vendorId); if (request.query.assigned === 'true') query = query.not('vendor_id', 'is', null); if (request.query.assigned === 'false') query = query.is('vendor_id', null); if (typeof request.query.from === 'string') query = query.gte('scheduled_for', `${request.query.from}T00:00:00.000Z`); if (typeof request.query.to === 'string') query = query.lte('scheduled_for', `${request.query.to}T23:59:59.999Z`); const { data, error, count } = await query; if (error) return databaseFailure(response, 'admin.database_error', error, 500); response.json({ rows: data ?? [], page, pageSize, total: count ?? 0 }) })
router.get('/vendors', async (_request, response) => {
  const [vendorsResult, profilesResult] = await Promise.all([
    supabase.from('vendors').select('*').order('created_at', { ascending: false }),
    supabase.from('profiles').select('id,full_name,phone_e164,role,created_at').eq('role', 'vendor').order('created_at', { ascending: false }),
  ])
  if (vendorsResult.error) return databaseFailure(response, 'admin.vendor_list_failed', vendorsResult.error, 500)
  if (profilesResult.error) return databaseFailure(response, 'admin.vendor_profiles_failed', profilesResult.error, 500)
  const vendors = vendorsResult.data ?? []
  const linkedProfiles = new Set(vendors.map((vendor) => vendor.owner_profile_id).filter(Boolean))
  const orphanProfiles = (profilesResult.data ?? []).filter((profile) => !linkedProfiles.has(profile.id))
  const accountRows = await Promise.all(orphanProfiles.map(async (profile) => {
    const { data } = await authSupabase.auth.admin.getUserById(profile.id)
    return {
      id: profile.id,
      owner_profile_id: profile.id,
      business_name: profile.full_name ?? 'Vendor account',
      email: data.user?.email ?? undefined,
      phone_e164: profile.phone_e164,
      service_zone: null,
      verification: 'setup_required',
      is_online: false,
      created_at: profile.created_at,
      account_only: true,
    }
  }))
  response.json([...vendors, ...accountRows])
})
router.get('/vendors/:id', async (request, response) => { const { data, error } = await supabase.from('vendors').select('*, vehicles(*), drivers(*)').eq('id', request.params.id).single(); if (error || !data) return response.status(404).json({ error: 'Vendor not found' }); response.json(data) })
router.get('/customers/:id/selfie', requireRole('admin'), async (request, response) => {
  const { data: profile, error } = await supabase.from('profiles').select('selfie_path').eq('id', request.params.id).maybeSingle()
  if (error) return databaseFailure(response, 'admin.database_error', error, 500)
  if (!profile?.selfie_path) return response.status(404).json({ error: 'Selfie not found' })
  const { data: signed, error: signError } = await supabase.storage.from(selfieBucket).createSignedUrl(profile.selfie_path, 300)
  if (signError || !signed) return response.status(500).json({ error: 'Selfie link could not be created' })
  const { error: auditError } = await supabase.from('audit_logs').insert({ actor_id: request.authUser!.id, action: 'customer.selfie_viewed', entity_type: 'profile', entity_id: request.params.id, metadata: {} })
  if (auditError) return response.status(500).json({ error: 'Selfie access could not be recorded' })
  response.json({ url: signed.signedUrl, expiresInSeconds: 300 })
})
router.get('/customers', async (request, response) => { const listRange = listWindow(request.query); const { data, error, count } = await supabase.from('profiles').select('id,full_name,phone_e164,role,created_at', exactCount(listRange)).eq('role', 'customer').order('created_at', { ascending: false }).range(listRange.from, listRange.to); if (error) return databaseFailure(response, 'admin.database_error', error, 500); sendList(response, listRange, data ?? [], count) })
router.get('/customers/:id', async (request, response) => { const { data: profile, error } = await supabase.from('profiles').select('id,full_name,phone_e164,role,created_at').eq('id', request.params.id).eq('role', 'customer').single(); if (error || !profile) return response.status(404).json({ error: 'Customer not found' }); const { data: bookings, error: bookingError } = await supabase.from('bookings').select('*').eq('customer_id', request.params.id).order('created_at', { ascending: false }); if (bookingError) return databaseFailure(response, 'admin.database_error', bookingError, 500); response.json({ ...profile, bookings: bookings ?? [] }) })
router.patch('/customers/:id', async (request, response) => { const parsed = z.object({ name: z.string().min(2).optional(), phone: z.string().min(10).max(16).optional() }).safeParse(request.body); const phoneE164 = parsed.success && parsed.data.phone !== undefined ? toE164IndianMobile(parsed.data.phone) : undefined; if (!parsed.success || (parsed.data.phone !== undefined && !phoneE164)) return response.status(400).json({ error: 'Invalid customer update' }); const { data, error } = await supabase.from('profiles').update(Object.fromEntries(Object.entries({ full_name: parsed.data.name, phone_e164: phoneE164 }).filter(([, value]) => value !== undefined))).eq('id', request.params.id).eq('role', 'customer').select().single(); if (error) return databaseFailure(response, 'admin.customer_update_failed', error, 400); await invalidateAuthProfile(request.params.id); response.json(data) })
router.delete('/customers/:id', adminOnly, async (request, response) => {
  const { data: profile, error: profileError } = await supabase.from('profiles').select('selfie_path').eq('id', request.params.id).maybeSingle()
  if (profileError) return databaseFailure(response, 'admin.customer_lookup_failed', profileError, 500)
  const { error } = await supabase.auth.admin.deleteUser(String(request.params.id))
  if (error) return failure(response, 500, 'The customer account could not be deleted. Please try again.', 'admin.customer_auth_delete_failed', error)
  if (profile?.selfie_path) {
    const { error: removeError } = await supabase.storage.from(selfieBucket).remove([profile.selfie_path])
    if (removeError) return failure(response, 500, 'The customer account was removed, but the selfie could not be deleted. Contact engineering.', 'admin.customer_selfie_delete_failed', removeError)
  }
  response.status(204).send()
})
router.post('/customers', adminOnly, async (request, response) => { const parsed = z.object({ email: z.string().email(), password: z.string().min(8), name: z.string().min(2).max(60), phone: z.string().min(10).max(16) }).safeParse(request.body); const phoneE164 = parsed.success ? toE164IndianMobile(parsed.data.phone) : null; if (!parsed.success || !phoneE164) return response.status(400).json({ error: 'Invalid customer' }); const { data: auth, error: authError } = await supabase.auth.admin.createUser({ email: parsed.data.email, password: parsed.data.password, email_confirm: true, user_metadata: { full_name: parsed.data.name, phone: phoneE164 }, app_metadata: { role: 'customer' } }); if (authError || !auth.user) return failure(response, 400, 'Customer user could not be created.', 'admin.customer_create_failed', authError); const { data, error } = await supabase.from('profiles').upsert({ id: auth.user.id, full_name: parsed.data.name, phone_e164: phoneE164, role: 'customer' }).select().single(); if (error) return databaseFailure(response, 'admin.customer_profile_failed', error, 400); response.status(201).json(data) })
router.use('/coupons', adminOnly)
router.get('/coupons', async (request, response) => { const listRange = listWindow(request.query); const { data, error, count } = await supabase.from('coupons').select('*', exactCount(listRange)).order('created_at', { ascending: false }).range(listRange.from, listRange.to); if (error) return databaseFailure(response, 'admin.database_error', error, 500); sendList(response, listRange, data ?? [], count) })
router.post('/coupons', async (request, response) => { const parsed = z.object({ code: z.string().min(2), label: z.string().min(2), discount: z.string().min(1), expires: z.string(), active: z.boolean() }).safeParse(request.body); if (!parsed.success) return response.status(400).json({ error: 'Invalid coupon' }); const isPercentage = parsed.data.discount.includes('%'); const value = Number.parseFloat(parsed.data.discount.replace(/[^0-9.]/g, '')); const { data, error } = await supabase.from('coupons').insert({ code: parsed.data.code.toUpperCase(), title: parsed.data.label, discount_type: isPercentage ? 'percentage' : 'flat', discount_value: Number.isFinite(value) ? value : 0, valid_until: parsed.data.expires, is_active: parsed.data.active }).select().single(); if (error) return databaseFailure(response, 'admin.database_error', error, 400); await invalidateCatalog('customer.offers'); response.status(201).json(data) })
router.patch('/coupons/:id', async (request, response) => { const parsed = z.object({ label: z.string().min(2).optional(), discount: z.string().min(1).optional(), expires: z.string().optional(), active: z.boolean().optional() }).safeParse(request.body); if (!parsed.success) return response.status(400).json({ error: 'Invalid coupon' }); const update: Record<string, unknown> = {}; if (parsed.data.label) update.title = parsed.data.label; if (parsed.data.discount) { update.discount_type = parsed.data.discount.includes('%') ? 'percentage' : 'flat'; update.discount_value = Number.parseFloat(parsed.data.discount.replace(/[^0-9.]/g, '')) || 0 } if (parsed.data.expires) update.valid_until = parsed.data.expires; if (typeof parsed.data.active === 'boolean') update.is_active = parsed.data.active; const { data, error } = await supabase.from('coupons').update(update).eq('id', request.params.id).select().single(); if (error) return databaseFailure(response, 'admin.database_error', error, 400); await invalidateCatalog('customer.offers'); response.json(data) })
router.delete('/coupons/:id', async (request, response) => { const { error } = await supabase.from('coupons').delete().eq('id', request.params.id); if (error) return databaseFailure(response, 'admin.database_error', error, 400); await invalidateCatalog('customer.offers'); response.status(204).send() })
router.post('/reports', adminOnly, async (request, response) => {
  const parsed = z.object({
    type: z.enum(['orders', 'vendors', 'revenue']),
    from: z.string().date(),
    to: z.string().date(),
    status: z.string().trim().min(1).max(80).optional(),
    service: z.string().trim().min(1).max(80).optional(),
    customerType: z.enum(['registered', 'guest']).optional(),
    vendorId: z.string().uuid().optional(),
  }).refine((value) => value.from <= value.to, {
    path: ['to'],
    message: 'The report end date must be on or after the start date.',
  }).refine((value) => !value.vendorId || value.type === 'revenue', {
    path: ['vendorId'],
    message: 'Vendor filtering is only supported for revenue reports.',
  }).safeParse(request.body)
  if (!parsed.success) return response.status(400).json({ error: 'Invalid report request', details: parsed.error.flatten() })
  let query = supabase.from('bookings').select('*')
    .gte('created_at', `${parsed.data.from}T00:00:00.000Z`)
    .lte('created_at', `${parsed.data.to}T23:59:59.999Z`)
  if (parsed.data.type === 'vendors') query = query.not('vendor_id', 'is', null)
  if (parsed.data.status) query = query.eq('status', parsed.data.status)
  if (parsed.data.service) query = query.eq('service_code', parsed.data.service)
  if (parsed.data.customerType) query = query.eq('customer_type', parsed.data.customerType)
  if (parsed.data.vendorId) query = query.eq('vendor_id', parsed.data.vendorId)
  const { data, error } = await query.order('created_at', { ascending: false })
  if (error) return databaseFailure(response, 'admin.database_error', error, 500)
  const bookings = data ?? []
  let rows: unknown[] = bookings
  if (
    parsed.data.type === 'revenue' &&
    parsed.data.vendorId &&
    config.MULTI_SERVICE_ORDERS_ENABLED
  ) {
    const fulfilments: SalesFulfilment[] = []
    for (let offset = 0; ; offset += 1000) {
      let fulfilmentQuery = supabase.from('order_fulfilments')
        .select('id,legacy_booking_id,created_at,orders(customer_id),order_fulfilment_items(order_items(locked_price_paise,delivery_charge_paise,discount_paise,service_types(code)))')
        .eq('vendor_id', parsed.data.vendorId)
        .gte('created_at', `${parsed.data.from}T00:00:00.000Z`)
        .lte('created_at', `${parsed.data.to}T23:59:59.999Z`)
        .order('created_at', { ascending: false })
        .range(offset, offset + 999)
      if (parsed.data.status) fulfilmentQuery = fulfilmentQuery.eq('status', parsed.data.status)
      const { data: fulfilmentPage, error: fulfilmentError } = await fulfilmentQuery
      if (fulfilmentError) {
        return databaseFailure(response, 'admin.report_fulfilments_failed', fulfilmentError, 500)
      }
      const page = (fulfilmentPage ?? []) as SalesFulfilment[]
      fulfilments.push(...page)
      if (page.length < 1000) break
    }
    const bookingIds = new Set(
      bookings.map((booking) => booking.id).filter((id): id is string => typeof id === 'string'),
    )
    const filteredFulfilments = fulfilments.filter((fulfilment) => {
      if (!parsed.data.customerType) return true
      const order = Array.isArray(fulfilment.orders)
        ? fulfilment.orders[0]
        : fulfilment.orders
      const isRegistered = Boolean(order?.customer_id)
      return parsed.data.customerType === 'registered' ? isRegistered : !isRegistered
    })
    const fulfilmentRows = salesRowsFromFulfilments(filteredFulfilments, bookingIds)
      .filter((row) => !parsed.data.service || row.service_code === parsed.data.service)
      .map((row) => ({ ...row, vendor_id: parsed.data.vendorId }))
    rows = [...bookings, ...fulfilmentRows]
  }
  let total = bookings.reduce((sum, row) => sum + Number(row.quoted_amount_paise ?? 0) / 100, 0)
  if (rows.length > bookings.length) {
    total += (rows.slice(bookings.length) as Array<{ quoted_amount_paise: number }>)
      .reduce((sum, row) => sum + Number(row.quoted_amount_paise ?? 0) / 100, 0)
  }
  if (parsed.data.type === 'vendors') {
    const vendorIds = [...new Set(bookings.flatMap((row) =>
      typeof row.vendor_id === 'string' ? [row.vendor_id] : [],
    ))]
    if (vendorIds.length) {
      const { data: vendors, error: vendorsError } = await supabase
        .from('vendors')
        .select('id,business_name')
        .in('id', vendorIds)
      if (vendorsError) return databaseFailure(response, 'admin.report_vendor_lookup_failed', vendorsError, 500)
      const vendorNames = new Map((vendors ?? []).map((vendor) => [vendor.id, vendor.business_name]))
      const grouped = new Map<string, { vendor_id: string; business_name: string; booking_count: number; completed_count: number; quoted_amount_paise: number }>()
      for (const booking of bookings) {
        if (typeof booking.vendor_id !== 'string') continue
        const row = grouped.get(booking.vendor_id) ?? {
          vendor_id: booking.vendor_id,
          business_name: vendorNames.get(booking.vendor_id) ?? 'Vendor name unavailable',
          booking_count: 0,
          completed_count: 0,
          quoted_amount_paise: 0,
        }
        row.booking_count += 1
        if (booking.status === 'delivered') row.completed_count += 1
        row.quoted_amount_paise += Number(booking.quoted_amount_paise ?? 0)
        grouped.set(booking.vendor_id, row)
      }
      const vendorRows = [...grouped.values()].sort((a, b) => b.quoted_amount_paise - a.quoted_amount_paise)
      rows = vendorRows
      total = vendorRows.reduce((sum, row) => sum + row.quoted_amount_paise / 100, 0)
    } else {
      rows = []
      total = 0
    }
  }
  response.json({
    type: parsed.data.type,
    rows,
    generatedAt: new Date().toISOString(),
    total,
  })
})
router.get('/partner-applications', requireRole('admin'), async (request, response) => { const status = typeof request.query.status === 'string' ? request.query.status : undefined; const listRange = listWindow(request.query); let query = supabase.from('partner_applications').select('*', exactCount(listRange)).order('created_at', { ascending: false }); if (status) query = query.eq('status', status); const { data, error, count } = await query.range(listRange.from, listRange.to); if (error) return databaseFailure(response, 'admin.database_error', error, 500); sendList(response, listRange, data ?? [], count) })
router.get('/partner-applications/:id/history', adminOnly, async (request, response) => {
  if (!z.string().uuid().safeParse(request.params.id).success) return response.status(400).json({ error: 'Invalid partner application.' })
  const { data: application, error: applicationError } = await supabase.from('partner_applications').select('id').eq('id', request.params.id).maybeSingle()
  if (applicationError) return databaseFailure(response, 'admin.partner_application_history_failed', applicationError, 500)
  if (!application) return response.status(404).json({ error: 'Partner application not found.' })
  const { data, error } = await supabase.from('partner_application_history').select('*').eq('application_id', request.params.id).order('created_at', { ascending: true }).limit(200)
  if (error) return databaseFailure(response, 'admin.partner_application_history_failed', error, 500)
  response.json(data ?? [])
})
router.get('/partner-applications/:id/documents', adminOnly, async (request, response) => {
  if (!z.string().uuid().safeParse(request.params.id).success) return response.status(400).json({ error: 'Invalid partner application.' })
  const { data: application, error: applicationError } = await supabase.from('partner_applications').select('id').eq('id', request.params.id).maybeSingle()
  if (applicationError) return databaseFailure(response, 'admin.partner_application_documents_failed', applicationError, 500)
  if (!application) return response.status(404).json({ error: 'Partner application not found.' })
  const { data: documents, error: documentsError } = await supabase.from('documents').select('id,document_type,object_key').eq('owner_type', 'partner_application').eq('owner_id', request.params.id).order('created_at', { ascending: true })
  if (documentsError) return databaseFailure(response, 'admin.partner_application_documents_failed', documentsError, 500)
  const signedDocuments = await Promise.all((documents ?? []).map(async (document) => {
    const { data, error } = await supabase.storage.from('urban-tanker-documents').createSignedUrl(document.object_key, 300)
    if (error || !data) return { error }
    const storedName = document.object_key.split('/').pop() ?? document.object_key
    const name = storedName.replace(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}-/i, '')
    return { id: document.id, name, documentType: document.document_type, downloadUrl: data.signedUrl, expiresInSeconds: 300 }
  }))
  const signError = signedDocuments.find((document) => 'error' in document)?.error
  if (signError) return failure(response, 500, 'Partner documents could not be prepared for download.', 'admin.partner_application_document_sign_failed', signError)
  response.json(signedDocuments)
})
router.patch('/partner-applications/:id', requireRole('admin'), async (request, response) => {
  const parsed = z.object({
    status: z.enum(['submitted', 'under_review', 'additional_info_required', 'approved', 'rejected']),
    reviewNote: z.string().trim().max(2000).optional(),
  }).safeParse(request.body)
  if (!parsed.success) return response.status(400).json({ error: 'Invalid partner application review.' })

  const { data: current, error: currentError } = await supabase
    .from('partner_applications')
    .select('id,status,email,business_name,reference')
    .eq('id', request.params.id)
    .maybeSingle()
  if (currentError) return databaseFailure(response, 'admin.database_error', currentError, 500)
  if (!current) return response.status(404).json({ error: 'Partner application not found.' })

  const { data, error } = await supabase
    .from('partner_applications')
    .update({
      status: parsed.data.status,
      review_note: parsed.data.reviewNote ?? null,
      reviewed_by: request.authUser!.id,
      reviewed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', request.params.id)
    .select()
    .single()
  if (error) return databaseFailure(response, 'admin.database_error', error, 400)

  if (current.status !== parsed.data.status && (parsed.data.status === 'approved' || parsed.data.status === 'rejected')) {
    const approved = parsed.data.status === 'approved'
    void notifyVendorByEmail(
      current.email,
      approved ? 'vendor_application_approved' : 'vendor_application_rejected',
      {
        businessName: current.business_name ?? 'Your business',
        reference: current.reference ?? current.id,
        reviewNote: parsed.data.reviewNote || 'Please contact our partnerships team if you have questions about this decision.',
      },
      `partner_application_${parsed.data.status}`,
    )
  }
  response.json(data)
})
router.get('/audit-logs', adminOnly, async (request, response) => { const page = Math.max(1, Number(request.query.page ?? 1)); const pageSize = Math.min(100, Math.max(1, Number(request.query.pageSize ?? 50))); let query = supabase.from('audit_logs').select('*', { count: 'exact' }).order('created_at', { ascending: false }).range((page - 1) * pageSize, page * pageSize - 1); if (typeof request.query.actorId === 'string') query = query.eq('actor_id', request.query.actorId); if (typeof request.query.action === 'string') query = query.eq('action', request.query.action); if (typeof request.query.entityType === 'string') query = query.eq('entity_type', request.query.entityType); const { data, error, count } = await query; if (error) return databaseFailure(response, 'admin.database_error', error, 500); response.json({ rows: data ?? [], page, pageSize, total: count ?? 0 }) })
export default router
