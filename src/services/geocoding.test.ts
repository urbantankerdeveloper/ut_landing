import { beforeEach, describe, expect, it, vi } from 'vitest'
import { lookupDeliveryPoint } from './geocoding'

vi.mock('../constants/env', () => ({ googleMapsApiKey: 'test-key' }))
vi.mock('../utils/googleMapsApi', () => ({
  loadGoogleMapsApi: vi.fn().mockResolvedValue(undefined),
}))

describe('lookupDeliveryPoint with Google geocoding', () => {
  beforeEach(() => {
    const geocode = vi.fn((_request, callback) => callback([
      {
        formatted_address: '12 Test Street, Chennai, Tamil Nadu, India',
      },
    ], 'OK'))
    vi.stubGlobal('google', {
      maps: {
        Geocoder: class {
          geocode = geocode
        },
        GeocoderStatus: { OK: 'OK' },
      },
    })
  })

  it('returns the full formatted address and recognizes Chennai', async () => {
    const result = await lookupDeliveryPoint(
      { lat: 13.081, lng: 80.271 },
      true,
    )

    expect(result).toEqual({
      address: '12 Test Street, Chennai, Tamil Nadu, India',
      isInChennai: true,
    })
  })
})
