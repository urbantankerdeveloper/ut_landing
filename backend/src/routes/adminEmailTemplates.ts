import { z } from 'zod'
import express, { Router } from 'express'
import { requireAuth, requireRole } from '../middleware/auth.js'
import { config } from '../config.js'
import { logger } from '../lib/logger.js'
import { supabase } from '../supabase.js'
import {
  emailTemplatePlaceholderError,
  emailTemplateVariables,
  invalidateEmailTemplateCache,
  type EmailTemplateKey,
} from '../services/emailTemplates.js'

const router = Router()
const legacyRouterAuth = (request: express.Request, response: express.Response, next: express.NextFunction) => config.featureFlags.AUTH_MOUNT_ONCE ? next() : requireAuth(request, response, next)
router.use('/email-templates', legacyRouterAuth, requireRole('admin'))

const templateKeys = Object.keys(emailTemplateVariables) as [EmailTemplateKey, ...EmailTemplateKey[]]
const keySchema = z.enum(templateKeys)
const updateSchema = z.object({
  subject: z.string().trim().min(1).max(200).regex(/^[^\r\n]+$/, 'Subject must be a single line'),
  body: z.string().trim().min(1).max(12000),
})

type EmailTemplateRow = {
  template_key: string
  subject: string
  body: string
  variables: string[]
  is_active: boolean
  updated_at: string
}

function toTemplate(row: EmailTemplateRow) {
  const key = row.template_key as EmailTemplateKey
  return {
    templateKey: row.template_key,
    subject: row.subject,
    body: row.body,
    variables: row.variables,
    isActive: row.is_active,
    updatedAt: row.updated_at,
    allowedVariables: emailTemplateVariables[key],
  }
}

async function audit(actorId: string, action: string, templateKey: string, metadata: Record<string, unknown>) {
  const { error } = await supabase.from('audit_logs').insert({
    actor_id: actorId,
    action,
    entity_type: 'email_template',
    entity_id: null,
    metadata: { templateKey, ...metadata },
  })
  if (error) logger.warn('admin.email_template_audit_failed', { templateKey, action, error: error.message })
}

router.get('/email-templates', async (_request, response) => {
  const { data, error } = await supabase
    .from('email_templates')
    .select('template_key,subject,body,variables,is_active,updated_at')
    .in('template_key', templateKeys)
    .order('template_key', { ascending: true })
  if (error) return response.status(500).json({ error: error.message })
  response.json({ rows: (data ?? []).map((row) => toTemplate(row as EmailTemplateRow)) })
})

router.patch('/email-templates/:key', async (request, response) => {
  const key = keySchema.safeParse(String(request.params.key))
  if (!key.success) return response.status(404).json({ error: 'Email template not found' })
  const parsed = updateSchema.safeParse(request.body)
  if (!parsed.success) return response.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid email template' })
  const { subject, body } = parsed.data
  const placeholderIssue = emailTemplatePlaceholderError(key.data, subject, body)
  if (placeholderIssue) return response.status(400).json({ error: placeholderIssue })

  const { data, error } = await supabase
    .from('email_templates')
    .update({
      subject,
      body,
      variables: [...new Set([...subject.matchAll(/\{\{(\w+)\}\}/g), ...body.matchAll(/\{\{(\w+)\}\}/g)].map((match) => match[1]!))],
      updated_at: new Date().toISOString(),
    })
    .eq('template_key', key.data)
    .select('template_key,subject,body,variables,is_active,updated_at')
    .maybeSingle()
  if (error) return response.status(400).json({ error: error.message })
  if (!data) return response.status(404).json({ error: 'Email template not found' })

  invalidateEmailTemplateCache(key.data)
  await audit(request.authUser!.id, 'email_template.updated', key.data, { subject, body })
  response.json(toTemplate(data as EmailTemplateRow))
})

export default router
