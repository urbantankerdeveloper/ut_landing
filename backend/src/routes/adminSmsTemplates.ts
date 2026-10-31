import { Router } from 'express'
import { z } from 'zod'
import { requireAuth, requireRole } from '../middleware/auth.js'
import { supabase } from '../supabase.js'
import { invalidateSmsTemplateCache, smsTemplateKeys, smsTemplateVariables } from '../services/sms.js'

const router = Router()
router.use('/sms-templates', requireAuth, requireRole('admin'))

const placeholderPattern = /\{\{(\w+)\}\}/g
const maxBodyLength = 640
const templateKeyPattern = /^[a-z][a-z0-9_]{2,63}$/
const knownKeys: readonly string[] = smsTemplateKeys
// Empty string clears the stored ID. Built-in keys then fall back to env config.
const msg91IdSchema = z.union([z.string().trim().regex(/^[A-Za-z0-9]{6,64}$/, 'MSG91 template ID must be 6-64 letters or digits'), z.literal('')])

const createSchema = z.object({
  templateKey: z.string().regex(templateKeyPattern, 'Use lowercase letters, numbers and underscores (3-64 characters)'),
  body: z.string().trim().min(1).max(maxBodyLength),
  isActive: z.boolean().optional(),
  msg91TemplateId: msg91IdSchema.optional(),
})

const updateSchema = z
  .object({
    body: z.string().trim().min(1).max(maxBodyLength).optional(),
    isActive: z.boolean().optional(),
    msg91TemplateId: msg91IdSchema.optional(),
  })
  .refine((value) => value.body !== undefined || value.isActive !== undefined, 'Nothing to update')

function placeholdersIn(body: string) {
  return [...new Set([...body.matchAll(placeholderPattern)].map((match) => match[1] ?? ''))]
}

// Built-in messages may only use the variables their code path sends; otherwise sending would fail.
export function placeholderError(templateKey: string, body: string) {
  if (!knownKeys.includes(templateKey)) return null
  const allowed = smsTemplateVariables[templateKey as keyof typeof smsTemplateVariables]
  const unknown = placeholdersIn(body).filter((name) => !allowed.includes(name))
  if (!unknown.length) return null
  return `Unknown placeholder(s): ${unknown.map((name) => `{{${name}}}`).join(', ')}. Allowed for this message: ${allowed.map((name) => `{{${name}}}`).join(', ')}`
}

type TemplateRow = { template_key: string; body: string; variables: string[]; is_active: boolean; updated_at: string; msg91_template_id: string | null }

function toTemplate(row: TemplateRow) {
  const builtIn = knownKeys.includes(row.template_key)
  return {
    templateKey: row.template_key,
    body: row.body,
    variables: row.variables,
    isActive: row.is_active,
    msg91TemplateId: row.msg91_template_id,
    updatedAt: row.updated_at,
    isBuiltIn: builtIn,
    allowedVariables: builtIn ? smsTemplateVariables[row.template_key as keyof typeof smsTemplateVariables] : null,
  }
}

async function audit(actorId: string, action: string, templateKey: string, metadata: Record<string, unknown>) {
  await supabase.from('audit_logs').insert({ actor_id: actorId, action, entity_type: 'sms_template', entity_id: null, metadata: { templateKey, ...metadata } })
}

router.get('/sms-templates', async (_request, response) => {
  const { data, error } = await supabase
    .from('sms_templates')
    .select('template_key,body,variables,is_active,msg91_template_id,updated_at')
    .order('template_key', { ascending: true })
  if (error) return response.status(500).json({ error: error.message })
  response.json({ rows: (data ?? []).map((row) => toTemplate(row as TemplateRow)) })
})

router.post('/sms-templates', async (request, response) => {
  const parsed = createSchema.safeParse(request.body)
  if (!parsed.success) return response.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid SMS template' })
  const { templateKey, body, isActive = true, msg91TemplateId } = parsed.data
  const placeholderIssue = placeholderError(templateKey, body)
  if (placeholderIssue) return response.status(400).json({ error: placeholderIssue })

  const { data, error } = await supabase
    .from('sms_templates')
    .insert({ template_key: templateKey, body, variables: placeholdersIn(body), is_active: isActive, msg91_template_id: msg91TemplateId || null })
    .select('template_key,body,variables,is_active,msg91_template_id,updated_at')
    .single()
  if (error) {
    const duplicate = error.code === '23505'
    return response.status(duplicate ? 409 : 400).json({ error: duplicate ? 'A template with this key already exists' : error.message })
  }
  await audit(request.authUser!.id, 'sms_template.created', templateKey, { body, isActive, msg91TemplateId: msg91TemplateId || null })
  response.status(201).json(toTemplate(data as TemplateRow))
})

router.patch('/sms-templates/:key', async (request, response) => {
  const key = String(request.params.key)
  const parsed = updateSchema.safeParse(request.body)
  if (!parsed.success) return response.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid SMS template' })
  const { body, isActive, msg91TemplateId } = parsed.data

  const { data: current, error: readError } = await supabase.from('sms_templates').select('body').eq('template_key', key).maybeSingle()
  if (readError) return response.status(500).json({ error: readError.message })
  if (!current) return response.status(404).json({ error: 'SMS template not found' })

  const nextBody = body ?? current.body
  const placeholderIssue = placeholderError(key, nextBody)
  if (placeholderIssue) return response.status(400).json({ error: placeholderIssue })

  const update: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (body !== undefined) {
    update.body = body
    update.variables = placeholdersIn(body)
  }
  if (isActive !== undefined) update.is_active = isActive
  if (msg91TemplateId !== undefined) update.msg91_template_id = msg91TemplateId || null

  const { data, error } = await supabase
    .from('sms_templates')
    .update(update)
    .eq('template_key', key)
    .select('template_key,body,variables,is_active,msg91_template_id,updated_at')
    .single()
  if (error) return response.status(400).json({ error: error.message })

  invalidateSmsTemplateCache(key)
  await audit(request.authUser!.id, 'sms_template.updated', key, { body, isActive, msg91TemplateId })
  response.json(toTemplate(data as TemplateRow))
})

export default router
