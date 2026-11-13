import { LiveFleetMap } from './LiveFleetMap'
import type { MapPoint } from '../utils/mapCoordinates'
import { trackingContent as c } from '../content/tracking'

export function LiveTrackingMap({ latitude, longitude, lastUpdated }: { latitude: number; longitude: number; lastUpdated?: string | null }) {
  const vehicle: MapPoint = { lat: latitude, lng: longitude }

  return <div className="booking-location-map tracking-live-map">
    <LiveFleetMap vehicle={vehicle} lastUpdated={lastUpdated} />
    <div className="tracking-map-legend"><span><i className="fleet-dot" /> {c.map.legend}</span></div>
  </div>
}
