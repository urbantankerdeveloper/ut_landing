import { config } from '../config.js'
import { supabase } from '../supabase.js'
import {
  smsTemplateKeys,
  smsTemplateRequiredVariables,
  type SmsTemplateKey,
  renderSmsTemplate,
  invalidateSmsTemplateCache,
} from './sms.js'

export type { SmsTemplateKey } from './sms.js'

const templateCache = new Map<string, { body: string; expiresAt: number }>()
const cacheTtlMs = 5 * 60 * 1000

function maskWhatsAppRecipient(value: string) {
  const digits = value.replace(/\D/g, '')
  return digits.length > 4
    ? `${digits.slice(0, 2)}******${digits.slice(-2)}`
    : '****'
}

type CombirdsButton = {
  type: string
  sub_type: string
  index: number
  parameters: Array<{ type: string; text: string }>
}

function resolveCombirdsButtons(
  vars: Record<string, string>,
): CombirdsButton[] {
  const raw = config.COMBIRDS_WABA_BUTTONS_JSON
  if (!raw) return []

  let parsed: unknown

  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error('COMBIRDS_WABA_BUTTONS_JSON must contain valid JSON')
  }

  if (!Array.isArray(parsed)) {
    throw new Error('COMBIRDS_WABA_BUTTONS_JSON must be a JSON array')
  }

  return parsed.map((button, buttonIndex) => {
    if (!button || typeof button !== 'object') {
      throw new Error(`Combirds button ${buttonIndex} is invalid`)
    }

    const item = button as Record<string, unknown>

    if (
      typeof item.type !== 'string' ||
      typeof item.sub_type !== 'string' ||
      !Number.isInteger(item.index) ||
      !Array.isArray(item.parameters)
    ) {
      throw new Error(
        `Combirds button ${buttonIndex} must include type, sub_type, index and parameters`,
      )
    }

    const parameters = item.parameters.map(
      (parameter, parameterIndex) => {
        if (!parameter || typeof parameter !== 'object') {
          throw new Error(
            `Combirds button ${buttonIndex} parameter ${parameterIndex} is invalid`,
          )
        }

        const value = parameter as Record<string, unknown>

        if (
          typeof value.type !== 'string' ||
          typeof value.text !== 'string'
        ) {
          throw new Error(
            `Combirds button ${buttonIndex} parameter ${parameterIndex} must include type and text`,
          )
        }

        const text = value.text.replace(
          /\{\{(\w+)\}\}/g,
          (_match, key: string) => {
            if (!(key in vars) || !String(vars[key] ?? '').trim()) {
              throw new Error(`WhatsApp button is missing variable ${key}`)
            }

            return String(vars[key])
          },
        )

        return {
          type: value.type,
          text,
        }
      },
    )

    return {
      type: item.type,
      sub_type: item.sub_type,
      index: Number(item.index),
      parameters,
    }
  })
}

function parseCombirdsResponse(
  responseText: string,
): Record<string, unknown> {
  if (!responseText.trim()) return {}

  try {
    const parsed: unknown = JSON.parse(responseText)

    return parsed && typeof parsed === 'object'
      ? (parsed as Record<string, unknown>)
      : { response: parsed }
  } catch {
    return { response: responseText }
  }
}

function providerRejected(result: Record<string, unknown>) {
  const status =
    typeof result.status === 'string'
      ? result.status.toLowerCase()
      : ''

  const type =
    typeof result.type === 'string'
      ? result.type.toLowerCase()
      : ''

  return (
    result.success === false ||
    result.success === 'false' ||
    ['error', 'failed', 'failure', 'rejected'].includes(status) ||
    ['error', 'failed', 'failure'].includes(type) ||
    Boolean(result.error)
  )
}

// function resolveCampaignName(key: SmsTemplateKey) {
//   const campaignNames: Record<SmsTemplateKey, string | undefined> = {
//     user_registration_otp:
//       config.COMBIRDS_CAMPAIGN_USER_REGISTRATION_OTP ??
//       config.COMBIRDS_WABA_CAMPAIGN_NAME,

//     booking_verification_otp:
//       config.COMBIRDS_CAMPAIGN_BOOKING_VERIFICATION_OTP ??
//       config.COMBIRDS_WABA_CAMPAIGN_NAME,

//     guest_booking_confirmation:
//       config.COMBIRDS_CAMPAIGN_GUEST_BOOKING_CONFIRMATION ??
//       config.COMBIRDS_WABA_CAMPAIGN_NAME,

//     vendor_acceptance:
//       config.COMBIRDS_CAMPAIGN_VENDOR_ACCEPTANCE ??
//       config.COMBIRDS_WABA_CAMPAIGN_NAME,

//     delivery_confirmation:
//       config.COMBIRDS_CAMPAIGN_DELIVERY_CONFIRMATION ??
//       config.COMBIRDS_WABA_CAMPAIGN_NAME,

//     delivery_otp:
//       config.COMBIRDS_CAMPAIGN_DELIVERY_OTP ??
//       config.COMBIRDS_WABA_CAMPAIGN_NAME,

//     cod_switched_to_online:
//       config.COMBIRDS_CAMPAIGN_COD_SWITCHED_TO_ONLINE ??
//       config.COMBIRDS_WABA_CAMPAIGN_NAME,

//     cod_reverted_to_cash:
//       config.COMBIRDS_CAMPAIGN_COD_REVERTED_TO_CASH ??
//       config.COMBIRDS_WABA_CAMPAIGN_NAME,
//   }

//   return campaignNames[key]
// }

function resolveCampaignName(key: SmsTemplateKey) {
  const campaignNames: Record<SmsTemplateKey, string | undefined> = {
    user_registration_otp:
      config.COMBIRDS_CAMPAIGN_USER_REGISTRATION_OTP ??
      config.COMBIRDS_WABA_CAMPAIGN_NAME,

    booking_verification_otp:
      config.COMBIRDS_CAMPAIGN_BOOKING_VERIFICATION_OTP ??
      config.COMBIRDS_WABA_CAMPAIGN_NAME,

    guest_booking_confirmation:
      config.COMBIRDS_CAMPAIGN_GUEST_BOOKING_CONFIRMATION ??
      config.COMBIRDS_WABA_CAMPAIGN_NAME,

    vendor_acceptance:
      config.COMBIRDS_CAMPAIGN_VENDOR_ACCEPTANCE ??
      config.COMBIRDS_WABA_CAMPAIGN_NAME,

    delivery_confirmation:
      config.COMBIRDS_CAMPAIGN_DELIVERY_CONFIRMATION ??
      config.COMBIRDS_WABA_CAMPAIGN_NAME,

    delivery_otp:
      config.COMBIRDS_CAMPAIGN_DELIVERY_OTP ??
      config.COMBIRDS_WABA_CAMPAIGN_NAME,

    cod_switched_to_online:
      config.COMBIRDS_CAMPAIGN_COD_SWITCHED_TO_ONLINE ??
      config.COMBIRDS_WABA_CAMPAIGN_NAME,

    cod_reverted_to_cash:
      config.COMBIRDS_CAMPAIGN_COD_REVERTED_TO_CASH ??
      config.COMBIRDS_WABA_CAMPAIGN_NAME,
  }

  return campaignNames[key]
}

export function toWhatsAppRecipient(phone: string) {
  const digits = phone.replace(/\D/g, '')

  if (digits.length < 8 || digits.length > 15) {
    throw new Error(
      'WhatsApp recipient must be an international phone number with country code',
    )
  }

  return digits
}

export function toCombirdsAttributeName(key: string) {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map(
      (part) => part.charAt(0).toUpperCase() + part.slice(1),
    )
    .join('')
}

export function buildCombirdsCampaignPayload(
  apiKey: string,
  campaignName: string,
  destination: string,
  userName: string,
  source: string,
  body: string,
  vars: Record<string, string>,
) {
  const placeholders = [
    ...body.matchAll(/\{\{(\w+)\}\}/g),
  ].map((match) => match[1]!)

  const resolvedParams = placeholders.map((key) => {
    if (!(key in vars)) {
      throw new Error(
        `WhatsApp template is missing variable ${key}`,
      )
    }

    const value = String(vars[key] ?? '')

    if (!value.trim()) {
      throw new Error(
        `WhatsApp template variable ${key} cannot be empty`,
      )
    }

    return { key, value }
  })
  const paramsFallbackValue = Object.fromEntries(resolvedParams.map(({ key, value }) => [
    toCombirdsAttributeName(key),
    value,
  ]))
  const templateParams = resolvedParams.map(({ value }) => value)

  return {
    apiKey,
    campaignName,
    destination: toWhatsAppRecipient(destination),
    userName: config.COMBIRDS_CAMPAIGN_USER_NAME ?? userName,
    templateParams,
    paramsFallbackValue,
    source,
    media: {},
    buttons: resolveCombirdsButtons(vars),
    carouselCards: [],
    location: {},
    attributes: {},
  }
}

async function loadTemplate(key: string) {
  const cached = templateCache.get(key)

  if (cached && cached.expiresAt > Date.now()) {
    return cached.body
  }

  const { data, error } = await supabase
    .from('sms_templates')
    .select('body,is_active')
    .eq('template_key', key)
    .maybeSingle()

  if (error) {
    throw new Error(
      `WhatsApp template ${key} could not be loaded: ${error.message}`,
    )
  }

  if (!data || !data.is_active) return null

  const body = String(data.body)

  templateCache.set(key, {
    body,
    expiresAt: Date.now() + cacheTtlMs,
  })

  return body
}

export function invalidateWhatsAppTemplateCache(key?: string) {
  if (key) {
    templateCache.delete(key)
  } else {
    templateCache.clear()
  }

  invalidateSmsTemplateCache(key)
}

export async function sendTemplateWhatsApp(
  key: string,
  phoneE164: string,
  vars: Record<string, string>,
) {
  const fail = (reason: string) => {
    console.error('[WhatsApp OTP] Send skipped', {
      template: key,
      destination: maskWhatsAppRecipient(phoneE164),
    })

    return {
      queued: false as const,
      reason,
    }
  }

  try {
    if (!config.COMBIRDS_WABA_API_KEY?.trim()) {
      return fail('Combirds WhatsApp API key is not configured')
    }

    if (!config.COMBIRDS_CAMPAIGN_USER_NAME) {
      return fail(
        'Combirds WhatsApp campaign user name is not configured',
      )
    }

    if (!(smsTemplateKeys as readonly string[]).includes(key)) {
      return fail(
        `WhatsApp template ${key} has no configured Combirds campaign mapping`,
      )
    }

    const campaignName = resolveCampaignName(key as SmsTemplateKey)

    if (!campaignName) {
      return fail(
        `Combirds campaign name for ${key} is not configured`,
      )
    }

    const body = await loadTemplate(key)

    if (!body) {
      return fail(
        `WhatsApp template ${key} is missing or inactive`,
      )
    }

    const requiredVariables =
      smsTemplateRequiredVariables[key as SmsTemplateKey] ?? []

    const bodyPlaceholders = new Set(
      [...body.matchAll(/\{\{(\w+)\}\}/g)].map(
        (match) => match[1]!,
      ),
    )

    const missingRequired = requiredVariables.filter(
      (name) => !bodyPlaceholders.has(name),
    )

    if (missingRequired.length) {
      throw new Error(
        `WhatsApp template ${key} must include ${missingRequired
          .map((name) => `{{${name}}}`)
          .join(', ')}`,
      )
    }

    renderSmsTemplate(body, vars)

    const payload = buildCombirdsCampaignPayload(
      config.COMBIRDS_WABA_API_KEY,
      campaignName,
      phoneE164,
      config.COMBIRDS_CAMPAIGN_USER_NAME,
      config.COMBIRDS_WABA_SOURCE,
      body,
      vars,
    )

    // Never log the API key, OTP, button parameters or full recipient.
    console.info('[WhatsApp OTP] Sending request to Combirds', {
      campaignName: payload.campaignName,
      destination: maskWhatsAppRecipient(phoneE164),
      userName: payload.userName,
      source: payload.source,
      templateParameterCount: payload.templateParams.length,
      buttonCount: payload.buttons.length,
    })

    const response = await fetch(config.COMBIRDS_WABA_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15_000),
    })

    const responseText = await response.text()
    const result = parseCombirdsResponse(responseText)

    if (!response.ok || providerRejected(result)) {
      const errorValue = result.error

      const providerError =
        typeof errorValue === 'string'
          ? errorValue
          : errorValue &&
              typeof errorValue === 'object' &&
              'message' in errorValue
            ? String(
                (errorValue as { message?: unknown }).message ?? '',
              )
            : undefined

      const message =
        providerError ||
        String(
          result.message ??
            result.response ??
            'Provider rejected the request',
        )

      throw new Error(
        `Combirds WhatsApp API failed (${response.status}): ${message.slice(0, 500)}`,
      )
    }

    const requestId =
      result.submitted_message_id ??
      result.messageId ??
      result.message_id ??
      result.id

    console.info('[WhatsApp OTP] Combirds request accepted', {
      template: key,
      campaignName,
      destination: maskWhatsAppRecipient(phoneE164),
      httpStatus: response.status,
    })

    return {
      queued: true as const,
      provider: 'combirds-whatsapp' as const,
      requestId:
        typeof requestId === 'string' ? requestId : undefined,
      providerResponse: result,
    }
  } catch (error) {
    const reason =
      error instanceof Error
        ? error.message
        : 'WhatsApp message could not be sent'

    console.error('[WhatsApp OTP] Send failed', {
      template: key,
      destination: maskWhatsAppRecipient(phoneE164),
    })

    return {
      queued: false as const,
      reason,
    }
  }
}