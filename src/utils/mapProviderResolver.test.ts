import { describe, expect, it, vi } from 'vitest'
import { MapProviderResolver } from './mapProviderResolver'

describe('MapProviderResolver', () => {
  it('uses OpenStreetMap when no Google Maps key is configured', () => {
    expect(new MapProviderResolver(' ').useGoogleMaps).toBe(false)
  })

  it('keeps Google Maps enabled for a configured key until it is unavailable', () => {
    const resolver = new MapProviderResolver('test-key')
    const listener = vi.fn()
    resolver.subscribe(listener)
    expect(resolver.useGoogleMaps).toBe(true)

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    resolver.markUnavailable(new Error('API error'))
    resolver.markUnavailable()

    expect(resolver.useGoogleMaps).toBe(false)
    expect(resolver.getSnapshot()).toBe(false)
    expect(listener).toHaveBeenCalledTimes(1)
    warn.mockRestore()
  })
})
