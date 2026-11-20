import { beforeEach, describe, expect, it, vi } from 'vitest'
const state = vi.hoisted(() => ({
  config: {
    COMBIRDS_WABA_API_KEY: 'test-api-key' as string | undefined,
    COMBIRDS_WABA_CAMPAIGN_NAME: 'URBAN TANKER' as string | undefined,
    COMBIRDS_WABA_SOURCE: 'backend-tests',
    COMBIRDS_WABA_ENDPOINT: 'https://backend.api-wa.co/campaign/combirds/api/v2',
    COMBIRDS_WABA_BUTTONS_JSON: undefined as string | undefined,
    COMBIRDS_CAMPAIGN_USER_NAME: 'Urban Tanker',
    COMBIRDS_CAMPAIGN_USER_REGISTRATION_OTP: undefined as string | undefined,
  },
  rows: new Map<string, { body: string; is_active: boolean }>(),
}))
vi.mock('../config.js', () => ({ config: state.config }))
vi.mock('../supabase.js', () => ({ supabase: { from: () => ({ select: () => ({ eq: (_field: string, key: string) => ({ maybeSingle: async () => ({ data: state.rows.get(key) ?? null, error: null }) }) }) }) } }))
vi.mock('./sms.js', () => ({
  smsTemplateKeys: ['user_registration_otp', 'booking_verification_otp', 'delivery_otp'],
  smsTemplateRequiredVariables: {
    user_registration_otp: ['otp'],
    booking_verification_otp: ['otp'],
    delivery_otp: ['otp'],
  },
  renderSmsTemplate: (body: string, vars: Record<string, string>) => body.replace(/\{\{(\w+)\}\}/g, (_m: string, k: string) => { if (!(k in vars)) throw new Error(`SMS template is missing variable ${k}`); return vars[k]! }),
  invalidateSmsTemplateCache: vi.fn(),
}))
import { buildCombirdsCampaignPayload, sendTemplateWhatsApp, toCombirdsAttributeName, toWhatsAppRecipient } from './whatsapp.js'

describe('Combirds WhatsApp campaign API', () => {
  beforeEach(() => {
    state.rows.clear()
    state.config.COMBIRDS_WABA_API_KEY = 'test-api-key'
    state.config.COMBIRDS_WABA_CAMPAIGN_NAME = 'URBAN TANKER'
    state.config.COMBIRDS_CAMPAIGN_USER_REGISTRATION_OTP = undefined
    state.config.COMBIRDS_WABA_BUTTONS_JSON = undefined
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ status: 'success', submitted_message_id: 'combirds-123' }), { status: 200 })))
  })

  it('normalizes international recipients', () => expect(toWhatsAppRecipient('+91 98765-43210')).toBe('919876543210'))
  it('rejects short or local-only numbers', () => expect(() => toWhatsAppRecipient('12345')).toThrow('international phone number'))
  it('converts snake_case and camelCase placeholders to Combirds attribute names', () => {
    expect(toCombirdsAttributeName('first_name')).toBe('FirstName')
    expect(toCombirdsAttributeName('trackingUrl')).toBe('TrackingUrl')
  })
  it('builds Combirds v2 payload with ordered resolved values and attributes', () => {
    const payload = buildCombirdsCampaignPayload('key', 'URBAN TANKER', '+919876543210', 'Maneesh', 'website', 'Hello {{first_name}}, OTP {{otp}}', { first_name: 'Maneesh', otp: '123456' })
    expect(payload).toMatchObject({
      apiKey: 'key', campaignName: 'URBAN TANKER', destination: '919876543210', userName: 'Urban Tanker',
      templateParams: ['Maneesh', '123456'], source: 'website',
      paramsFallbackValue: { FirstName: 'Maneesh', Otp: '123456' },
      attributes: {}, media: {}, buttons: [], carouselCards: [], location: {},
    })
  })
  it('sends to the Combirds campaign endpoint and returns the submitted message ID', async () => {
    state.rows.set('user_registration_otp', { body: 'Your code is {{otp}}', is_active: true })
    const result = await sendTemplateWhatsApp('user_registration_otp', '+919876543210', { otp: '123456' })
    expect(result).toMatchObject({ queued: true, provider: 'combirds-whatsapp', requestId: 'combirds-123' })
    const [url, init] = vi.mocked(fetch).mock.calls[0]!
    expect(String(url)).toBe('https://backend.api-wa.co/campaign/combirds/api/v2')
    expect(init?.headers).toMatchObject({ 'Content-Type': 'application/json' })
    expect(JSON.parse(String(init?.body))).toMatchObject({ apiKey: 'test-api-key', campaignName: 'URBAN TANKER', destination: '919876543210', templateParams: ['123456'], attributes: {}, paramsFallbackValue: { Otp: '123456' } })
  })
  it('sends resolved values for booking and delivery OTP campaign parameters', async () => {
    state.rows.set('booking_verification_otp', { body: 'Your code is {{otp}}', is_active: true })
    state.rows.set('delivery_otp', { body: 'Booking {{reference}} code {{otp}}', is_active: true })

    await sendTemplateWhatsApp('booking_verification_otp', '+919876543210', { otp: '654321' })
    await sendTemplateWhatsApp('delivery_otp', '+919876543210', { reference: 'UT-ORDER', otp: '123456' })

    const bookingPayload = JSON.parse(String(vi.mocked(fetch).mock.calls[0]?.[1]?.body))
    const deliveryPayload = JSON.parse(String(vi.mocked(fetch).mock.calls[1]?.[1]?.body))
    expect(bookingPayload.templateParams).toEqual(['654321'])
    expect(deliveryPayload.templateParams).toEqual(['UT-ORDER', '123456'])
    expect(JSON.stringify([bookingPayload, deliveryPayload])).not.toContain('$Otp')
  })
  it('uses a per-template campaign name when configured', async () => {
    state.config.COMBIRDS_CAMPAIGN_USER_REGISTRATION_OTP = 'REGISTRATION OTP LIVE'
    state.rows.set('user_registration_otp', { body: 'Your code is {{otp}}', is_active: true })
    await sendTemplateWhatsApp('user_registration_otp', '+919876543210', { otp: '123456' })
    const [, init] = vi.mocked(fetch).mock.calls[0]!
    expect(JSON.parse(String(init?.body)).campaignName).toBe('REGISTRATION OTP LIVE')
  })
  it('does not send if API key, campaign, template row or variables are missing', async () => {
    state.rows.set('user_registration_otp', { body: 'Your code is {{otp}}', is_active: true })
    state.config.COMBIRDS_WABA_API_KEY = undefined
    expect((await sendTemplateWhatsApp('user_registration_otp', '+919876543210', { otp: '1' })).queued).toBe(false)
    state.config.COMBIRDS_WABA_API_KEY = 'test-api-key'
    state.config.COMBIRDS_WABA_CAMPAIGN_NAME = undefined
    expect((await sendTemplateWhatsApp('user_registration_otp', '+919876543210', { otp: '1' })).queued).toBe(false)
    state.config.COMBIRDS_WABA_CAMPAIGN_NAME = 'URBAN TANKER'
    expect((await sendTemplateWhatsApp('user_registration_otp', '+919876543210', {})).queued).toBe(false)
    expect(fetch).not.toHaveBeenCalled()
  })
  it('returns provider errors without throwing', async () => {
    state.rows.set('user_registration_otp', { body: 'Your code is {{otp}}', is_active: true })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ success: false, message: 'Invalid API key' }), { status: 401 })))
    const result = await sendTemplateWhatsApp('user_registration_otp', '+919876543210', { otp: '1' })
    expect('reason' in result && result.reason).toContain('Invalid API key')
  })
  it('accepts a successful 2xx Combirds response without a success boolean', async () => {
    state.rows.set('user_registration_otp', { body: 'Your code is {{otp}}', is_active: true })
    vi.stubGlobal('fetch', vi.fn(async () => new Response('Message submitted successfully', { status: 200 })))
    expect((await sendTemplateWhatsApp('user_registration_otp', '+919876543210', { otp: '123456' })).queued).toBe(true)
  })

  it('rejects an explicit provider failure even when the HTTP response is 200', async () => {
    state.rows.set('user_registration_otp', { body: 'Your code is {{otp}}', is_active: true })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ status: 'failed', message: 'Campaign inactive' }), { status: 200 })))
    const result = await sendTemplateWhatsApp('user_registration_otp', '+919876543210', { otp: '123456' })
    expect('reason' in result && result.reason).toContain('Campaign inactive')
  })

  it('supports Combirds URL buttons with dynamic OTP values from environment JSON', async () => {
    state.rows.set('user_registration_otp', { body: 'Your code is {{otp}}', is_active: true })
    state.config.COMBIRDS_WABA_BUTTONS_JSON = '[{"type":"button","sub_type":"url","index":0,"parameters":[{"type":"text","text":"{{otp}}"}]}]'
    await sendTemplateWhatsApp('user_registration_otp', '+919876543210', { otp: '123456' })
    const [, init] = vi.mocked(fetch).mock.calls[0]!
    expect(JSON.parse(String(init?.body)).buttons).toEqual([{ type: 'button', sub_type: 'url', index: 0, parameters: [{ type: 'text', text: '123456' }] }])
  })

  it('does not log the OTP, full phone, or template body when the provider echoes request data', async () => {
    state.rows.set('user_registration_otp', { body: 'Your code is {{otp}}', is_active: true })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      status: 'failed',
      message: 'OTP 123456 for +919876543210 could not be delivered',
    }), { status: 500 })))
    const logs = [
      vi.spyOn(console, 'log').mockImplementation(() => undefined),
      vi.spyOn(console, 'info').mockImplementation(() => undefined),
      vi.spyOn(console, 'error').mockImplementation(() => undefined),
    ]
    try {
      await sendTemplateWhatsApp('user_registration_otp', '+919876543210', { otp: '123456' })
      const output = JSON.stringify(logs.flatMap((log) => log.mock.calls))
      expect(output).not.toContain('123456')
      expect(output).not.toContain('+919876543210')
      expect(output).not.toContain('Your code is')
    } finally {
      for (const log of logs) log.mockRestore()
    }
  })

})
