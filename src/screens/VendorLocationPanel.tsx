import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Crosshair, MapPin, Save } from 'lucide-react'
import { vendorApi, type VendorProfileLocation } from '../api/vendor'
import { vendorContent as c } from '../content/vendor'

type Props = { onNotice: (message: string) => void }

export function VendorLocationPanel({ onNotice }: Props) {
  const profile = useQuery({ queryKey: ['vendor', 'profile'], queryFn: vendorApi.profile })
  if (profile.isLoading) return <section className="workspace-view-panel" role="status"><h2>{c.location.loading}</h2></section>
  if (profile.isError || !profile.data) return <section className="workspace-view-panel" role="alert"><h2>{c.location.unavailable}</h2><button className="button button-primary" onClick={() => void profile.refetch()}>{c.common.retry}</button></section>
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
      onNotice(c.location.saved)
    },
    onError: () => onNotice(c.location.saveFailed),
  })

  function useCurrentLocation() {
    if (!navigator.geolocation) {
      setLocationError(c.location.geolocationUnsupported)
      return
    }
    setLocating(true)
    setLocationError('')
    navigator.geolocation.getCurrentPosition((position) => {
      setLatitude(position.coords.latitude.toFixed(6))
      setLongitude(position.coords.longitude.toFixed(6))
      setLocating(false)
    }, (error) => {
      setLocationError(error.code === error.PERMISSION_DENIED ? c.location.permissionDenied : c.location.detectFailed)
      setLocating(false)
    }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 })
  }

  return <section className="workspace-view-panel vendor-management-panel">
    <div className="view-panel-heading"><div><p className="eyebrow">{c.location.eyebrow}</p><h2>{c.location.heading}</h2></div><span className="admin-record-icon"><MapPin size={18} /></span></div>
    <p>{c.location.intro}</p>
    <form className="modal-form vendor-location-form" onSubmit={(event) => {
      event.preventDefault()
      const lat = Number(latitude)
      const lng = Number(longitude)
      if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
        setLocationError(c.location.invalidCoordinates)
        return
      }
      setLocationError('')
      save.mutate({ latitude: lat, longitude: lng })
    }}>
      <div className="vendor-location-fields"><label>{c.location.latitude}<input type="number" inputMode="decimal" min="-90" max="90" step="0.000001" value={latitude} onChange={(event) => setLatitude(event.target.value)} required placeholder={c.location.latitudePlaceholder} /></label><label>{c.location.longitude}<input type="number" inputMode="decimal" min="-180" max="180" step="0.000001" value={longitude} onChange={(event) => setLongitude(event.target.value)} required placeholder={c.location.longitudePlaceholder} /></label></div>
      {locationError && <p role="alert" className="form-error">{locationError}</p>}
      {profile.latitude === null || profile.longitude === null ? <p className="vendor-location-note">{c.location.noPinSaved}</p> : <p className="vendor-location-note">{c.location.savedPoint(Number(profile.latitude).toFixed(6), Number(profile.longitude).toFixed(6))}</p>}
      <div className="vendor-location-actions"><button className="button button-quiet" type="button" onClick={useCurrentLocation} disabled={locating}><Crosshair size={16} /> {locating ? c.location.findingLocation : c.location.useCurrentLocation}</button><button className="button button-primary" type="submit" disabled={save.isPending}><Save size={16} /> {save.isPending ? c.common.saving : c.location.saveLocation}</button></div>
    </form>
  </section>
}

