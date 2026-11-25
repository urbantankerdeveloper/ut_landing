export type TrackingCoordinate = {
  latitude: number | null
  longitude: number | null
  accuracy?: number | null
  recordedAt?: string | null
}

export type ResolvedTrackingLocation = {
  latitude: number
  longitude: number
  accuracy: number | null
  recordedAt: string | null
  source: 'live' | 'registered'
}

const driverLocationStatuses = new Set([
  'vendor_assigned',
  'accepted',
  'en_route',
  'arrived',
])

function isValidCoordinatePair(
  location: TrackingCoordinate | null | undefined,
): location is TrackingCoordinate & { latitude: number; longitude: number } {
  return Boolean(
    location &&
      typeof location.latitude === 'number' &&
      Number.isFinite(location.latitude) &&
      location.latitude >= -90 &&
      location.latitude <= 90 &&
      typeof location.longitude === 'number' &&
      Number.isFinite(location.longitude) &&
      location.longitude >= -180 &&
      location.longitude <= 180,
  )
}

export function resolveTrackingLocation(
  status: string,
  liveLocation: TrackingCoordinate | null | undefined,
  registeredDriverLocation: TrackingCoordinate | null | undefined,
): ResolvedTrackingLocation | null {
  if (isValidCoordinatePair(liveLocation)) {
    return {
      latitude: liveLocation.latitude,
      longitude: liveLocation.longitude,
      accuracy: liveLocation.accuracy ?? null,
      recordedAt: liveLocation.recordedAt ?? null,
      source: 'live',
    }
  }
  if (
    !driverLocationStatuses.has(status) ||
    !isValidCoordinatePair(registeredDriverLocation)
  ) {
    return null
  }
  return {
    latitude: registeredDriverLocation.latitude,
    longitude: registeredDriverLocation.longitude,
    accuracy: null,
    recordedAt: null,
    source: 'registered',
  }
}
