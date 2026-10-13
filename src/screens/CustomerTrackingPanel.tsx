import { Navigation, RefreshCw, ShieldCheck } from 'lucide-react'
import { demoDataEnabled } from '../constants/demo'
import { useCustomerBookings, useCustomerDeliveryOtp, useCustomerTracking } from '../hooks/useCustomerData'
import { isTrackingStale } from '../utils/customerData'

type Props = { onNotice: (message: string) => void }
const statuses = ['pending_vendor', 'vendor_assigned', 'accepted', 'en_route', 'arrived', 'delivered']
const demoSnapshot = { status: 'en_route', latitude: 13.0475, longitude: 80.209, eta: '25 min', vehicle: 'TN 38 AB 4120', driver: 'Arun Kumar', otpRequired: false }

export function CustomerTrackingPanel({ onNotice }: Props) {
  const bookingsQuery = useCustomerBookings()
  const otp = useCustomerDeliveryOtp()
  const activeBooking = bookingsQuery.data?.find((booking) => !['delivered', 'cancelled'].includes(booking.status)) ?? bookingsQuery.data?.[0]
  const tracking = useCustomerTracking(demoDataEnabled ? null : activeBooking?.id ?? null)
  const snapshot = demoDataEnabled ? demoSnapshot : tracking.data
  const recordedAt = snapshot && 'recorded_at' in snapshot ? snapshot.recorded_at : undefined
  const stale = isTrackingStale(recordedAt)
  const hasCoordinates = typeof snapshot?.latitude === 'number' && typeof snapshot.longitude === 'number' && !stale
  const mapUrl = hasCoordinates ? `https://www.openstreetmap.org/export/embed.html?marker=${snapshot.latitude}%2C${snapshot.longitude}&zoom=14` : null
  const currentStatus = snapshot?.status ?? activeBooking?.status ?? 'pending_vendor'
  const currentIndex = statuses.indexOf(currentStatus)
  function requestOtp() { if (!activeBooking) return onNotice('There is no active delivery to verify.'); otp.mutate(activeBooking.id, { onSuccess: (result) => onNotice(`Delivery OTP sent. It expires at ${new Date(result.expiresAt).toLocaleTimeString()}.`), onError: () => onNotice('Delivery OTP could not be sent.') }) }
  if (!demoDataEnabled && bookingsQuery.isLoading) return <Loading />
  if (!demoDataEnabled && !activeBooking) return <EmptyTracking />
  if (!demoDataEnabled && (bookingsQuery.isError || tracking.isError)) return <section className="workspace-view-panel customer-operation-panel"><p className="eyebrow">LIVE TRACKING</p><h2>Live tracking is unavailable.</h2><button className="button button-primary" onClick={() => { void bookingsQuery.refetch(); void tracking.refetch() }}>Retry</button></section>
  return <section className="workspace-view-panel customer-operation-panel"><div className="view-panel-heading"><div><p className="eyebrow">LIVE TRACKING</p><h2>{currentStatus.replace('_', ' ')}</h2></div><button className="button button-quiet" onClick={() => { void tracking.refetch(); onNotice('Live location refreshed.') }}><RefreshCw size={14} /> Refresh</button></div><div className="tracking-timeline">{statuses.map((status, index) => <span className={index <= currentIndex ? 'is-complete' : ''} key={status}>{status.replace('_', ' ')}</span>)}</div><div className="tracking-map-panel">{mapUrl ? <iframe title="Live tanker location" src={mapUrl} loading="lazy" /> : <div className="tracking-map-empty"><Navigation size={22} /><b>{stale ? 'Location needs a refresh' : 'Waiting for a live location'}</b><p>{stale ? 'The last driver update is over two minutes old.' : 'The driver location will appear when the delivery is en route.'}</p></div>}</div><div className="tracking-details"><span><b>Vehicle</b>{snapshot?.vehicle ?? 'Assigning nearby tanker'}</span><span><b>Driver</b>{snapshot?.driver ?? 'Not assigned yet'}</span><span><b>ETA</b>{snapshot?.eta ?? 'Updating shortly'}</span></div>{snapshot?.otpRequired && <button className="button button-primary" disabled={otp.isPending} onClick={requestOtp}>{otp.isPending ? 'Sending OTP…' : 'Send delivery OTP'} <ShieldCheck size={15} /></button>}</section>
}
function Loading() { return <section className="workspace-view-panel customer-operation-panel"><p className="eyebrow">LIVE TRACKING</p><h2>Loading live location…</h2></section> }
function EmptyTracking() { return <section className="workspace-view-panel customer-operation-panel"><p className="eyebrow">LIVE TRACKING</p><h2>No active delivery.</h2><p>Tracking will appear here after a vendor accepts your request.</p></section> }
