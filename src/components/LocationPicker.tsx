import { useEffect } from 'react'
import { CircleMarker, MapContainer, TileLayer, useMapEvents } from 'react-leaflet'
import type { LatLngLiteral } from 'leaflet'
import 'leaflet/dist/leaflet.css'

type Props = { value: LatLngLiteral | null; onChange: (value: LatLngLiteral) => void }
const defaultCenter: LatLngLiteral = { lat: 13.0827, lng: 80.2707 }

function ClickHandler({ onChange }: Pick<Props, 'onChange'>) {
  useMapEvents({ click: (event) => onChange({ lat: event.latlng.lat, lng: event.latlng.lng }) })
  return null
}

function CenterOnValue({ value }: { value: LatLngLiteral | null }) {
  const map = useMapEvents({})
  useEffect(() => { if (value) map.flyTo(value, 16, { duration: 0.5 }) }, [map, value])
  return null
}

export function LocationPicker({ value, onChange }: Props) {
  return <div className="booking-location-map"><MapContainer center={value ?? defaultCenter} zoom={value ? 16 : 11} scrollWheelZoom className="leaflet-map"><TileLayer attribution='&copy; OpenStreetMap contributors' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" /><CenterOnValue value={value} /><ClickHandler onChange={onChange} />{value && <CircleMarker center={value} radius={9} pathOptions={{ color: '#0d7770', fillColor: '#13a69a', fillOpacity: 0.85 }} />}</MapContainer></div>
}
