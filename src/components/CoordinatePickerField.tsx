import { useEffect, useRef, useState } from 'react'
import type { LatLngLiteral } from 'leaflet'
import { MapPin, MapPinned, Navigation } from 'lucide-react'
import { LocationPicker } from './LocationPicker'
import { Modal } from './Modal'

type Props = {
  initialLatitude?: number | null
  initialLongitude?: number | null
  onNotice: (message: string) => void
}

export function CoordinatePickerField({ initialLatitude, initialLongitude, onNotice }: Props) {
  const fieldsetRef = useRef<HTMLFieldSetElement>(null)
  const mountedRef = useRef(false)
  const [location, setLocation] = useState<LatLngLiteral | null>(() =>
    typeof initialLatitude === 'number' && typeof initialLongitude === 'number'
      ? { lat: initialLatitude, lng: initialLongitude }
      : null,
  )
  const [mapOpen, setMapOpen] = useState(false)
  const [mapLocation, setMapLocation] = useState<LatLngLiteral | null>(location)
  const [locating, setLocating] = useState(false)

  useEffect(() => {
    mountedRef.current = true
    const form = fieldsetRef.current?.closest('form')
    const reset = () => {
      const initialLocation =
        typeof initialLatitude === 'number' && typeof initialLongitude === 'number'
          ? { lat: initialLatitude, lng: initialLongitude }
          : null
      setLocation(initialLocation)
      setMapLocation(initialLocation)
      setMapOpen(false)
    }
    form?.addEventListener('reset', reset)
    return () => {
      mountedRef.current = false
      form?.removeEventListener('reset', reset)
    }
  }, [initialLatitude, initialLongitude])

  function requestCurrentLocation(select: (point: LatLngLiteral) => void) {
    if (!navigator.geolocation) {
      onNotice('Location is not supported by this browser.')
      return
    }
    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        if (!mountedRef.current) return
        const point = { lat: coords.latitude, lng: coords.longitude }
        select(point)
        setMapLocation(point)
        setLocating(false)
      },
      (error) => {
        const message = error.code === error.PERMISSION_DENIED
          ? 'Allow location access in your browser to use your current location.'
          : error.code === error.TIMEOUT
            ? 'Could not get your location in time. Try again.'
            : 'Could not get your current location.'
        if (mountedRef.current) {
          onNotice(message)
          setLocating(false)
        }
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 15_000 },
    )
  }

  function openMap() {
    setMapLocation(location)
    setMapOpen(true)
  }

  function confirmMapLocation() {
    if (!mapLocation) return
    setLocation(mapLocation)
    setMapOpen(false)
  }

  return (
    <>
      <fieldset className="coordinate-picker-field" ref={fieldsetRef}>
        <legend>Registered location (optional)</legend>
        <div className="coordinate-picker-actions">
          <button className="button button-quiet" type="button" onClick={openMap}>
            <MapPinned size={15} /> Choose from map
          </button>
          <button
            className="button button-quiet"
            type="button"
            disabled={locating}
            onClick={() => requestCurrentLocation(setLocation)}
          >
            <Navigation size={15} /> {locating ? 'Getting location…' : 'Use current location'}
          </button>
        </div>
        {location
          ? <p className="coordinate-picker-value" aria-live="polite"><MapPin size={14} /> {location.lat.toFixed(6)}, {location.lng.toFixed(6)}</p>
          : <p className="coordinate-picker-empty">No location selected</p>}
        <input type="hidden" name="latitude" value={location?.lat ?? ''} />
        <input type="hidden" name="longitude" value={location?.lng ?? ''} />
      </fieldset>
      {mapOpen && (
        <Modal title="Choose registered location" onClose={() => setMapOpen(false)}>
          <div className="coordinate-picker-map">
            <p>Click the map to place the location pin.</p>
            <LocationPicker value={mapLocation} onChange={setMapLocation} />
            <div className="coordinate-picker-actions">
              <button
                className="button button-quiet"
                type="button"
                disabled={locating}
                onClick={() => requestCurrentLocation(setMapLocation)}
              >
                <Navigation size={15} /> {locating ? 'Getting location…' : 'Use current location'}
              </button>
              <button className="button button-primary" type="button" disabled={!mapLocation} onClick={confirmMapLocation}>
                Use selected location
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  )
}
