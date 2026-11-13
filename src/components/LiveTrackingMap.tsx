import { useEffect, useMemo, useRef, useState } from 'react'
import { LiveFleetMap } from './LiveFleetMap'
import { subscribeToRealtime } from '../services/realtime'
import type { TrackingSnapshot } from '../api/customer'
import type { MapPoint } from '../utils/mapCoordinates'
import { locationContent } from '../content/location'

type Props = { bookingId: string; snapshot: TrackingSnapshot }

export function LiveTrackingMap({ bookingId, snapshot }: Props) {
  const snapshotUpdatedAt = snapshot.recorded_at ?? snapshot.recordedAt ?? null
  const snapshotKey = `${snapshotUpdatedAt ?? ''}:${snapshot.latitude ?? ''}:${snapshot.longitude ?? ''}`
  const snapshotKeyRef = useRef(snapshotKey)
  const [socketFix, setSocketFix] = useState<{ point: MapPoint; snapshotKey: string; timestamp: string } | null>(null)
  const [socketTrail, setSocketTrail] = useState<MapPoint[]>([])
  const snapshotPointValue = snapshotPoint(snapshot.latitude, snapshot.longitude)
  const currentSocketFix = socketFix?.snapshotKey === snapshotKey ? socketFix : null
  const fleetPoint = currentSocketFix?.point ?? snapshotPointValue
  const lastUpdated = currentSocketFix?.timestamp ?? snapshotUpdatedAt
  const trail = useMemo(() => fleetPoint ? appendPoint(socketTrail, fleetPoint) : socketTrail, [socketTrail, fleetPoint])
  const customerPoint = snapshotPoint(snapshot.customerLatitude, snapshot.customerLongitude)

  useEffect(() => { snapshotKeyRef.current = snapshotKey }, [snapshotKey])

  useEffect(() => {
    const realtimeUrl = import.meta.env.VITE_REALTIME_URL ?? (import.meta.env.PROD ? window.location.origin : 'http://localhost:8080')
    return subscribeToRealtime(realtimeUrl, (message) => {
      if (message.type !== 'booking.location.updated' || !message.payload || typeof message.payload !== 'object') return
      const payload = message.payload as { bookingId?: string; latitude?: number; longitude?: number; recordedAt?: string; recorded_at?: string }
      if (payload.bookingId !== bookingId) return
      const point = snapshotPoint(payload.latitude, payload.longitude)
      if (!point) return
      setSocketTrail((current) => appendPoint(current, point))
      const eventTimestamp = payload.recordedAt ?? payload.recorded_at
      const timestamp = typeof eventTimestamp === 'string' && Number.isFinite(Date.parse(eventTimestamp)) ? eventTimestamp : new Date().toISOString()
      setSocketFix({ point, snapshotKey: snapshotKeyRef.current, timestamp })
    }, bookingId)
  }, [bookingId])

  if (!fleetPoint && !customerPoint) return <div className="tracking-map-empty">{locationContent.map.waiting}</div>
  return <div className="booking-location-map tracking-live-map tracking-live-map--compact">
    <LiveFleetMap vehicle={fleetPoint} destination={customerPoint} trail={trail} lastUpdated={lastUpdated} />
    <div className="tracking-map-legend"><span><i className="fleet-dot" /> {locationContent.map.fleet}</span>{customerPoint && <span><i className="customer-dot" /> {locationContent.map.deliveryPoint}</span>}</div>
  </div>
}

function snapshotPoint(latitude: number | undefined, longitude: number | undefined): MapPoint | null {
  return typeof latitude === 'number' && Number.isFinite(latitude) && typeof longitude === 'number' && Number.isFinite(longitude)
    ? { lat: latitude, lng: longitude }
    : null
}

function appendPoint(current: MapPoint[], point: MapPoint) {
  const previous = current[current.length - 1]
  return previous?.lat === point.lat && previous.lng === point.lng ? current : [...current.slice(-19), point]
}
