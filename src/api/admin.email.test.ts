import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { adminApi } from './admin'
import { useAuthStore } from '../stores/authStore'

describe('adminApi email templates', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.stubGlobal('window', globalThis)
    vi.stubGlobal('sessionStorage', { getItem: vi.fn(), setItem: vi.fn(), removeItem: vi.fn() })
    useAuthStore.setState({ user: null, accessToken: 'admin-token' })
  })
  afterEach(() => vi.unstubAllGlobals())

  it('loads templates from the email administration route', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ rows: [] }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(adminApi.emailTemplates()).resolves.toEqual([])
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/admin/email-templates')
  })

  it('updates the subject and body using an encoded template key', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ templateKey: 'booking_status_update' }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetchMock)
    await adminApi.updateEmailTemplate('booking status', { subject: 'Status {{reference}}', body: 'Hello {{reference}}' })
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/admin/email-templates/booking%20status')
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      method: 'PATCH',
      body: JSON.stringify({ subject: 'Status {{reference}}', body: 'Hello {{reference}}' }),
    })
  })
})
