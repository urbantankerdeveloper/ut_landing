import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { adminApi } from './admin'
import { useAuthStore } from '../stores/authStore'

describe('adminApi enquiry updates', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.stubGlobal('window', globalThis)
    vi.stubGlobal('sessionStorage', {
      getItem: vi.fn(),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    })
    useAuthStore.setState({ user: null, accessToken: 'admin-token' })
  })

  afterEach(() => vi.unstubAllGlobals())

  it('omits an unspecified response so a status change keeps the saved note', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: 'enquiry-1', status: 'resolved' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await adminApi.updateEnquiry('enquiry-1', 'resolved')

    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      method: 'PATCH',
      body: JSON.stringify({ status: 'resolved' }),
    })
  })

  describe('adminApi service pricing history', () => {
    beforeEach(() => {
      vi.restoreAllMocks()
      vi.stubGlobal('window', globalThis)
      vi.stubGlobal('sessionStorage', {
        getItem: vi.fn(),
        setItem: vi.fn(),
        removeItem: vi.fn(),
      })
      useAuthStore.setState({ user: null, accessToken: 'admin-token' })
    })

    afterEach(() => vi.unstubAllGlobals())

    it('loads the selected service pricing audit trail', async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        new Response(JSON.stringify([{
          id: 'history-1',
          service_id: 'service-1',
          service_code: 'water_tanker',
          changed_by: 'admin-1',
          changed_by_name: 'Service Admin',
          action: 'updated',
          old_base_price_paise: 10000,
          new_base_price_paise: 12000,
          old_config: {},
          new_config: {},
          created_at: '2026-11-18T10:00:00.000Z',
        }]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      vi.stubGlobal('fetch', fetchMock)

      await expect(adminApi.servicePricingHistory('service-1')).resolves.toMatchObject([
        { service_code: 'water_tanker', changed_by_name: 'Service Admin', new_base_price_paise: 12000 },
      ])
      expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/admin/services/service-1/pricing-history')
    })
  })

  it('loads authenticated enquiry history only for the selected enquiry', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify([{
        id: 'history-1',
        action: 'submitted',
        actor_type: 'public',
        old_status: null,
        new_status: 'new',
        response: null,
        created_at: '2026-11-18T03:00:00.000Z',
      }]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await expect(adminApi.enquiryHistory('enquiry-1')).resolves.toMatchObject([
      { id: 'history-1', action: 'submitted', new_status: 'new' },
    ])
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/admin/enquiries/enquiry-1/history')
  })
})
