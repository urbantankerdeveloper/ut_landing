import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { FileText, RefreshCw } from 'lucide-react'
import { adminApi, type AdminEnquiryHistoryRecord, type AdminProgramRecord } from '../api/admin'
import { useAdminContracts, useAdminEnquiries, useAdminSubscriptions } from '../hooks/useAdminData'
import { adminOperationsContent as c } from '../content/admin-operations'

type Props = { kind: 'subscriptions' | 'contracts' | 'enquiries'; onNotice: (message: string) => void }

function EnquiryHistory({ id }: { id: string }) {
  const history = useQuery({
    queryKey: ['admin', 'enquiries', id, 'history'],
    queryFn: () => adminApi.enquiryHistory(id),
  })

  if (history.isLoading) return <p role="status">Loading enquiry history…</p>
  if (history.isError) {
    return (
      <div role="alert">
        <p>Enquiry history could not be loaded.</p>
        <button className="button button-quiet" onClick={() => history.refetch()}>Retry</button>
      </div>
    )
  }
  if (!history.data?.length) return <p>No history recorded.</p>

  return (
    <ol className="admin-enquiry-history-list">
      {history.data.map((event: AdminEnquiryHistoryRecord) => (
        <li key={event.id}>
          <strong>{event.action === 'submitted' ? 'Submitted' : 'Updated'}</strong>
          {event.new_status && (
            <span>
              {event.old_status ? `${event.old_status} → ` : ''}{event.new_status}
            </span>
          )}
          {event.response && <p>{event.response}</p>}
          <time dateTime={event.created_at}>{new Date(event.created_at).toLocaleString()}</time>
        </li>
      ))}
    </ol>
  )
}

function EnquiryHistoryDisclosure({ id }: { id: string }) {
  const [open, setOpen] = useState(false)
  return (
    <details
      className="admin-enquiry-history"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>Enquiry history</summary>
      {open && <EnquiryHistory id={id} />}
    </details>
  )
}

export function AdminProgramsScreen({ kind, onNotice }: Props) {
  const [savingId, setSavingId] = useState<string | null>(null)
  const queryClient = useQueryClient()
  const subscriptions = useAdminSubscriptions()
  const contracts = useAdminContracts()
  const enquiries = useAdminEnquiries()
  const query = kind === 'subscriptions' ? subscriptions : kind === 'contracts' ? contracts : enquiries
  const update = useMutation({ mutationFn: ({ id, status, response }: { id: string; status: string; response?: string }) => kind === 'subscriptions' ? adminApi.updateSubscription(id, status) : kind === 'contracts' ? adminApi.updateContract(id, status) : adminApi.updateEnquiry(id, status, response), onSuccess: () => { void query.refetch(); if (kind === 'enquiries') void queryClient.invalidateQueries({ queryKey: ['admin', 'enquiries'] }); onNotice(c.programs.notices.updated) } })
  if (query.isLoading) return <section className="admin-view-panel" role="status"><h2>{c.programs.loading(kind)}</h2></section>
  if (query.isError) return <section className="admin-view-panel" role="alert"><h2>{c.programs.unavailable(kind)}</h2><button className="button button-primary" onClick={() => query.refetch()}>{c.common.retry}</button></section>
  const rows = query.data ?? []
  const statuses = kind === 'subscriptions' ? ['active', 'paused', 'cancelled'] : kind === 'contracts' ? ['requested', 'under_review', 'approved', 'rejected', 'active'] : ['new', 'in_progress', 'resolved', 'closed']
  return (
    <section className="admin-view-panel">
      <div className="view-panel-heading">
        <div><p className="eyebrow">{kind.toUpperCase()}</p><h2>{c.programs.title(kind)}</h2></div>
        <button className="button button-quiet" onClick={() => { void query.refetch(); onNotice(c.programs.notices.refreshed) }}>
          <RefreshCw size={14} /> {c.common.refresh}
        </button>
      </div>
      <div className="admin-entity-list">
        {rows.map((row: AdminProgramRecord) => {
          const id = String(row.id)
          const label = String(row.name ?? row.subject ?? row.property_type ?? row.plan_id ?? row.id)
          return (
            <article key={id}>
              <span className="admin-record-icon"><FileText size={18} /></span>
              <div className="admin-entity-copy">
                <b>{label}</b>
                <p>{String(row.address ?? row.message ?? row.customer_id ?? row.created_at)}</p>
                {kind === 'enquiries' && <EnquiryHistoryDisclosure id={id} />}
              </div>
              <span className="status-tag">{String(row.status)}</span>
              <select
                aria-label={c.programs.statusFor(label)}
                defaultValue={String(row.status)}
                onChange={(event) => {
                  setSavingId(id)
                  update.mutate({ id, status: event.target.value }, { onSettled: () => setSavingId(null) })
                }}
                disabled={savingId === id}
              >
                {statuses.map((status) => <option key={status} value={status}>{status}</option>)}
              </select>
            </article>
          )
        })}
        {!rows.length && <div className="admin-empty-state">{c.programs.empty(kind)}</div>}
      </div>
    </section>
  )
}
