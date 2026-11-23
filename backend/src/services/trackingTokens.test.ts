import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  secret: 'tracking-token-test-secret-that-is-long-enough',
  updates: [] as Array<{ payload: Record<string, unknown>; bookingId: string }>,
}))

vi.mock('../config.js', () => ({
  config: { OTP_HMAC_SECRET: state.secret },
}))
vi.mock('../supabase.js', () => ({
  supabase: {
    from: () => ({
      update: (payload: Record<string, unknown>) => ({
        eq: async (_field: string, bookingId: string) => {
          state.updates.push({ payload, bookingId })
          return { error: null }
        },
      }),
    }),
  },
}))

import { getOrCreateTrackingToken } from './trackingTokens.js'

describe('getOrCreateTrackingToken', () => {
  beforeEach(() => {
    state.updates.length = 0
  })

  it('returns the same opaque URL token for a booking on repeated calls', async () => {
    const first = await getOrCreateTrackingToken('booking-1')
    const second = await getOrCreateTrackingToken('booking-1')

    expect(first.token).toBe(second.token)
    expect(first.token).toMatch(/^[A-Za-z0-9_-]{40,60}$/)
    expect(state.updates[0]?.payload.tracking_token_v2_hash).toBe(state.updates[1]?.payload.tracking_token_v2_hash)
    expect(state.updates[0]?.payload).not.toHaveProperty('tracking_token')
  })

  it('derives different tokens for different bookings', async () => {
    const first = await getOrCreateTrackingToken('booking-1')
    const second = await getOrCreateTrackingToken('booking-2')

    expect(first.token).not.toBe(second.token)
  })
})
