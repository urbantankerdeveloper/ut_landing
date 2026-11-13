import { describe, expect, it } from 'vitest'
import { authenticatedTrackingRefetchInterval, PUBLIC_TRACKING_POLL_INTERVAL_MS } from './trackingCadence'

describe('tracking update cadence', () => {
  it('polls the public tracking page every 30 seconds', () => {
    expect(PUBLIC_TRACKING_POLL_INTERVAL_MS).toBe(30_000)
  })

  it('disables polling while realtime is connected and uses 30 seconds otherwise', () => {
    expect(authenticatedTrackingRefetchInterval(true)).toBe(false)
    expect(authenticatedTrackingRefetchInterval(false)).toBe(30_000)
  })
})
