import { beforeEach, describe, expect, it, vi } from 'vitest'
import { isChennaiDeliveryPoint, lookupDeliveryPoint } from './geocoding'

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

  describe('isChennaiDeliveryPoint', () => {
    it('accepts the reported central Chennai map point', () => {
      expect(isChennaiDeliveryPoint({ lat: 13.07727, lng: 80.28371 })).toBe(true)
    })

    it('rejects points outside the Chennai service bounds', () => {
      expect(isChennaiDeliveryPoint({ lat: 13.36, lng: 80.28371 })).toBe(false)
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
