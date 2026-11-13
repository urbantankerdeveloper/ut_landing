import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { CircleMarker, MapContainer, Marker, Polyline, TileLayer, useMapEvents } from 'react-leaflet'
import { divIcon } from 'leaflet'
import type { LatLngBoundsExpression, Map as LeafletMap, Marker as LeafletMarker } from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { locationContent } from '../content/location'
import { loadGoogleMapsApi } from '../utils/googleMapsApi'
import { calculateBearing, type MapPoint } from '../utils/mapCoordinates'
import { mapProviderResolver } from '../utils/mapProviderResolver'
import type { MapProviderResolver } from '../utils/mapProviderResolver'
import { formatTrackingUpdatedAgo } from '../utils/trackingFreshness'

type Props = {
  vehicle: MapPoint | null
  destination?: MapPoint | null
  trail?: MapPoint[]
  lastUpdated?: string | null
  onMapClick?: (point: MapPoint) => void
  className?: string
  resolver?: MapProviderResolver
}

type MapViewProps = {
  vehicle: MapPoint | null
  destination: MapPoint | null
  trail: MapPoint[]
  onMapClick?: (point: MapPoint) => void
}

const defaultCenter: MapPoint = { lat: 13.0827, lng: 80.2707 }
const emptyTrail: MapPoint[] = []

export function LiveFleetMap({ vehicle, destination = null, trail = emptyTrail, lastUpdated = null, onMapClick, className = '', resolver = mapProviderResolver }: Props) {
  const useGoogleMaps = useSyncExternalStore(resolver.subscribe, resolver.getSnapshot, () => false)

  return <div className={`live-fleet-map ${className}`.trim()}>
    {useGoogleMaps
      ? <GoogleMapView vehicle={vehicle} destination={destination} trail={trail} onMapClick={onMapClick} resolver={resolver} />
      : <OsmMapView vehicle={vehicle} destination={destination} trail={trail} onMapClick={onMapClick} />}
    {lastUpdated && <LastUpdatedLabel timestamp={lastUpdated} />}
  </div>
}

function LastUpdatedLabel({ timestamp }: { timestamp: string }) {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000)
    return () => window.clearInterval(timer)
  }, [timestamp])
  const label = formatTrackingUpdatedAgo(timestamp, now)
  return label ? <time className="live-map-updated" dateTime={timestamp}>{label}</time> : null
}

function GoogleMapView({ vehicle, destination, trail, onMapClick, resolver }: MapViewProps & { resolver: MapProviderResolver }) {
  const vehicleLatitude = vehicle?.lat
  const vehicleLongitude = vehicle?.lng
  const destinationLatitude = destination?.lat
  const destinationLongitude = destination?.lng
  const vehiclePoint = useMemo(() => vehicleLatitude === undefined || vehicleLongitude === undefined ? null : { lat: vehicleLatitude, lng: vehicleLongitude }, [vehicleLatitude, vehicleLongitude])
  const destinationPoint = useMemo(() => destinationLatitude === undefined || destinationLongitude === undefined ? null : { lat: destinationLatitude, lng: destinationLongitude }, [destinationLatitude, destinationLongitude])
  const containerRef = useRef<HTMLDivElement>(null)
  const [map, setMap] = useState<google.maps.Map | null>(null)
  const [hasPanned, setHasPanned] = useState(false)
  const dragListenerRef = useRef<google.maps.MapsEventListener | null>(null)
  const clickListenerRef = useRef<google.maps.MapsEventListener | null>(null)
  const vehicleMarkerRef = useRef<google.maps.Marker | null>(null)
  const destinationMarkerRef = useRef<google.maps.Marker | null>(null)
  const trailLineRef = useRef<google.maps.Polyline | null>(null)
  const vehicleTargetRef = useRef<MapPoint | null>(null)
  const destinationTargetRef = useRef<MapPoint | null>(null)
  const cameraVehicleTargetRef = useRef<MapPoint | null>(null)
  const cameraDestinationTargetRef = useRef<MapPoint | null>(null)
  const displayedVehicleRef = useRef<MapPoint | null>(null)
  const hasFitBoundsRef = useRef(false)
  const hasPannedRef = useRef(false)
  const followVehicleRef = useRef(true)
  const onMapClickRef = useRef(onMapClick)

  useEffect(() => {
    onMapClickRef.current = onMapClick
  }, [onMapClick])

  useEffect(() => {
    let disposed = false
    void loadGoogleMapsApi(resolver.apiKey, (reason) => resolver.markUnavailable(reason)).then(() => {
      if (disposed || !containerRef.current || !resolver.useGoogleMaps) return
      const mapsApi = window.google?.maps
      if (!mapsApi) {
        resolver.markUnavailable(new Error('Google Maps API is unavailable after script load'))
        return
      }
      try {
        const instance = new mapsApi.Map(containerRef.current, {
          center: defaultCenter,
          zoom: 11,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: false,
          clickableIcons: false,
        })
        dragListenerRef.current = instance.addListener('dragstart', () => {
          followVehicleRef.current = false
          hasPannedRef.current = true
          setHasPanned(true)
        })
        clickListenerRef.current = instance.addListener('click', (event: google.maps.MapMouseEvent) => {
          const point = event.latLng?.toJSON()
          if (point) onMapClickRef.current?.({ lat: point.lat, lng: point.lng })
        })
        setMap(instance)
      } catch (error) {
        resolver.markUnavailable(error)
      }
    }).catch((error: unknown) => {
      if (!disposed) resolver.markUnavailable(error)
    })

    return () => {
      disposed = true
      dragListenerRef.current?.remove()
      clickListenerRef.current?.remove()
      vehicleMarkerRef.current?.setMap(null)
      destinationMarkerRef.current?.setMap(null)
      trailLineRef.current?.setMap(null)
    }
  }, [resolver])

  useEffect(() => {
    if (!map) return
    const mapsApi = window.google?.maps
    if (!mapsApi) {
      resolver.markUnavailable(new Error('Google Maps API became unavailable'))
      return
    }

    const previousVehicle = vehicleTargetRef.current
    if (!vehiclePoint) {
      vehicleMarkerRef.current?.setMap(null)
      vehicleMarkerRef.current = null
      displayedVehicleRef.current = null
      vehicleTargetRef.current = null
      return
    }

    if (!vehicleMarkerRef.current) {
      vehicleMarkerRef.current = new mapsApi.Marker({
        map,
        position: vehiclePoint,
        title: 'Fleet vehicle',
        icon: googleVehicleSymbol(mapsApi, 0),
      })
      displayedVehicleRef.current = vehiclePoint
    } else if (!samePoint(previousVehicle, vehiclePoint)) {
      const marker = vehicleMarkerRef.current
      const from = displayedVehicleRef.current ?? previousVehicle ?? vehiclePoint
      marker.setIcon(googleVehicleSymbol(mapsApi, calculateBearing(from, vehiclePoint)))
      const startedAt = performance.now()
      let animationFrame: number | null = null
      const animate = (now: number) => {
        const progress = Math.min(1, (now - startedAt) / 1_100)
        const eased = progress * progress * (3 - 2 * progress)
        const point = {
          lat: from.lat + (vehiclePoint.lat - from.lat) * eased,
          lng: from.lng + (vehiclePoint.lng - from.lng) * eased,
        }
        marker.setPosition(point)
        displayedVehicleRef.current = point
        if (progress < 1) animationFrame = window.requestAnimationFrame(animate)
        else {
          marker.setPosition(vehiclePoint)
          displayedVehicleRef.current = vehiclePoint
          animationFrame = null
        }
      }
      animationFrame = window.requestAnimationFrame(animate)
      vehicleTargetRef.current = vehiclePoint
      return () => {
        if (animationFrame !== null) window.cancelAnimationFrame(animationFrame)
      }
    }
    vehicleTargetRef.current = vehiclePoint
  }, [map, vehiclePoint, resolver])

  useEffect(() => {
    if (!map) return
    const mapsApi = window.google?.maps
    if (!mapsApi) {
      resolver.markUnavailable(new Error('Google Maps API became unavailable'))
      return
    }
    if (destinationPoint) {
      if (!destinationMarkerRef.current) {
        destinationMarkerRef.current = new mapsApi.Marker({
          map,
          position: destinationPoint,
          title: 'Delivery point',
          icon: {
            path: mapsApi.SymbolPath.CIRCLE,
            scale: 8,
            fillColor: '#13a69a',
            fillOpacity: 0.9,
            strokeColor: '#ffffff',
            strokeWeight: 2,
          },
        })
      } else if (!samePoint(destinationTargetRef.current, destinationPoint)) {
        destinationMarkerRef.current.setPosition(destinationPoint)
      }
    } else {
      destinationMarkerRef.current?.setMap(null)
      destinationMarkerRef.current = null
    }
    destinationTargetRef.current = destinationPoint
  }, [map, destinationPoint, resolver])

  useEffect(() => {
    if (!map) return
    const mapsApi = window.google?.maps
    if (!mapsApi) {
      resolver.markUnavailable(new Error('Google Maps API became unavailable'))
      return
    }
    if (trail.length > 1) {
      const path = trail.map(({ lat, lng }) => ({ lat, lng }))
      if (!trailLineRef.current) {
        trailLineRef.current = new mapsApi.Polyline({ map, path, strokeColor: '#f28b30', strokeOpacity: 0.75, strokeWeight: 4 })
      } else {
        trailLineRef.current.setPath(path)
      }
    } else {
      trailLineRef.current?.setMap(null)
      trailLineRef.current = null
    }
  }, [map, trail, resolver])

  useEffect(() => {
    const mapsApi = window.google?.maps
    if (!map || !mapsApi) return
    if (vehiclePoint && destinationPoint && !hasFitBoundsRef.current && !hasPannedRef.current) {
      const bounds = new mapsApi.LatLngBounds()
      bounds.extend(vehiclePoint)
      bounds.extend(destinationPoint)
      map.fitBounds(bounds, 48)
      hasFitBoundsRef.current = true
    } else if (vehiclePoint && !cameraVehicleTargetRef.current) {
      map.setCenter(vehiclePoint)
      map.setZoom(15)
    } else if (vehiclePoint && !samePoint(cameraVehicleTargetRef.current, vehiclePoint) && followVehicleRef.current) {
      map.panTo(vehiclePoint)
    } else if (!vehiclePoint && destinationPoint && !cameraDestinationTargetRef.current) {
      map.setCenter(destinationPoint)
      map.setZoom(15)
    }
    cameraVehicleTargetRef.current = vehiclePoint
    cameraDestinationTargetRef.current = destinationPoint
  }, [map, vehiclePoint, destinationPoint])

  function recenter() {
    if (!map || !vehiclePoint) return
    followVehicleRef.current = true
    hasPannedRef.current = false
    setHasPanned(false)
    map.panTo(vehiclePoint)
  }

  return <>
    <div className="google-map-host">
      <div ref={containerRef} className="live-fleet-map__canvas google-map-canvas" />
      {!map && <div className="google-map-loading" role="status">Loading map…</div>}
    </div>
    {hasPanned && vehicle && <button className="map-recenter" type="button" onClick={recenter}>Recenter map</button>}
  </>
}

function googleVehicleSymbol(mapsApi: typeof google.maps, bearing: number): google.maps.Symbol {
  return {
    path: 'M -9 14 L -8 -8 L -5 -15 L 5 -15 L 8 -8 L 9 14 Z M -6 -6 L 6 -6 L 6 1 L -6 1 Z',
    anchor: new mapsApi.Point(0, 0),
    scale: 1.15,
    rotation: bearing,
    fillColor: '#0d7770',
    fillOpacity: 1,
    strokeColor: '#ffffff',
    strokeWeight: 2,
  }
}

function OsmMapView({ vehicle, destination, trail, onMapClick }: MapViewProps) {
  const [hasPanned, setHasPanned] = useState(false)
  const [map, setMap] = useState<LeafletMap | null>(null)
  const followVehicleRef = useRef(true)
  const hasPannedRef = useRef(false)
  const initialCenter = vehicle ?? destination ?? defaultCenter

  function stopFollowing() {
    followVehicleRef.current = false
    hasPannedRef.current = true
    setHasPanned(true)
  }

  function recenter() {
    if (!vehicle || !map) return
    followVehicleRef.current = true
    hasPannedRef.current = false
    setHasPanned(false)
    map.flyTo(vehicle, Math.max(map.getZoom(), 15), { duration: 0.7 })
  }

  return <>
    <MapContainer center={initialCenter} zoom={vehicle || destination ? 15 : 11} scrollWheelZoom className="leaflet-map live-fleet-map__canvas">
      <TileLayer attribution={locationContent.map.attribution} url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
      <LeafletMapEvents vehicle={vehicle} destination={destination} followVehicleRef={followVehicleRef} hasPannedRef={hasPannedRef} onUserPan={stopFollowing} onMapClick={onMapClick} onMapReady={setMap} />
      {trail.length > 1 && <Polyline positions={trail.map((point) => [point.lat, point.lng] as [number, number])} pathOptions={{ color: '#f28b30', weight: 4, opacity: 0.75 }} />}
      {vehicle && <AnimatedLeafletVehicle vehicle={vehicle} trail={trail} />}
      {destination && <CircleMarker center={destination} radius={8} pathOptions={{ color: '#0d7770', fillColor: '#13a69a', fillOpacity: 0.9 }} />}
    </MapContainer>
    {hasPanned && vehicle && <button className="map-recenter" type="button" onClick={recenter}>Recenter map</button>}
  </>
}

function LeafletMapEvents({ vehicle, destination, followVehicleRef, hasPannedRef, onUserPan, onMapClick, onMapReady }: {
  vehicle: MapPoint | null
  destination: MapPoint | null
  followVehicleRef: { current: boolean }
  hasPannedRef: { current: boolean }
  onUserPan: () => void
  onMapClick?: (point: MapPoint) => void
  onMapReady: (map: LeafletMap) => void
}) {
  const onMapClickRef = useRef(onMapClick)
  const onUserPanRef = useRef(onUserPan)
  useEffect(() => {
    onMapClickRef.current = onMapClick
    onUserPanRef.current = onUserPan
  }, [onMapClick, onUserPan])
  const map = useMapEvents({
    dragstart: () => onUserPanRef.current(),
    click: (event) => onMapClickRef.current?.({ lat: event.latlng.lat, lng: event.latlng.lng }),
  })
  const previousVehicleRef = useRef<MapPoint | null>(null)
  const previousDestinationRef = useRef<MapPoint | null>(null)
  const hasFitBoundsRef = useRef(false)

  useEffect(() => {
    onMapReady(map)
  }, [map, onMapReady])

  useEffect(() => {
    const previousVehicle = previousVehicleRef.current
    if (vehicle && destination && !hasFitBoundsRef.current && !hasPannedRef.current) {
      const bounds: LatLngBoundsExpression = [[vehicle.lat, vehicle.lng], [destination.lat, destination.lng]]
      map.fitBounds(bounds, { padding: [40, 40] })
      hasFitBoundsRef.current = true
    } else if (vehicle && !previousVehicle) {
      map.setView(vehicle, 15)
    } else if (vehicle && !samePoint(previousVehicle, vehicle) && followVehicleRef.current) {
      map.panTo(vehicle)
    } else if (!vehicle && destination && !previousDestinationRef.current) {
      map.setView(destination, 15)
    }
    previousVehicleRef.current = vehicle
    previousDestinationRef.current = destination
  }, [map, vehicle, destination, followVehicleRef, hasPannedRef])

  return null
}

function AnimatedLeafletVehicle({ vehicle, trail }: { vehicle: MapPoint; trail: MapPoint[] }) {
  const markerRef = useRef<LeafletMarker | null>(null)
  const [initialPosition] = useState(vehicle)
  const [initialIcon] = useState(() => leafletVehicleIcon(0))
  const displayedPositionRef = useRef<MapPoint>(vehicle)
  const target = useMemo(() => ({ lat: vehicle.lat, lng: vehicle.lng }), [vehicle.lat, vehicle.lng])

  useEffect(() => {
    const marker = markerRef.current
    if (!marker) return
    const from = displayedPositionRef.current
    const bearing = trail.length > 1 ? calculateBearing(trail[trail.length - 2], trail[trail.length - 1]) : calculateBearing(from, target)
    const body = marker.getElement()?.querySelector<HTMLElement>('.live-fleet-marker__body')
    if (body) body.style.transform = `rotate(${bearing}deg)`
    const startedAt = performance.now()
    let animationFrame: number | null = null
    const animate = (now: number) => {
      const progress = Math.min(1, (now - startedAt) / 1_100)
      const eased = progress * progress * (3 - 2 * progress)
      const point = {
        lat: from.lat + (target.lat - from.lat) * eased,
        lng: from.lng + (target.lng - from.lng) * eased,
      }
      marker.setLatLng(point)
      displayedPositionRef.current = point
      if (progress < 1) animationFrame = window.requestAnimationFrame(animate)
      else {
        marker.setLatLng(target)
        displayedPositionRef.current = target
        animationFrame = null
      }
    }
    if (!samePoint(from, target)) animationFrame = window.requestAnimationFrame(animate)
    return () => {
      if (animationFrame !== null) window.cancelAnimationFrame(animationFrame)
    }
  }, [target, trail])

  return <Marker ref={markerRef} position={initialPosition} icon={initialIcon} />
}

function leafletVehicleIcon(bearing: number) {
  return divIcon({
    className: 'live-fleet-marker',
    html: `<div class="live-fleet-marker__body" style="transform:rotate(${bearing}deg)"><svg viewBox="0 0 32 32" aria-hidden="true"><path d="M11 27 12 9l4-6 4 6 1 18z" /></svg></div>`,
    iconSize: [36, 36],
    iconAnchor: [18, 18],
  })
}

function samePoint(left: MapPoint | null | undefined, right: MapPoint | null | undefined) {
  return left?.lat === right?.lat && left?.lng === right?.lng
}
