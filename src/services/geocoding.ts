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

export async function lookupDeliveryPoint(point: LatLngLiteral): Promise<DeliveryLocationLookup> {
  const params = new URLSearchParams({ format: 'jsonv2', addressdetails: '1', zoom: '14', lat: String(point.lat), lon: String(point.lng) })
  const response = await fetch(`https://nominatim.openstreetmap.org/reverse?${params.toString()}`, { headers: { Accept: 'application/json' } })
  if (!response.ok) throw new Error(`Location name lookup failed: ${response.status}`)
  const result = await response.json() as NominatimResponse
  return { approximateName: approximateName(result, point), isInChennai: isInChennai(result.address) }
}

export async function reverseGeocodeApproximate(point: LatLngLiteral) {
  return (await lookupDeliveryPoint(point)).approximateName
}
