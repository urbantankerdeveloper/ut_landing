import { useState } from 'react'
import { LocateFixed } from 'lucide-react'
import { useFeatureFlags } from '../hooks/useFeatureFlags'
import { reverseGeocodeDeliveryAddress } from '../services/geocoding'
import { homeContent as c } from '../content/home'

export function DeliveryLocationChip() {
  const featureFlags = useFeatureFlags()
  const supportsGeolocation = typeof navigator !== 'undefined' && Boolean(navigator.geolocation)
  const [locationLabel, setLocationLabel] = useState<string>(c.location.defaultLabel)
  const [locationState, setLocationState] = useState<'idle' | 'loading' | 'ready' | 'unavailable'>('idle')

  function detectLocation() {
    if (!supportsGeolocation || locationState === 'loading') return
    setLocationState('loading')
    setLocationLabel(c.location.locating)
    navigator.geolocation.getCurrentPosition(async ({ coords }) => {
      try {
        const address = await reverseGeocodeDeliveryAddress(
          { lat: coords.latitude, lng: coords.longitude },
          featureFlags.data?.address_geocoding_enabled === true,
        )
        setLocationLabel(address)
        setLocationState('ready')
      } catch (error) {
        setLocationLabel(c.location.unableToDetermine)
        setLocationState('unavailable')
        console.warn(JSON.stringify({ event: 'home.location_reverse_geocode_failed', error: error instanceof Error ? error.message : 'Unknown error' }))
      }
    }, () => {
      setLocationLabel(c.location.unavailable)
      setLocationState('unavailable')
    }, { enableHighAccuracy: false, timeout: 10_000, maximumAge: 60_000 })
  }

  return (
    <button
      type="button"
      className={`location-chip ${locationState === 'unavailable' ? 'location-chip-unavailable' : ''}`}
      onClick={detectLocation}
      disabled={!supportsGeolocation || locationState === 'loading'}
      aria-live="polite"
      aria-busy={locationState === 'loading'}
    >
      <LocateFixed size={13} />
      <span>{locationState === 'ready' ? c.location.deliveringTo : locationState === 'loading' ? c.location.locatingLabel : supportsGeolocation ? c.location.useMyLocation : c.location.areaLabel}</span>
      <strong>{locationState === 'loading' ? c.location.locating : locationLabel}</strong>
    </button>
  )
}
