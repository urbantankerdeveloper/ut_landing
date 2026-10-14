import { useState } from 'react'
import { Ban, CheckCircle2, RefreshCw } from 'lucide-react'
import { useAdminBookings } from '../hooks/useAdminData'
import { useAdminOrderMutations } from '../hooks/useAdminData'

export function AdminBookingOperationsScreen({ onNotice }: { onNotice: (message: string) => void }) {
  const query = useAdminBookings()
  const mutations = useAdminOrderMutations()
  const [selected, setSelected] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  if (query.isLoading) return <section className="admin-view-panel"><h2>Loading bookings...</h2></section>
  if (query.isError) return <section className="admin-view-panel"><h2>Bookings are unavailable.</h2><button className="button button-primary" onClick={() => query.refetch()}>Retry</button></section>
  const rows = query.data ?? []
  function status(id: string, value: string) { mutations.updateStatus.mutate({ id, status: value }, { onSuccess: () => onNotice('Booking status updated.'), onError: () => onNotice('Booking status could not be updated.') }) }
  function cancel() { if (!selected || reason.trim().length < 2) return; mutations.cancel.mutate({ id: selected, reason }, { onSuccess: () => { setSelected(null); setReason(''); onNotice('Booking cancelled and audited.') }, onError: () => onNotice('Booking could not be cancelled.') }) }
  return <section className="admin-view-panel"><div className="view-panel-heading"><div><p className="eyebrow">BOOKINGS</p><h2>Live booking operations.</h2></div><button className="button button-quiet" onClick={() => query.refetch()}><RefreshCw size={14} /> Refresh</button></div><div className="admin-entity-list">{rows.map((row) => <article key={row.id}><div className="admin-entity-copy"><b>{row.id}</b><p>{row.service} · {row.location}</p></div><span className="status-tag">{row.status}</span><select value={row.status} onChange={(event) => status(row.id, event.target.value)} disabled={mutations.updateStatus.isPending}><option value="pending_vendor">Pending vendor</option><option value="vendor_assigned">Vendor assigned</option><option value="accepted">Accepted</option><option value="en_route">En route</option><option value="arrived">Arrived</option><option value="delivered">Delivered</option></select><button className="entity-status-button" disabled={row.status === 'delivered' || row.status === 'cancelled'} onClick={() => setSelected(row.id)}><Ban size={14} /> Cancel</button></article>)}{!rows.length && <div className="admin-empty-state">No bookings found.</div>}</div>{selected && <div className="modal-form admin-inline-dialog"><b>Cancel booking {selected}</b><textarea value={reason} onChange={(event) => setReason(event.target.value)} rows={3} placeholder="Required cancellation reason" /><div><button className="button button-quiet" onClick={() => setSelected(null)}>Keep booking</button><button className="button button-primary" disabled={mutations.cancel.isPending || reason.trim().length < 2} onClick={cancel}><CheckCircle2 size={14} /> Confirm cancellation</button></div></div>}</section>
}
