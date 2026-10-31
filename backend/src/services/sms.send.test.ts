import { beforeEach, describe, expect, it, vi } from 'vitest'

const rows = new Map<string, { body: string; is_active: boolean; msg91_template_id: string | null }>()

vi.mock('../config.js', () => ({
  config: {
    SMS_PROVIDER: 'msg91',
    MSG91_AUTH_KEY: 'test-key',
    MSG91_TEMPLATE_ID_VENDOR_ACCEPTANCE: 'cfg-vendor-tpl',
  },
}))

vi.mock('../supabase.js', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: (_column: string, key: string) => ({
          maybeSingle: async () => ({ data: rows.get(key) ?? null, error: null }),
        }),
      }),
    }),
  },
}))

vi.mock('./providers.js', () => ({ sendSms: vi.fn() }))

import { invalidateSmsTemplateCache, sendTemplateSms } from './sms.js'

describe('sendTemplateSms', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    rows.clear()
    invalidateSmsTemplateCache()
    fetchMock = vi.fn(async () => new Response(JSON.stringify({ type: 'success', message: 'req-1' }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
  })

  it('sends a custom template using its stored MSG91 template ID', async () => {
    rows.set('order_cancelled', { body: 'Booking {{reference}} cancelled.', is_active: true, msg91_template_id: 'custTpl123' })

    const result = await sendTemplateSms('order_cancelled', '+919876543210', { reference: 'UT-1' })

    expect(result).toMatchObject({ queued: true, provider: 'msg91' })
    const sent = JSON.parse(fetchMock.mock.calls[0]![1].body)
    expect(sent.template_id).toBe('custTpl123')
    expect(sent.recipients[0]).toMatchObject({ mobiles: '919876543210', reference: 'UT-1' })
  })

  it('falls back to env config for a built-in key with no stored ID', async () => {
    rows.set('vendor_acceptance', { body: 'Track: {{trackingUrl}}', is_active: true, msg91_template_id: null })

    await sendTemplateSms('vendor_acceptance', '+919876543210', { trackingUrl: 'https://x/track/t' })

    expect(JSON.parse(fetchMock.mock.calls[0]![1].body).template_id).toBe('cfg-vendor-tpl')
  })

  it('does not send when a placeholder has no value', async () => {
    rows.set('order_cancelled', { body: 'Booking {{reference}} cancelled.', is_active: true, msg91_template_id: 'custTpl123' })

    const result = await sendTemplateSms('order_cancelled', '+919876543210', {})

    expect(result.queued).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('does not send an inactive or missing template', async () => {
    rows.set('paused_promo', { body: 'Hi', is_active: false, msg91_template_id: 'custTpl123' })

    expect((await sendTemplateSms('paused_promo', '+919876543210', {})).queued).toBe(false)
    expect((await sendTemplateSms('no_such_key', '+919876543210', {})).queued).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
