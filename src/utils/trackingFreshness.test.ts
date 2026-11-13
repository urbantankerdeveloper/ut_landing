import { describe, expect, it } from 'vitest'
import { formatTrackingUpdatedAgo } from './trackingFreshness'

describe('tracking freshness labels', () => {
  const now = Date.parse('2026-03-01T12:00:00Z')

  it('shows just now for updates under five seconds old', () => {
    expect(formatTrackingUpdatedAgo(new Date(now - 4_999), now)).toBe('Updated just now')
  })

  it('shows elapsed seconds and minutes at their boundaries', () => {
    expect(formatTrackingUpdatedAgo(new Date(now - 5_000), now)).toBe('Updated 5s ago')
    expect(formatTrackingUpdatedAgo(new Date(now - 60_000), now)).toBe('Updated 1m ago')
  })

  it('omits a label for invalid timestamps', () => {
    expect(formatTrackingUpdatedAgo('not-a-date', now)).toBeNull()
  })
})
