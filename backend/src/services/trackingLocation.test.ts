import { describe, expect, it } from 'vitest'
import { resolveTrackingLocation } from './trackingLocation.js'

describe('resolveTrackingLocation', () => {
  const registeredLocation = { latitude: 13.0827, longitude: 80.2707 }

  it('uses a live location before the registered driver fallback', () => {
    expect(
      resolveTrackingLocation(
        'en_route',
        {
          latitude: 13.09,
          longitude: 80.28,
          accuracy: 18,
          recordedAt: '2026-11-25T01:00:00.000Z',
        },
        registeredLocation,
      ),
    ).toEqual({
      latitude: 13.09,
      longitude: 80.28,
      accuracy: 18,
      recordedAt: '2026-11-25T01:00:00.000Z',
      source: 'live',
    })
  })

  it('falls back to the saved driver pin only while the booking is active', () => {
    expect(
      resolveTrackingLocation('en_route', null, registeredLocation),
    ).toEqual({
      ...registeredLocation,
      accuracy: null,
      recordedAt: null,
      source: 'registered',
    })
    expect(
      resolveTrackingLocation('delivered', null, registeredLocation),
    ).toBeNull()
  })

  it('rejects invalid coordinates and waits for a location before assignment', () => {
    expect(
      resolveTrackingLocation('accepted', null, {
        latitude: 91,
        longitude: 80.2707,
      }),
    ).toBeNull()
    expect(
      resolveTrackingLocation('pending_vendor', null, registeredLocation),
    ).toBeNull()
  })
})
