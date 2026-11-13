import type { LatLngLiteral } from 'leaflet'
import { LiveFleetMap } from './LiveFleetMap'

type Props = { value: LatLngLiteral | null; onChange: (value: LatLngLiteral) => void }

export function LocationPicker({ value, onChange }: Props) {
  return <LiveFleetMap className="booking-location-map" vehicle={null} destination={value} onMapClick={onChange} />
}
