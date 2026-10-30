import { useEffect, useState } from 'react'
import { CircleMarker, MapContainer, Polyline, TileLayer, useMap } from 'react-leaflet'
import type { LatLngExpression, LatLngLiteral } from 'leaflet'
import { subscribeToRealtime } from '../services/realtime'
import type { TrackingSnapshot } from '../api/customer'
import 'leaflet/dist/leaflet.css'

type Props = { bookingId: string; snapshot: TrackingSnapshot }
type LocationPoint = { latitude: number; longitude: number }

function Recenter({ point }: { point: LatLngLiteral }) {
  const map = useMap()
  useEffect(() => { map.flyTo(point, Math.max(map.getZoom(), 15), { duration: 0.7 }) }, [map, point])
  return null
}

export function LiveTrackingMap({ bookingId, snapshot }: Props) {
  const initial = snapshot.latitude !== undefined && snapshot.longitude !== undefined ? { latitude: snapshot.latitude, longitude: snapshot.longitude } : null
  const [fleetPoint, setFleetPoint] = useState<LocationPoint | null>(initial)
  const [trail, setTrail] = useState<LocationPoint[]>(initial ? [initial] : [])
  const customerPoint = snapshot.customerLatitude !== undefined && snapshot.customerLongitude !== undefined ? { latitude: snapshot.customerLatitude, longitude: snapshot.customerLongitude } : null
  useEffect(() => {
    const realtimeUrl = import.meta.env.VITE_REALTIME_URL ?? (import.meta.env.PROD ? window.location.origin : 'http://localhost:8080')
    return subscribeToRealtime(realtimeUrl, (message) => {
      if (message.type !== 'booking.location.updated' || !message.payload || typeof message.payload !== 'object') return
      const payload = message.payload as { bookingId?: string; latitude?: number; longitude?: number }
      if (payload.bookingId !== bookingId || typeof payload.latitude !== 'number' || typeof payload.longitude !== 'number') return
      const point = { latitude: payload.latitude, longitude: payload.longitude }
      setFleetPoint(point)
      setTrail((current) => [...current.slice(-19), point])
    }, bookingId)
  }, [bookingId])
  if (!fleetPoint) return <div className="tracking-map-empty">Waiting for the fleet to start sharing its live location.</div>
  const fleet = { lat: fleetPoint.latitude, lng: fleetPoint.longitude }
  const customer = customerPoint ? { lat: customerPoint.latitude, lng: customerPoint.longitude } : null
  const line: LatLngExpression[] = trail.map((point) => [point.latitude, point.longitude])
  return <div className="booking-location-map tracking-live-map"><MapContainer center={fleet} zoom={15} scrollWheelZoom className="leaflet-map"><TileLayer attribution='&copy; OpenStreetMap contributors' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" /><Recenter point={fleet} /><CircleMarker center={fleet} radius={10} pathOptions={{ color: '#d35400', fillColor: '#f28b30', fillOpacity: 0.9 }} /><Polyline positions={line} pathOptions={{ color: '#f28b30', weight: 4, opacity: 0.7 }} />{customer && <CircleMarker center={customer} radius={8} pathOptions={{ color: '#0d7770', fillColor: '#13a69a', fillOpacity: 0.85 }} />}</MapContainer><div className="tracking-map-legend"><span><i className="fleet-dot" /> Fleet</span>{customer && <span><i className="customer-dot" /> Delivery point</span>}</div></div>
}
