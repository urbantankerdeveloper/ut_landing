import type { LatLngLiteral } from 'leaflet'

type NominatimResponse = { display_name?: string; address?: Record<string, string> }

export type DeliveryLocationLookup = { approximateName: string; isInChennai: boolean }

function approximateName(result: NominatimResponse, point: LatLngLiteral) {
  const address = result.address ?? {}
  const locality = address.suburb ?? address.neighbourhood ?? address.city_district ?? address.town ?? address.city ?? address.village
  const region = address.state_district ?? address.state
  if (locality && region) return `${locality}, ${region}`
  if (locality) return locality
  if (result.display_name) return result.display_name.split(',').slice(0, 2).join(',').trim()
  return `Selected delivery area (${point.lat.toFixed(5)}, ${point.lng.toFixed(5)})`
}

function isInChennai(address?: Record<string, string>) {
  const localityFields = ['city', 'municipality', 'county', 'state_district', 'city_district']
  return localityFields.some((field) => /\bchennai\b/i.test(address?.[field] ?? ''))
}

export function isChennaiDeliveryAddress(value: string) {
  return value.split(',').some((part) => /^\s*(?:greater\s+)?chennai(?:\s+(?:city|district|metropolitan(?:\s+area)?))?(?:\s+\d{6})?\s*$/i.test(part))
}

const LOOKUP_DEBOUNCE_MS = 500
const LOOKUP_CACHE_LIMIT = 50
const lookupCache = new Map<string, DeliveryLocationLookup>()
let pendingLookup: { timer: number; reject: (reason: Error) => void } | null = null

async function fetchDeliveryLookup(point: LatLngLiteral): Promise<DeliveryLocationLookup> {
  const params = new URLSearchParams({ format: 'jsonv2', addressdetails: '1', zoom: '14', lat: String(point.lat), lon: String(point.lng) })
  const response = await fetch(`https://nominatim.openstreetmap.org/reverse?${params.toString()}`, { headers: { Accept: 'application/json' } })
  if (!response.ok) throw new Error(`Location name lookup failed: ${response.status}`)
  const result = await response.json() as NominatimResponse
  return { approximateName: approximateName(result, point), isInChennai: isInChennai(result.address) }
}

export function lookupDeliveryPoint(point: LatLngLiteral): Promise<DeliveryLocationLookup> {
  const key = `${point.lat.toFixed(5)},${point.lng.toFixed(5)}`
  const cached = lookupCache.get(key)
  if (cached) return Promise.resolve(cached)
  if (pendingLookup) {
    window.clearTimeout(pendingLookup.timer)
    pendingLookup.reject(new DOMException('Superseded by a newer lookup', 'AbortError'))
  }
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      pendingLookup = null
      fetchDeliveryLookup(point).then((result) => {
        if (lookupCache.size >= LOOKUP_CACHE_LIMIT) lookupCache.delete(lookupCache.keys().next().value as string)
        lookupCache.set(key, result)
        resolve(result)
      }, reject)
    }, LOOKUP_DEBOUNCE_MS)
    pendingLookup = { timer, reject }
  })
}

export async function reverseGeocodeApproximate(point: LatLngLiteral) {
  return (await lookupDeliveryPoint(point)).approximateName
}
