import { config } from '../config.js'
import { supabase } from '../supabase.js'
import { sendSms } from './providers.js'

// Template bodies live in the sms_templates table (edit them there). The MSG91 template IDs stay in config/env.
export const smsTemplateKeys = [
  'user_registration_otp',
  'booking_verification_otp',
  'guest_booking_confirmation',
  'vendor_acceptance',
  'delivery_confirmation',
  'delivery_otp',
] as const

export type SmsTemplateKey = (typeof smsTemplateKeys)[number]

// Variables each code path passes to a template. Edited bodies may only use these placeholders.
export const smsTemplateVariables: Record<SmsTemplateKey, readonly string[]> = {
  user_registration_otp: ['otp'],
  booking_verification_otp: ['otp'],
  guest_booking_confirmation: ['reference'],
  vendor_acceptance: ['reference', 'vehicle', 'driver', 'trackingUrl'],
  delivery_confirmation: ['reference'],
  delivery_otp: ['reference', 'otp'],
}

const templateCacheTtlMs = 5 * 60 * 1000
const templateCache = new Map<string, { body: string; msg91TemplateId: string | null; expiresAt: number }>()

// Called after an admin edits a template so this process picks up the change immediately.
export function invalidateSmsTemplateCache(key?: string) {
  if (key) templateCache.delete(key)
  else templateCache.clear()
}

// Placeholders use {{name}}; the same names are sent as Flow variables to MSG91.
export function renderSmsTemplate(body: string, vars: Record<string, string>) {
  return body.replace(/\{\{(\w+)\}\}/g, (_match: string, name: string) => {
    if (!(name in vars)) throw new Error(`SMS template is missing variable ${name}`)
    return vars[name] ?? ''
  })
}

type LoadedSmsTemplate = { body: string; msg91TemplateId: string | null }

// Works for built-in and custom keys. Returns null when the key is missing or inactive.
async function loadSmsTemplate(key: string): Promise<LoadedSmsTemplate | null> {
  const cached = templateCache.get(key)
  if (cached && cached.expiresAt > Date.now()) return cached
  const { data, error } = await supabase
    .from('sms_templates')
    .select('body,is_active,msg91_template_id')
    .eq('template_key', key)
    .maybeSingle()
  if (error) throw new Error(`SMS template ${key} could not be loaded: ${error.message}`)
  if (!data || !data.is_active) return null
  const loaded = { body: data.body as string, msg91TemplateId: (data.msg91_template_id as string | null) || null }
  templateCache.set(key, { ...loaded, expiresAt: Date.now() + templateCacheTtlMs })
  return loaded
}

// MSG91 expects digits only with the country code, e.g. 919876543210.
export function toMsg91Mobile(phoneE164: string) {
  return phoneE164.replace(/\D/g, '')
}

// The database value wins. Built-in keys fall back to the MSG91 IDs in env config.
function resolveMsg91TemplateId(key: string, stored: string | null): string | undefined {
  if (stored) return stored
  if (!(smsTemplateKeys as readonly string[]).includes(key)) return undefined
  const ids: Record<SmsTemplateKey, string | undefined> = {
    user_registration_otp: config.MSG91_TEMPLATE_ID_USER_REGISTRATION_OTP,
    booking_verification_otp: config.MSG91_TEMPLATE_ID_BOOKING_VERIFICATION_OTP,
    guest_booking_confirmation: config.MSG91_TEMPLATE_ID_GUEST_BOOKING_CONFIRMATION,
    vendor_acceptance: config.MSG91_TEMPLATE_ID_VENDOR_ACCEPTANCE,
    delivery_confirmation: config.MSG91_TEMPLATE_ID_DELIVERY_CONFIRMATION,
    delivery_otp: config.MSG91_TEMPLATE_ID_DELIVERY_OTP,
  }
  return ids[key as SmsTemplateKey]
}

// Flow request body. The sender ID is set on the approved template in MSG91, so it is not sent here.
// Template variables go into each recipient object by name, matching the ##name## variables on the template.
export function buildMsg91FlowPayload(templateId: string, phoneE164: string, vars: Record<string, string>) {
  return {
    template_id: templateId,
    short_url: '0',
    recipients: [{ mobiles: toMsg91Mobile(phoneE164), ...vars }],
  }
}

async function sendMsg91Flow(templateId: string, phoneE164: string, vars: Record<string, string>) {
  if (!config.MSG91_AUTH_KEY) throw new Error('MSG91 auth key is not configured')
  const response = await fetch('https://control.msg91.com/api/v5/flow/', {
    method: 'POST',
    headers: { authkey: config.MSG91_AUTH_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(buildMsg91FlowPayload(templateId, phoneE164, vars)),
  })
  const result = (await response.json().catch(() => ({}))) as { type?: string; message?: string }
  if (!response.ok || result.type !== 'success') {
    throw new Error(`MSG91 SMS failed: ${response.status} ${result.message ?? ''}`.trim())
  }
  return { queued: true, provider: 'msg91' as const, requestId: result.message }
}

// Sends a DLT-approved template by key through the provider chosen by SMS_PROVIDER.
// Works for built-in and custom templates. Twilio stays available: set SMS_PROVIDER=twilio to switch back.
export async function sendTemplateSms(key: string, phoneE164: string, vars: Record<string, string>) {
  let template: LoadedSmsTemplate | null
  try {
    template = await loadSmsTemplate(key)
  } catch (error) {
    return { queued: false, reason: error instanceof Error ? error.message : 'SMS template could not be loaded' }
  }
  if (!template) return { queued: false, reason: `SMS template ${key} is missing or inactive` }

  try {
    // Every placeholder in the body needs a value. Throws otherwise, so nothing is sent with blank text.
    const text = renderSmsTemplate(template.body, vars)
    if (config.SMS_PROVIDER === 'twilio') return await sendSms(phoneE164, text)
    const templateId = resolveMsg91TemplateId(key, template.msg91TemplateId)
    if (!templateId) return { queued: false, reason: `MSG91 template ID for ${key} is not configured` }
    return await sendMsg91Flow(templateId, phoneE164, vars)
  } catch (error) {
    return { queued: false, reason: error instanceof Error ? error.message : 'SMS could not be sent' }
  }
}

