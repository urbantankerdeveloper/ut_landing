import { googleMapsApiKey } from '../constants/env'

export class MapProviderResolver {
  readonly apiKey: string
  private unavailable = false
  private readonly listeners = new Set<() => void>()

  constructor(apiKey: string) {
    this.apiKey = apiKey.trim()
  }

  get useGoogleMaps() {
    return this.apiKey.length > 0 && !this.unavailable
  }

  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  readonly getSnapshot = () => this.useGoogleMaps

  markUnavailable(reason?: unknown) {
    if (this.unavailable) return
    this.unavailable = true
    if (reason) console.warn('Google Maps unavailable; falling back to OpenStreetMap.', reason instanceof Error ? reason.message : reason)
    this.listeners.forEach((listener) => listener())
  }
}

export const mapProviderResolver = new MapProviderResolver(googleMapsApiKey)
