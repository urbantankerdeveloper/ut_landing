import { beforeEach, describe, expect, it, vi } from 'vitest'
import { trackEvent } from './analytics'

describe('trackEvent', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 204 })))
    vi.stubGlobal('sessionStorage', {
      getItem: vi.fn(),
      setItem: vi.fn(),
    })
    vi.stubGlobal('window', {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
      setTimeout,
      clearTimeout,
    })
    vi.stubGlobal('CustomEvent', class CustomEvent {
      type: string
      detail: unknown
      constructor(type: string, init: { detail: unknown }) {
        this.type = type
        this.detail = init.detail
      }
    })
  })

  it('dispatches a browser event and sends a bounded payload', async () => {
    trackEvent('booking.created', { service: 'water_tanker', capacity: 5000, omitted: undefined })
    await Promise.resolve()
    expect(window.dispatchEvent).toHaveBeenCalledOnce()
    expect(fetch).toHaveBeenCalledWith('/api/analytics/events', expect.objectContaining({
      method: 'POST',
      body: expect.stringContaining('"eventName":"booking.created"'),
    }))
  })
})
