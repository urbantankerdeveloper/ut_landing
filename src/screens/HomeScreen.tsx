import { useEffect, useState } from 'react'
import { ArrowRight, Check, Droplets, LocateFixed, ShieldCheck, Truck } from 'lucide-react'
import { useNavigationStore } from '../stores/navigationStore'
import type { LatLngLiteral } from 'leaflet'
import { reverseGeocodeApproximate } from '../services/geocoding'
const services = [{ title: 'Water tankers', copy: 'Reliable supply for homes, apartments and sites.', icon: Droplets }, { title: 'Sewage tankers', copy: 'Septic cleaning and scheduled wastewater collection.', icon: Truck }, { title: 'Infrastructure', copy: 'Drilling, inspection and maintenance for your site.', icon: LocateFixed }]
export default function HomeScreen() {
  const navigate = useNavigationStore((state) => state.navigate)
  const supportsGeolocation = typeof navigator !== 'undefined' && Boolean(navigator.geolocation)
  const [locationLabel, setLocationLabel] = useState(supportsGeolocation ? 'Finding your area…' : 'Location unavailable · Choose an area when booking')
  const [locationState, setLocationState] = useState<'loading' | 'ready' | 'unavailable'>(supportsGeolocation ? 'loading' : 'unavailable')

  useEffect(() => {
    if (!supportsGeolocation) return
    let active = true
    let resolving = false
    let lastGeocodedPoint: LatLngLiteral | null = null
    const unavailableLabel = 'Location unavailable · Choose an area when booking'
    async function updateLocation(position: GeolocationPosition) {
      if (!active || resolving) return
      const point: LatLngLiteral = { lat: position.coords.latitude, lng: position.coords.longitude }
      const movedEnough = !lastGeocodedPoint || Math.abs(point.lat - lastGeocodedPoint.lat) > 0.0005 || Math.abs(point.lng - lastGeocodedPoint.lng) > 0.0005
      if (!movedEnough) return
      resolving = true
      try {
        const approximateName = await reverseGeocodeApproximate(point)
        if (!active) return
        lastGeocodedPoint = point
        setLocationLabel(approximateName)
        setLocationState('ready')
      } catch (error) {
        if (!active) return
        setLocationLabel(unavailableLabel)
        setLocationState('unavailable')
        console.warn(JSON.stringify({ event: 'home.location_reverse_geocode_failed', error: error instanceof Error ? error.message : 'Unknown error' }))
      } finally {
        resolving = false
      }
    }
    function handleLocationError() {
        if (!active) return
        setLocationLabel(unavailableLabel)
        setLocationState('unavailable')
    }
    const watchId = navigator.geolocation.watchPosition((position) => { void updateLocation(position) }, handleLocationError, { enableHighAccuracy: false, timeout: 10_000, maximumAge: 60_000 })
    function refreshLocation() {
      if (!active) return
      setLocationLabel('Finding your area…')
      setLocationState('loading')
      navigator.geolocation.getCurrentPosition((position) => { void updateLocation(position) }, handleLocationError, { enableHighAccuracy: false, timeout: 10_000, maximumAge: 0 })
    }
    function refreshWhenVisible() {
      if (document.visibilityState === 'visible') refreshLocation()
    }
    refreshLocation()
    window.addEventListener('focus', refreshLocation)
    document.addEventListener('visibilitychange', refreshWhenVisible)
    let permissionStatus: PermissionStatus | undefined
    void navigator.permissions?.query({ name: 'geolocation' }).then((status) => {
      if (!active) return
      permissionStatus = status
      status.addEventListener('change', refreshLocation)
    }).catch((error: unknown) => {
      console.warn(JSON.stringify({ event: 'home.location_permission_watch_failed', error: error instanceof Error ? error.message : 'Unknown error' }))
    })
    return () => {
      active = false
      navigator.geolocation.clearWatch(watchId)
      window.removeEventListener('focus', refreshLocation)
      document.removeEventListener('visibilitychange', refreshWhenVisible)
      permissionStatus?.removeEventListener('change', refreshLocation)
    }
  }, [supportsGeolocation])

  return <div className="home-screen"><section className="hero hero-photo"><div className="hero-copy"><p className={`location-chip ${locationState === 'unavailable' ? 'location-chip-unavailable' : ''}`}><LocateFixed size={13} /> <span>{locationState === 'ready' ? 'Delivering to' : ''}</span> <strong>{locationLabel}</strong></p><p className="eyebrow">Complete Water Solutions Partner</p><h1>Urban Tanker. <em>For every drop you need.</em></h1><p className="hero-lede">Reliable water, sanitation, infrastructure and bulk-liquid services for homes, apartments, businesses and project sites.</p><div className="hero-actions"><button className="button button-primary hero-primary" onClick={() => navigate('booking')}>Book now <ArrowRight size={16} /></button><button className="button button-quiet hero-secondary" onClick={() => navigate('services')}>Explore services</button></div><div className="trust-row"><span><Check size={14} /><b>Verified</b> vendors</span><span><Check size={14} /><b>Live</b> tracking</span><span><Check size={14} /><b>Secure</b> delivery OTP</span></div></div></section><section className="home-subscription-teaser"><div><p className="eyebrow">YEARLY CONTRACTS</p><h2>One plan. A whole year covered.</h2><p>Residential, commercial and apartment service plans. Combine services and see your annual estimate.</p></div><div className="teaser-plan"><small>BUILT AROUND YOUR PROPERTY</small><strong>12 months. <span>Your services.</span></strong><p>Water, sewage, cleaning and more in one request.</p><button className="button button-primary" onClick={() => navigate('booking')}>Build your yearly plan <ArrowRight size={15} /></button></div></section><section className="reference-showcase"><div className="reference-header"><div><p className="eyebrow">THE URBAN TANKER WAY</p><h2>Every requirement. Covered.</h2></div><button className="text-button" onClick={() => navigate('services')}>Explore all services <ArrowRight size={14} /></button></div><p className="service-explorer-intro">From everyday essentials to ambitious projects. Get to know the service that fits.</p><div className="service-showcase-grid">{services.map(({ title, copy, icon: Icon }) => <article className="service-showcase-card" key={title}><span className="service-icon"><Icon size={25} /></span><h3>{title}</h3><p>{copy}</p><button className="text-button" onClick={() => navigate('booking')}>Discover the service <ArrowRight size={13} /></button></article>)}</div></section><section className="benefit-strip"><div><ShieldCheck size={20} /><span><b>Trusted operations</b><small>Verified vendors and secure delivery</small></span></div><div><Truck size={20} /><span><b>On your schedule</b><small>Choose a preferred delivery slot</small></span></div><div><LocateFixed size={20} /><span><b>Stay in the loop</b><small>Track every booking status</small></span></div></section></div>
}
