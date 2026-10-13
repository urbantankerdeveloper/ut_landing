import type { FormEvent } from 'react'
import { CheckCircle2, MessageCircle } from 'lucide-react'
import { demoDataEnabled } from '../constants/demo'
import { useResolveVendorComplaint, useVendorComplaints } from '../hooks/useVendorData'

export function VendorComplaintsPanel({ onNotice }: { onNotice: (message: string) => void }) {
  const query = useVendorComplaints()
  const resolve = useResolveVendorComplaint()
  if (!demoDataEnabled && query.isLoading) return <section className="workspace-view-panel"><h2>Loading complaints...</h2></section>
  if (!demoDataEnabled && query.isError) return <section className="workspace-view-panel"><h2>Complaints are unavailable.</h2><button className="button button-primary" onClick={() => query.refetch()}>Retry</button></section>
  const rows = demoDataEnabled ? [{ id: 'demo', subject: 'Customer requested a reschedule', booking_id: 'UT-2409', status: 'open', message: 'Review requested.' }] : query.data ?? []
  function submit(event: FormEvent<HTMLFormElement>, id: string) { event.preventDefault(); const values = new FormData(event.currentTarget); const resolution = String(values.get('resolution') || '').trim(); const status = String(values.get('status') || 'in_progress'); if (!resolution) return; resolve.mutate({ id, payload: { status, resolution } }, { onSuccess: () => onNotice('Complaint updated.'), onError: () => onNotice('Complaint could not be updated.') }) }
  return <section className="workspace-view-panel vendor-operations-panel"><div className="view-panel-heading"><div><p className="eyebrow">COMPLAINTS</p><h2>Resolve customer issues.</h2></div></div><div className="vendor-complaint-list">{rows.map((complaint) => <article key={complaint.id}><span><MessageCircle size={17} /></span><div><b>{complaint.subject}</b><p>{complaint.booking_id ?? 'Booking'} · {complaint.message}</p><strong>{complaint.status}</strong><form className="complaint-resolution-form" onSubmit={(event) => submit(event, complaint.id)}><select name="status" defaultValue={complaint.status === 'open' ? 'in_progress' : complaint.status}><option value="in_progress">In progress</option><option value="resolved">Resolved</option></select><input name="resolution" required placeholder="Add resolution or response" /><button className="button button-quiet" disabled={resolve.isPending}><CheckCircle2 size={14} /> Save</button></form></div></article>)}{!rows.length && <div className="admin-empty-state">No complaints have been submitted.</div>}</div></section>
}
