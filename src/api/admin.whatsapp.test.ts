import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { adminApi } from './admin'
import { useAuthStore } from '../stores/authStore'

describe('adminApi WhatsApp templates', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.stubGlobal('window', globalThis)
    vi.stubGlobal('sessionStorage', { getItem: vi.fn(), setItem: vi.fn(), removeItem: vi.fn() })
    useAuthStore.setState({ user: null, accessToken: 'admin-token' })
  })
  afterEach(() => vi.unstubAllGlobals())

  it('loads templates from the WhatsApp administration route', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ rows: [] }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(adminApi.whatsappTemplates()).resolves.toEqual([])
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/admin/whatsapp-templates')
  })

  it('creates a WhatsApp template without SMS-provider fields', async () => {
    const response = { templateKey: 'booking_notice', body: 'Hello {{reference}}', variables: ['reference'], isActive: true, updatedAt: '2026-11-18T00:00:00.000Z', campaignName: 'URBAN TANKER', isBuiltIn: false, allowedVariables: null, requiredVariables: [], canDeactivate: true, provider: 'combirds-whatsapp', bodyUsedByProvider: false, providerNote: 'Managed in Combirds' }
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(response), {
      status: 201, headers: { 'Content-Type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetchMock)
    await adminApi.createWhatsAppTemplate({ templateKey: 'booking_notice', body: 'Hello {{reference}}', isActive: true })
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/admin/whatsapp-templates')
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      method: 'POST',
      body: JSON.stringify({ templateKey: 'booking_notice', body: 'Hello {{reference}}', isActive: true }),
    })
  })

  it('updates a WhatsApp template using its encoded key', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ templateKey: 'booking_notice' }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetchMock)
    await adminApi.updateWhatsAppTemplate('booking notice', { body: 'Updated {{reference}}', isActive: true })
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/admin/whatsapp-templates/booking%20notice')
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      method: 'PATCH',
      body: JSON.stringify({ body: 'Updated {{reference}}', isActive: true }),
    })
  })
})
