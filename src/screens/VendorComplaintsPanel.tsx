import { useState, type FormEvent } from 'react'
import { CheckCircle2, MessageCircle } from 'lucide-react'
import { demoDataEnabled } from '../constants/demo'
import { useResolveVendorComplaint, useVendorComplaints } from '../hooks/useVendorData'
import { vendorContent as c } from '../content/vendor'

export function VendorComplaintsPanel({ onNotice }: { onNotice: (message: string) => void }) {
  const [savingId, setSavingId] = useState<string | number | null>(null)
  const query = useVendorComplaints()
  const resolve = useResolveVendorComplaint()
  if (!demoDataEnabled && query.isLoading) return <section className="workspace-view-panel"><h2>{c.complaints.loading}</h2></section>
  if (!demoDataEnabled && query.isError) return <section className="workspace-view-panel"><h2>{c.complaints.unavailable}</h2><button className="button button-primary" onClick={() => query.refetch()}>{c.common.retry}</button></section>
  const rows = demoDataEnabled ? [...c.complaints.demoRows] : query.data ?? []
  function submit(event: FormEvent<HTMLFormElement>, id: string) { event.preventDefault(); const values = new FormData(event.currentTarget); const resolution = String(values.get('resolution') || '').trim(); const status = String(values.get('status') || 'in_progress'); if (!resolution) return; setSavingId(id); resolve.mutate({ id, payload: { status, resolution } }, { onSuccess: () => { setSavingId(null); onNotice(c.complaints.updated) }, onError: () => { setSavingId(null); onNotice(c.complaints.updateFailed) } }) }
  return <section className="workspace-view-panel vendor-operations-panel"><div className="view-panel-heading"><div><p className="eyebrow">{c.complaints.eyebrow}</p><h2>{c.complaints.heading}</h2></div></div><div className="vendor-complaint-list">{rows.map((complaint) => <article key={complaint.id}><span><MessageCircle size={17} /></span><div><b>{complaint.subject}</b><p>{complaint.booking_id ?? c.common.bookingFallback}{c.common.separator}{complaint.message}</p><strong>{complaint.status}</strong><form className="complaint-resolution-form" onSubmit={(event) => submit(event, complaint.id)}><select name="status" defaultValue={complaint.status === 'open' ? 'in_progress' : complaint.status}>{c.complaints.statusOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select><input name="resolution" required placeholder={c.complaints.resolutionPlaceholder} /><button className="button button-quiet" disabled={savingId === complaint.id}><CheckCircle2 size={14} /> {savingId === complaint.id ? c.common.saving : c.common.save}</button></form></div></article>)}{!rows.length && <div className="admin-empty-state">{c.common.noComplaints}</div>}</div></section>
}

