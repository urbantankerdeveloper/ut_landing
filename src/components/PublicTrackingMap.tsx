import { CircleMarker, MapContainer, TileLayer } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'

export function LiveTrackingMap({ latitude, longitude }: { latitude: number; longitude: number }) {
  return <div className="booking-location-map tracking-live-map"><MapContainer center={[latitude, longitude]} zoom={15} scrollWheelZoom className="leaflet-map"><TileLayer attribution="&copy; OpenStreetMap contributors" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" /><CircleMarker center={[latitude, longitude]} radius={10} pathOptions={{ color: '#d35400', fillColor: '#f28b30', fillOpacity: 0.9 }} /></MapContainer><div className="tracking-map-legend"><span><i className="fleet-dot" /> Fleet last known location</span></div></div>
}
