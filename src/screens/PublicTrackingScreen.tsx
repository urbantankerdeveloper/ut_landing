import { useQuery } from '@tanstack/react-query'
import { MapPin, RefreshCw, Smartphone, Truck } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { customerApi, type PublicTracking } from '../api/customer'
import { LiveTrackingMap } from '../components/PublicTrackingMap'
import { trackingContent as c } from '../content/tracking'
import { appTrackingLink, isMobileUserAgent } from '../utils/trackingLink'
import { PUBLIC_TRACKING_POLL_INTERVAL_MS } from '../utils/trackingCadence'

const statusLabels: Record<string, string> = c.status.labels
const statuses = ['pending_vendor', 'vendor_assigned', 'accepted', 'en_route', 'arrived', 'delivered']

export default function PublicTrackingScreen({ token }: { token: string }) {
  const [inBrowser, setInBrowser] = useState(() => !isMobileUserAgent(navigator.userAgent))
  const query = useQuery({ queryKey: ['public-tracking', token], queryFn: () => customerApi.publicTracking(token), refetchInterval: PUBLIC_TRACKING_POLL_INTERVAL_MS, enabled: inBrowser })
  if (!inBrowser) return <TrackingChooser token={token} onBrowser={() => setInBrowser(true)} />
  if (query.isLoading) return <TrackingShell><p role="status">{c.loading}</p></TrackingShell>
  if (query.isError || !query.data) return <TrackingShell><h1>{c.unavailable.title}</h1><p>{c.unavailable.body}</p></TrackingShell>
  return <TrackingDetails tracking={query.data} onRefresh={() => { void query.refetch() }} refreshing={query.isFetching} />
}

function TrackingChooser({ token, onBrowser }: { token: string; onBrowser: () => void }) {
  return <TrackingShell>
    <div className="section-intro"><p className="eyebrow">{c.eyebrow}</p><h1>{c.chooser.title}</h1><p>{c.chooser.intro}</p></div>
    <section className="reference-copy-card public-tracking-card">
      <div className="tracking-chooser-actions"><a className="button button-primary" href={appTrackingLink(token)}><Smartphone size={14} /> {c.chooser.openApp}</a><button className="button button-quiet" type="button" onClick={onBrowser}>{c.chooser.continueBrowser}</button></div>
      <p>{c.chooser.fallbackHint}</p>
    </section>
  </TrackingShell>
}

function TrackingDetails({ tracking, onRefresh, refreshing }: { tracking: PublicTracking; onRefresh: () => void; refreshing: boolean }) {
  const currentIndex = statuses.indexOf(tracking.status)
  return <TrackingShell>
    <div className="section-intro"><p className="eyebrow">{c.eyebrow}</p><h1>{c.details.bookingPrefix}<em>{tracking.bookingReference}</em></h1><p>{statusLabels[tracking.status] ?? c.status.fallback}</p></div>
    <section className="reference-copy-card public-tracking-card">
      <div className="view-panel-heading"><div><p className="eyebrow">{c.details.deliveryStatusEyebrow}</p><h2>{statusLabels[tracking.status] ?? tracking.status}</h2></div><button className="button button-quiet" onClick={onRefresh} disabled={refreshing}><RefreshCw size={14} /> {c.details.refresh}</button></div>
      <div className="tracking-timeline">{statuses.map((status, index) => <span className={index <= currentIndex ? 'is-complete' : ''} key={status}>{statusLabels[status]}</span>)}</div>
      {tracking.lastLocation ? <LiveTrackingMap latitude={tracking.lastLocation.latitude} longitude={tracking.lastLocation.longitude} lastUpdated={tracking.lastLocation.recordedAt} /> : <div className="tracking-map-empty"><MapPin size={22} /><b>{c.details.waitingTitle}</b><p>{c.details.waitingBody}</p></div>}
      <div className="tracking-details"><span><b>{c.details.vehicleLabel}</b>{tracking.vehicle ?? c.details.vehicleFallback}</span><span><b>{c.details.driverLabel}</b>{tracking.driver ?? c.details.driverFallback}</span><span><b>{c.details.expectedLabel}</b>{tracking.expectedDelivery ? new Date(tracking.expectedDelivery).toLocaleString() : c.details.expectedFallback}</span></div>
    </section>
    <section className="reference-copy-card public-tracking-card"><p className="eyebrow">{c.timeline.eyebrow}</p><h2>{c.timeline.heading}</h2><div className="public-tracking-events">{tracking.events.map((event) => <article key={`${event.status}-${event.createdAt}`}><Truck size={16} /><div><b>{statusLabels[event.status] ?? event.status}</b><p>{event.note ?? c.timeline.eventFallbackNote}</p></div><time>{new Date(event.createdAt).toLocaleString()}</time></article>)}</div></section>
  </TrackingShell>
}

function TrackingShell({ children }: { children: ReactNode }) {
  return <section className="content-screen public-reference-screen">{children}</section>
}
