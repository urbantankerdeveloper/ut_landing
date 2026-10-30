import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'
import { FileText, RefreshCw } from 'lucide-react'
import { adminApi } from '../api/admin'
import { useAdminContracts, useAdminEnquiries, useAdminSubscriptions } from '../hooks/useAdminData'

type Props = { kind: 'subscriptions' | 'contracts' | 'enquiries'; onNotice: (message: string) => void }
export function AdminProgramsScreen({ kind, onNotice }: Props) {
  const [savingId, setSavingId] = useState<string | null>(null)
  const subscriptions = useAdminSubscriptions()
  const contracts = useAdminContracts()
  const enquiries = useAdminEnquiries()
  const query = kind === 'subscriptions' ? subscriptions : kind === 'contracts' ? contracts : enquiries
  const update = useMutation({ mutationFn: ({ id, status, response }: { id: string; status: string; response?: string }) => kind === 'subscriptions' ? adminApi.updateSubscription(id, status) : kind === 'contracts' ? adminApi.updateContract(id, status) : adminApi.updateEnquiry(id, status, response ?? ''), onSuccess: () => { void query.refetch(); onNotice('Record updated.') } })
  if (query.isLoading) return <section className="admin-view-panel"><h2>Loading {kind}...</h2></section>
  if (query.isError) return <section className="admin-view-panel"><h2>{kind} are unavailable.</h2><button className="button button-primary" onClick={() => query.refetch()}>Retry</button></section>
  const rows = query.data ?? []
  const statuses = kind === 'subscriptions' ? ['active', 'paused', 'cancelled'] : kind === 'contracts' ? ['requested', 'under_review', 'approved', 'rejected', 'active'] : ['new', 'in_progress', 'resolved', 'closed']
  return <section className="admin-view-panel"><div className="view-panel-heading"><div><p className="eyebrow">{kind.toUpperCase()}</p><h2>Live {kind} administration.</h2></div><button className="button button-quiet" onClick={() => { void query.refetch(); onNotice('Records refreshed.') }}><RefreshCw size={14} /> Refresh</button></div><div className="admin-entity-list">{rows.map((row) => { const id = String(row.id); return <article key={id}><span className="admin-record-icon"><FileText size={18} /></span><div className="admin-entity-copy"><b>{String(row.name ?? row.subject ?? row.property_type ?? row.plan_id ?? row.id)}</b><p>{String(row.address ?? row.message ?? row.customer_id ?? row.created_at)}</p></div><span className="status-tag">{String(row.status)}</span><select defaultValue={String(row.status)} onChange={(event) => { setSavingId(id); update.mutate({ id, status: event.target.value }, { onSettled: () => setSavingId(null) }) }} disabled={savingId === id}>{statuses.map((status) => <option key={status} value={status}>{status}</option>)}</select></article> })}{!rows.length && <div className="admin-empty-state">No {kind} records found.</div>}</div></section>
}
