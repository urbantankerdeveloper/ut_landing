import type { LatLngLiteral } from 'leaflet'
import { googleMapsApiKey } from '../constants/env'
import { loadGoogleMapsApi } from '../utils/googleMapsApi'

type NominatimResponse = { display_name?: string; address?: Record<string, string> }

export type DeliveryLocationLookup = { address: string; isInChennai: boolean }

export function isChennaiDeliveryPoint(point: LatLngLiteral) {
  return point.lat >= 12.75 &&
    point.lat <= 13.35 &&
    point.lng >= 79.85 &&
    point.lng <= 80.45
}

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

function cacheLookup(key: string, result: DeliveryLocationLookup) {
  if (lookupCache.size >= LOOKUP_CACHE_LIMIT) lookupCache.delete(lookupCache.keys().next().value as string)
  lookupCache.set(key, result)
  return result
}

async function fetchNominatimLookup(point: LatLngLiteral): Promise<DeliveryLocationLookup> {
  const params = new URLSearchParams({ format: 'jsonv2', addressdetails: '1', zoom: '14', lat: String(point.lat), lon: String(point.lng) })
  const response = await fetch(`https://nominatim.openstreetmap.org/reverse?${params.toString()}`, { headers: { Accept: 'application/json' } })
  if (!response.ok) throw new Error(`Location name lookup failed: ${response.status}`)
  const result = await response.json() as NominatimResponse
  return { address: approximateName(result, point), isInChennai: isInChennai(result.address) }
}

function reportGoogleMapsAuthFailure(reason: unknown) {
  console.warn(JSON.stringify({
    event: 'location.google_maps_auth_failed',
    error: reason instanceof Error ? reason.message : 'Unknown error',
  }))
}

async function fetchGoogleLookup(point: LatLngLiteral): Promise<DeliveryLocationLookup> {
  if (!googleMapsApiKey.trim()) throw new Error('Google Maps is not configured for address lookup.')
  await loadGoogleMapsApi(googleMapsApiKey, reportGoogleMapsAuthFailure)
  const results = await new Promise<google.maps.GeocoderResult[]>((resolve, reject) => {
    new google.maps.Geocoder().geocode({ location: point }, (response, status) => {
      if (status !== google.maps.GeocoderStatus.OK) {
        reject(new Error(`Google address lookup failed: ${status}`))
        return
      }
      resolve(response ?? [])
    })
  })
  const result = results[0]
  if (!result?.formatted_address) throw new Error('No address was found for this location.')
  return {
    address: result.formatted_address,
    isInChennai: isChennaiDeliveryAddress(result.formatted_address),
  }
}

export function lookupDeliveryPoint(point: LatLngLiteral, useGoogle = false): Promise<DeliveryLocationLookup> {
  const key = `${useGoogle ? 'google' : 'nominatim'}:${point.lat.toFixed(5)},${point.lng.toFixed(5)}`
  const cached = lookupCache.get(key)
  if (cached) return Promise.resolve(cached)

  if (useGoogle) {
    return fetchGoogleLookup(point).then((result) => cacheLookup(key, result))
  }

  if (pendingLookup) {
    window.clearTimeout(pendingLookup.timer)
    pendingLookup.reject(new DOMException('Superseded by a newer lookup', 'AbortError'))
  }
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      pendingLookup = null
      fetchNominatimLookup(point).then((result) => resolve(cacheLookup(key, result)), reject)
    }, LOOKUP_DEBOUNCE_MS)
    pendingLookup = { timer, reject }
  })
}

export async function reverseGeocodeDeliveryAddress(point: LatLngLiteral, useGoogle = false) {
  return (await lookupDeliveryPoint(point, useGoogle)).address
}
