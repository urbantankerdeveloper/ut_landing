import { useState } from 'react'
import type { LatLngLiteral } from 'leaflet'
import { MapPin } from 'lucide-react'
import { LocationPicker } from './LocationPicker'
import { Modal } from '../screens/WorkspaceInteractive'
import { reverseGeocodeApproximate } from '../services/geocoding'

type Props = { value: LatLngLiteral | null; onChange: (value: LatLngLiteral, approximateName: string) => void; onClose: () => void }

export function LocationPickerModal({ value, onChange, onClose }: Props) {
  const [selectedName, setSelectedName] = useState<string | null>(null)
  const [isResolving, setIsResolving] = useState(false)
  const [lookupError, setLookupError] = useState<string | null>(null)
  async function selectLocation(point: LatLngLiteral) {
    setIsResolving(true)
    setLookupError(null)
    try {
      const name = await reverseGeocodeApproximate(point)
      setSelectedName(name)
      onChange(point, name)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Location name lookup failed'
      setLookupError('The area name could not be loaded. You can still use this map point.')
      setSelectedName(`Selected delivery area (${point.lat.toFixed(5)}, ${point.lng.toFixed(5)})`)
      onChange(point, `Selected delivery area (${point.lat.toFixed(5)}, ${point.lng.toFixed(5)})`)
      console.warn(JSON.stringify({ event: 'location.reverse_geocode_failed', error: message }))
    } finally {
      setIsResolving(false)
    }
  }
  return <Modal title="Select delivery location" onClose={onClose}><div className="location-picker-modal"><p className="modal-required-note"><MapPin size={15} /> Click on the map to choose the delivery point, or use your browser location.</p><LocationPicker value={value} onChange={(point) => void selectLocation(point)} />{selectedName && <p className="location-selected-name" role="status"><MapPin size={15} /> {isResolving ? 'Finding nearby area…' : selectedName}</p>}{lookupError && <p className="location-lookup-error" role="alert">{lookupError}</p>}<button className="button button-primary button-large" type="button" disabled={!value || isResolving} onClick={onClose}>{isResolving ? 'Finding area…' : 'Use this location'}</button></div></Modal>
}
