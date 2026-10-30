import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Crosshair, MapPin, Save } from 'lucide-react'
import { vendorApi, type VendorProfileLocation } from '../api/vendor'

type Props = { onNotice: (message: string) => void }

export function VendorLocationPanel({ onNotice }: Props) {
  const profile = useQuery({ queryKey: ['vendor', 'profile'], queryFn: vendorApi.profile })
  if (profile.isLoading) return <section className="workspace-view-panel"><h2>Loading service location…</h2></section>
  if (profile.isError || !profile.data) return <section className="workspace-view-panel"><h2>Service location is unavailable.</h2><button className="button button-primary" onClick={() => void profile.refetch()}>Retry</button></section>
  return <VendorLocationEditor key={`${profile.data.latitude ?? ''}:${profile.data.longitude ?? ''}`} profile={profile.data} onNotice={onNotice} />
}

function VendorLocationEditor({ profile, onNotice }: Props & { profile: VendorProfileLocation }) {
  const queryClient = useQueryClient()
  const [latitude, setLatitude] = useState(profile.latitude === null ? '' : String(profile.latitude))
  const [longitude, setLongitude] = useState(profile.longitude === null ? '' : String(profile.longitude))
  const [locationError, setLocationError] = useState('')
  const [locating, setLocating] = useState(false)

  const save = useMutation({
    mutationFn: vendorApi.updateProfileLocation,
    onSuccess: (updated) => {
      queryClient.setQueryData(['vendor', 'profile'], updated)
      onNotice('Service location saved. Nearby order distances will use this pin.')
    },
    onError: () => onNotice('Service location could not be saved.'),
  })

  function useCurrentLocation() {
    if (!navigator.geolocation) {
      setLocationError('Location detection is not supported in this browser. Enter coordinates manually.')
      return
    }
    setLocating(true)
    setLocationError('')
    navigator.geolocation.getCurrentPosition((position) => {
      setLatitude(position.coords.latitude.toFixed(6))
      setLongitude(position.coords.longitude.toFixed(6))
      setLocating(false)
    }, (error) => {
      setLocationError(error.code === error.PERMISSION_DENIED ? 'Location permission was denied. Enter coordinates manually.' : 'Could not detect your location. Try again or enter coordinates manually.')
      setLocating(false)
    }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 })
  }

  return <section className="workspace-view-panel vendor-management-panel">
    <div className="view-panel-heading"><div><p className="eyebrow">DISPATCH LOCATION</p><h2>Set your service base.</h2></div><span className="admin-record-icon"><MapPin size={18} /></span></div>
    <p>Orders are ranked using the distance from this pin to the customer’s delivery location. Keep it at your depot or usual dispatch point.</p>
    <form className="modal-form vendor-location-form" onSubmit={(event) => {
      event.preventDefault()
      const lat = Number(latitude)
      const lng = Number(longitude)
      if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
        setLocationError('Enter a valid latitude and longitude.')
        return
      }
      setLocationError('')
      save.mutate({ latitude: lat, longitude: lng })
    }}>
      <div className="vendor-location-fields"><label>Latitude<input type="number" inputMode="decimal" min="-90" max="90" step="0.000001" value={latitude} onChange={(event) => setLatitude(event.target.value)} required placeholder="e.g. 12.971600" /></label><label>Longitude<input type="number" inputMode="decimal" min="-180" max="180" step="0.000001" value={longitude} onChange={(event) => setLongitude(event.target.value)} required placeholder="e.g. 80.243200" /></label></div>
      {locationError && <p role="alert" className="form-error">{locationError}</p>}
      {profile.latitude === null || profile.longitude === null ? <p className="vendor-location-note">No service pin is saved yet. Your orders can still arrive, but their distance cannot be calculated until you set it.</p> : <p className="vendor-location-note">Saved service point: {Number(profile.latitude).toFixed(6)}, {Number(profile.longitude).toFixed(6)}</p>}
      <div className="vendor-location-actions"><button className="button button-quiet" type="button" onClick={useCurrentLocation} disabled={locating}><Crosshair size={16} /> {locating ? 'Finding location…' : 'Use current location'}</button><button className="button button-primary" type="submit" disabled={save.isPending}><Save size={16} /> {save.isPending ? 'Saving…' : 'Save service location'}</button></div>
    </form>
  </section>
}
