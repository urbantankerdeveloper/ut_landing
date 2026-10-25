import { useQuery } from '@tanstack/react-query'
import { MapPin, RefreshCw, Truck } from 'lucide-react'
import type { ReactNode } from 'react'
import { customerApi, type PublicTracking } from '../api/customer'
import { LiveTrackingMap } from '../components/PublicTrackingMap'

const statusLabels: Record<string, string> = {
  pending_vendor: 'Request received',
  vendor_assigned: 'Vendor assigned',
  accepted: 'Accepted',
  en_route: 'On the way',
  arrived: 'Arrived',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
}
const statuses = ['pending_vendor', 'vendor_assigned', 'accepted', 'en_route', 'arrived', 'delivered']

export default function PublicTrackingScreen({ token }: { token: string }) {
  const query = useQuery({ queryKey: ['public-tracking', token], queryFn: () => customerApi.publicTracking(token), refetchInterval: 30_000 })
  if (query.isLoading) return <TrackingShell><p role="status">Loading live tracking…</p></TrackingShell>
  if (query.isError || !query.data) return <TrackingShell><h1>Tracking link unavailable</h1><p>This tracking link is invalid, expired, or no longer active.</p></TrackingShell>
  return <TrackingDetails tracking={query.data} onRefresh={() => { void query.refetch() }} refreshing={query.isFetching} />
}

function TrackingDetails({ tracking, onRefresh, refreshing }: { tracking: PublicTracking; onRefresh: () => void; refreshing: boolean }) {
  const currentIndex = statuses.indexOf(tracking.status)
  return <TrackingShell>
    <div className="section-intro"><p className="eyebrow">URBAN TANKER LIVE TRACKING</p><h1>Booking <em>{tracking.bookingReference}</em></h1><p>{statusLabels[tracking.status] ?? 'Delivery update'}</p></div>
    <section className="reference-copy-card public-tracking-card">
      <div className="view-panel-heading"><div><p className="eyebrow">DELIVERY STATUS</p><h2>{statusLabels[tracking.status] ?? tracking.status}</h2></div><button className="button button-quiet" onClick={onRefresh} disabled={refreshing}><RefreshCw size={14} /> Refresh</button></div>
      <div className="tracking-timeline">{statuses.map((status, index) => <span className={index <= currentIndex ? 'is-complete' : ''} key={status}>{statusLabels[status]}</span>)}</div>
      {tracking.lastLocation ? <LiveTrackingMap latitude={tracking.lastLocation.latitude} longitude={tracking.lastLocation.longitude} /> : <div className="tracking-map-empty"><MapPin size={22} /><b>Waiting for a live location</b><p>The vehicle location will appear when the delivery is en route.</p></div>}
      <div className="tracking-details"><span><b>Vehicle</b>{tracking.vehicle ?? 'Assigning nearby tanker'}</span><span><b>Driver</b>{tracking.driver ?? 'Not assigned yet'}</span><span><b>Expected delivery</b>{tracking.expectedDelivery ? new Date(tracking.expectedDelivery).toLocaleString() : 'Updating shortly'}</span></div>
    </section>
    <section className="reference-copy-card public-tracking-card"><p className="eyebrow">DELIVERY UPDATES</p><h2>Booking timeline</h2><div className="public-tracking-events">{tracking.events.map((event) => <article key={`${event.status}-${event.createdAt}`}><Truck size={16} /><div><b>{statusLabels[event.status] ?? event.status}</b><p>{event.note ?? 'Booking status updated.'}</p></div><time>{new Date(event.createdAt).toLocaleString()}</time></article>)}</div></section>
  </TrackingShell>
}

function TrackingShell({ children }: { children: ReactNode }) {
  return <section className="content-screen public-reference-screen">{children}</section>
}
