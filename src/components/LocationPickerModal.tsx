import { useState } from 'react'
import type { LatLngLiteral } from 'leaflet'
import { MapPin } from 'lucide-react'
import { LocationPicker } from './LocationPicker'
import { Modal } from '../screens/WorkspaceInteractive'
import { lookupDeliveryPoint } from '../services/geocoding'
import { locationContent } from '../content/location'

type Props = { value: LatLngLiteral | null; onChange: (value: LatLngLiteral, approximateName: string) => void; onClose: () => void }

export function LocationPickerModal({ value, onChange, onClose }: Props) {
  const [candidatePoint, setCandidatePoint] = useState<LatLngLiteral | null>(value)
  const [selectedName, setSelectedName] = useState<string | null>(null)
  const [candidateIsInChennai, setCandidateIsInChennai] = useState<boolean | null>(null)
  const [isResolving, setIsResolving] = useState(false)
  const [lookupError, setLookupError] = useState<string | null>(null)
  async function selectLocation(point: LatLngLiteral) {
    setIsResolving(true)
    setLookupError(null)
    setCandidatePoint(point)
    setCandidateIsInChennai(null)
    try {
      const result = await lookupDeliveryPoint(point)
      setSelectedName(result.approximateName)
      setCandidateIsInChennai(result.isInChennai)
      if (result.isInChennai) onChange(point, result.approximateName)
      else setLookupError(locationContent.modal.outsideChennai)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Location name lookup failed'
      setLookupError(locationContent.modal.lookupFailed)
      setCandidateIsInChennai(false)
      setSelectedName(locationContent.modal.selectedArea(point.lat.toFixed(5), point.lng.toFixed(5)))
      console.warn(JSON.stringify({ event: 'location.reverse_geocode_failed', error: message }))
    } finally {
      setIsResolving(false)
    }
  }
  return <Modal title={locationContent.modal.title} onClose={onClose}><div className="location-picker-modal"><p className="modal-required-note"><MapPin size={15} /> {locationContent.modal.hint}</p><LocationPicker value={candidatePoint} onChange={(point) => void selectLocation(point)} />{selectedName && <p className="location-selected-name" role="status"><MapPin size={15} /> {isResolving ? locationContent.modal.finding : selectedName}</p>}{lookupError && <p className="location-lookup-error" role="alert">{lookupError}</p>}<button className="button button-primary button-large" type="button" disabled={!candidatePoint || isResolving || candidateIsInChennai !== true} onClick={onClose}>{isResolving ? locationContent.modal.findingButton : locationContent.modal.useLocation}</button></div></Modal>
}
