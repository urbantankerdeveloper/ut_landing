import { Router } from 'express'
import { requireRole } from '../middleware/auth.js'
import { config } from '../config.js'
import { supabase } from '../supabase.js'
import { invalidateWhatsAppTemplateCache } from '../services/whatsapp.js'
import { smsTemplateKeys, smsTemplateRequiredVariables, smsTemplateVariables, isOtpTemplateKey } from '../services/sms.js'
import { z } from 'zod'

const router = Router()
router.use('/whatsapp-templates', requireRole('admin'))
const placeholderPattern = /\{\{(\w+)\}\}/g
const keyPattern = /^[a-z][a-z0-9_]{2,63}$/
const bodySchema = z.string().trim().min(1).max(640)
const createSchema = z.object({ templateKey: z.string().regex(keyPattern), body: bodySchema, isActive: z.boolean().optional() })
const patchSchema = z.object({ body: bodySchema.optional(), isActive: z.boolean().optional() }).refine((value) => value.body !== undefined || value.isActive !== undefined, 'Nothing to update')
function placeholders(body: string) { return [...new Set([...body.matchAll(placeholderPattern)].map((match) => match[1]!))] }
export function whatsappPlaceholderError(key: string, body: string) {
  if ((smsTemplateKeys as readonly string[]).includes(key)) {
    const allowed = smsTemplateVariables[key as keyof typeof smsTemplateVariables]
    const unknown = placeholders(body).filter((name) => !allowed.includes(name))
    if (unknown.length) return `Unknown placeholder(s): ${unknown.map((name) => `{{${name}}}`).join(', ')}`
    const missing = smsTemplateRequiredVariables[key as keyof typeof smsTemplateRequiredVariables].filter((name) => !placeholders(body).includes(name))
    if (missing.length) return `Missing required placeholder(s): ${missing.map((name) => `{{${name}}}`).join(', ')}`
  } else if (isOtpTemplateKey(key) && !placeholders(body).includes('otp')) return 'OTP templates must include {{otp}}'
  return null
}
const campaignNameMap: Record<string, string | undefined> = {
  user_registration_otp: config.COMBIRDS_CAMPAIGN_USER_REGISTRATION_OTP ?? config.COMBIRDS_WABA_CAMPAIGN_NAME,
  booking_verification_otp: config.COMBIRDS_CAMPAIGN_BOOKING_VERIFICATION_OTP ?? config.COMBIRDS_WABA_CAMPAIGN_NAME,
  guest_booking_confirmation: config.COMBIRDS_CAMPAIGN_GUEST_BOOKING_CONFIRMATION ?? config.COMBIRDS_WABA_CAMPAIGN_NAME,
  booking_status_update: config.COMBIRDS_CAMPAIGN_BOOKING_STATUS_UPDATE ?? config.COMBIRDS_WABA_CAMPAIGN_NAME,
  vendor_acceptance: config.COMBIRDS_CAMPAIGN_VENDOR_ACCEPTANCE ?? config.COMBIRDS_WABA_CAMPAIGN_NAME,
  delivery_confirmation: config.COMBIRDS_CAMPAIGN_DELIVERY_CONFIRMATION ?? config.COMBIRDS_WABA_CAMPAIGN_NAME,
  delivery_otp: config.COMBIRDS_CAMPAIGN_DELIVERY_OTP ?? config.COMBIRDS_WABA_CAMPAIGN_NAME,
  cod_switched_to_online: config.COMBIRDS_CAMPAIGN_COD_SWITCHED_TO_ONLINE ?? config.COMBIRDS_WABA_CAMPAIGN_NAME,
  cod_reverted_to_cash: config.COMBIRDS_CAMPAIGN_COD_REVERTED_TO_CASH ?? config.COMBIRDS_WABA_CAMPAIGN_NAME,
}
type WhatsAppTemplateRow = { template_key: string; body: string; variables: string[]; is_active: boolean; updated_at: string }
function present(row: WhatsAppTemplateRow) {
  return {
    templateKey: row.template_key,
    body: row.body,
    variables: row.variables,
    isActive: row.is_active,
    updatedAt: row.updated_at,
    campaignName: campaignNameMap[row.template_key] ?? null,
    isBuiltIn: (smsTemplateKeys as readonly string[]).includes(row.template_key),
    allowedVariables: (smsTemplateKeys as readonly string[]).includes(row.template_key) ? smsTemplateVariables[row.template_key as keyof typeof smsTemplateVariables] : null,
    requiredVariables: (smsTemplateKeys as readonly string[]).includes(row.template_key) ? smsTemplateRequiredVariables[row.template_key as keyof typeof smsTemplateRequiredVariables] : [],
    canDeactivate: !isOtpTemplateKey(row.template_key),
    provider: 'combirds-whatsapp',
    bodyUsedByProvider: false,
    providerNote: 'The approved message wording and live campaign are managed in Combirds WABA. This database body supplies the ordered {{placeholder}} references; their resolved values are sent as Combirds template parameters.',
  }
}
async function audit(actorId: string, action: string, key: string, metadata: Record<string, unknown>) { await supabase.from('audit_logs').insert({ actor_id: actorId, action, entity_type: 'whatsapp_template', entity_id: null, metadata: { templateKey: key, ...metadata } }) }
router.get('/whatsapp-templates', async (_req, res) => {
  const { data, error } = await supabase.from('sms_templates').select('template_key,body,variables,is_active,updated_at').order('template_key', { ascending: true })
  if (error) return res.status(500).json({ error: error.message })
  res.json({ rows: (data ?? []).map(present) })
})
router.post('/whatsapp-templates', async (req, res) => {
  const parsed = createSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid WhatsApp template' })
  const { templateKey, body, isActive = true } = parsed.data
  if (isActive === false && isOtpTemplateKey(templateKey)) return res.status(400).json({ error: 'OTP templates must stay active' })
  const issue = whatsappPlaceholderError(templateKey, body)
  if (issue) return res.status(400).json({ error: issue })
  const { data, error } = await supabase.from('sms_templates').insert({ template_key: templateKey, body, variables: placeholders(body), is_active: isActive }).select('template_key,body,variables,is_active,updated_at').single()
  if (error) return res.status(error.code === '23505' ? 409 : 400).json({ error: error.code === '23505' ? 'A template with this key already exists' : error.message })
  await audit(req.authUser!.id, 'whatsapp_template.created', templateKey, { body, isActive })
  res.status(201).json(present(data))
})
router.patch('/whatsapp-templates/:key', async (req, res) => {
  const key = String(req.params.key)
  const parsed = patchSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid WhatsApp template' })
  const { body, isActive } = parsed.data
  if (isActive === false && isOtpTemplateKey(key)) return res.status(400).json({ error: 'OTP templates must stay active' })
  const { data: current, error: readError } = await supabase.from('sms_templates').select('body').eq('template_key', key).maybeSingle()
  if (readError) return res.status(500).json({ error: readError.message })
  if (!current) return res.status(404).json({ error: 'WhatsApp template not found' })
  const nextBody = body ?? current.body
  const issue = whatsappPlaceholderError(key, nextBody)
  if (issue) return res.status(400).json({ error: issue })
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (body !== undefined) { update.body = body; update.variables = placeholders(body) }
  if (isActive !== undefined) update.is_active = isActive
  const { data, error } = await supabase.from('sms_templates').update(update).eq('template_key', key).select('template_key,body,variables,is_active,updated_at').single()
  if (error) return res.status(400).json({ error: error.message })
  invalidateWhatsAppTemplateCache(key)
  await audit(req.authUser!.id, 'whatsapp_template.updated', key, { body, isActive })
  res.json(present(data))
})
export default router
