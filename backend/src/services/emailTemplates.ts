import { supabase } from '../supabase.js'
import { sendEmail } from './providers.js'

export const emailTemplateVariables = {
  user_registration_otp: ['otp'],
  guest_booking_confirmation: ['reference', 'trackingUrl'],
  vendor_acceptance: ['reference', 'vehicle', 'driver', 'trackingUrl', 'customerMapDetail'],
  delivery_confirmation: ['reference'],
  booking_pending_vendor: ['reference', 'detail', 'trackingUrl'],
  booking_vendor_assigned: ['reference', 'detail', 'trackingUrl'],
  booking_accepted: ['reference', 'detail', 'trackingUrl'],
  booking_en_route: ['reference', 'detail', 'trackingUrl'],
  booking_arrived: ['reference', 'detail', 'trackingUrl'],
  booking_cancelled: ['reference', 'detail', 'trackingUrl'],
  booking_payment_online: ['reference', 'detail', 'trackingUrl'],
  booking_payment_cod: ['reference', 'detail', 'trackingUrl'],
  booking_rescheduled: ['reference', 'detail', 'trackingUrl'],
  booking_delivered: ['reference', 'detail', 'trackingUrl'],
  vendor_application_approved: ['businessName', 'reference'],
  vendor_application_rejected: ['businessName', 'reference', 'reviewNote'],
  vendor_account_approved: ['name', 'loginUrl'],
  vendor_account_rejected: ['name'],
  vendor_profile_approved: ['businessName', 'loginUrl'],
  vendor_profile_rejected: ['businessName'],
} as const

export type EmailTemplateKey = keyof typeof emailTemplateVariables

export const bookingStatusEmailTemplates = {
  pending_vendor: 'booking_pending_vendor',
  vendor_assigned: 'booking_vendor_assigned',
  accepted: 'booking_accepted',
  en_route: 'booking_en_route',
  arrived: 'booking_arrived',
  cancelled: 'booking_cancelled',
  payment_online: 'booking_payment_online',
  payment_cod: 'booking_payment_cod',
  rescheduled: 'booking_rescheduled',
  delivered: 'booking_delivered',
} as const

export const emailTemplateRequiredVariables: Record<EmailTemplateKey, readonly string[]> = {
  user_registration_otp: ['otp'],
  guest_booking_confirmation: ['reference', 'trackingUrl'],
  vendor_acceptance: ['reference', 'vehicle', 'driver', 'trackingUrl'],
  delivery_confirmation: ['reference'],
  booking_pending_vendor: ['reference', 'detail', 'trackingUrl'],
  booking_vendor_assigned: ['reference', 'detail', 'trackingUrl'],
  booking_accepted: ['reference', 'detail', 'trackingUrl'],
  booking_en_route: ['reference', 'detail', 'trackingUrl'],
  booking_arrived: ['reference', 'detail', 'trackingUrl'],
  booking_cancelled: ['reference', 'detail', 'trackingUrl'],
  booking_payment_online: ['reference', 'detail', 'trackingUrl'],
  booking_payment_cod: ['reference', 'detail', 'trackingUrl'],
  booking_rescheduled: ['reference', 'detail', 'trackingUrl'],
  booking_delivered: ['reference', 'detail', 'trackingUrl'],
  vendor_application_approved: ['businessName', 'reference'],
  vendor_application_rejected: ['businessName', 'reference', 'reviewNote'],
  vendor_account_approved: ['name', 'loginUrl'],
  vendor_account_rejected: ['name'],
  vendor_profile_approved: ['businessName', 'loginUrl'],
  vendor_profile_rejected: ['businessName'],
}

const cacheTtlMs = 5 * 60 * 1000
const templateCache = new Map<string, { subject: string; body: string; expiresAt: number }>()

export function invalidateEmailTemplateCache(key?: string) {
  if (key) templateCache.delete(key)
  else templateCache.clear()
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character]!)
}

export function placeholdersInEmailTemplate(value: string) {
  return [...new Set([...value.matchAll(/\{\{(\w+)\}\}/g)].map((match) => match[1]!))]
}

export function emailTemplatePlaceholderError(key: string, subject: string, body: string) {
  if (!Object.hasOwn(emailTemplateVariables, key)) return `Unknown email template "${key}"`
  const allowed = emailTemplateVariables[key as EmailTemplateKey]
  const present = placeholdersInEmailTemplate(`${subject}\n${body}`)
  const unknown = present.filter((name) => !allowed.some((allowedName) => allowedName === name))
  if (unknown.length) return `Unknown placeholder(s): ${unknown.map((name) => `{{${name}}}`).join(', ')}`
  const bodyPlaceholders = placeholdersInEmailTemplate(body)
  const missing = emailTemplateRequiredVariables[key as EmailTemplateKey].filter((name) => !bodyPlaceholders.includes(name))
  if (missing.length) return `Missing required placeholder(s): ${missing.map((name) => `{{${name}}}`).join(', ')}`
  return null
}

export function renderEmailTemplate(subject: string, body: string, vars: Record<string, string>) {
  const render = (value: string) => value.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => {
    if (!(name in vars)) throw new Error(`Email template is missing variable ${name}`)
    return String(vars[name] ?? '').replace(/[\r\n]/g, ' ')
  })
  const renderedSubject = render(subject)
  const safeBody = escapeHtml(render(body))
  const paragraphs = safeBody
    .split(/\n{2,}/)
    .map((paragraph) => `<p style="margin:0 0 16px;line-height:1.6">${paragraph.replace(/\n/g, '<br>')}</p>`)
    .join('')
  return {
    subject: renderedSubject,
    html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;color:#173b35"><p style="margin:0 0 24px;color:#087f70;font-size:13px;font-weight:bold;letter-spacing:1px">URBAN TANKER</p><h1 style="margin:0 0 20px;font-size:24px">${escapeHtml(renderedSubject)}</h1>${paragraphs}<p style="margin:28px 0 0;color:#65736f;font-size:13px">Thank you for choosing Urban Tanker.</p></div>`,
  }
}

async function loadEmailTemplate(key: string) {
  const cached = templateCache.get(key)
  if (cached && cached.expiresAt > Date.now()) return cached
  const { data, error } = await supabase
    .from('email_templates')
    .select('subject,body,is_active')
    .eq('template_key', key)
    .maybeSingle()
  if (error) throw new Error(`Email template ${key} could not be loaded: ${error.message}`)
  if (!data || !data.is_active) return null
  const template = { subject: String(data.subject), body: String(data.body) }
  templateCache.set(key, { ...template, expiresAt: Date.now() + cacheTtlMs })
  return template
}

export async function sendTemplateEmail(key: EmailTemplateKey, to: string, vars: Record<string, string>) {
  try {
    const template = await loadEmailTemplate(key)
    if (!template) return { queued: false, reason: `Email template ${key} is missing or inactive` }
    const rendered = renderEmailTemplate(template.subject, template.body, vars)
    return await sendEmail(to, rendered.subject, rendered.html)
  } catch (error) {
    return { queued: false, reason: error instanceof Error ? error.message : 'Email could not be sent' }
  }
}
