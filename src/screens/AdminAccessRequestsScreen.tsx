import { useState, type ReactNode } from 'react'
import { CheckCircle2, RotateCw, XCircle } from 'lucide-react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { adminAccessApi, type AdminUserRecord } from '../api/adminAccess'
import { useFeatureFlags } from '../hooks/useFeatureFlags'
import { describeError } from '../utils/notify'

const queryKey = ['admin', 'admin-users']

export function AdminAccessRequestsScreen({ onNotice }: { onNotice: (message: string) => void }) {
  const queryClient = useQueryClient()
  const users = useQuery({ queryKey, queryFn: adminAccessApi.admins, retry: false })
  const featureFlags = useFeatureFlags()
  const [busyId, setBusyId] = useState<string | null>(null)
  const approvalEnabled = featureFlags.data?.admin_approval_required_enabled === true
  const pending = users.data?.filter((item) => item.status === 'pending') ?? []
  const approved = users.data?.filter((item) => item.kind === 'admin' && item.status === 'approved') ?? []
  const rejected = users.data?.filter((item) => item.status === 'rejected') ?? []

  async function review(item: AdminUserRecord, decision: 'approved' | 'rejected') {
    const action = decision === 'approved' ? 'Approve' : 'Reject'
    if (!window.confirm(`${action} admin access for ${item.name}?`)) return
    setBusyId(item.id)
    try {
      await adminAccessApi.review(item.id, decision)
      await queryClient.invalidateQueries({ queryKey })
      onNotice(decision === 'approved'
        ? `Admin access approved for ${item.name}.`
        : `Request rejected for ${item.name}.`)
    } catch (error) {
      onNotice(describeError(error))
    } finally {
      setBusyId(null)
    }
  }

  async function setActive(item: AdminUserRecord) {
    const isActive = item.is_active !== true
    const action = isActive ? 'Reactivate' : 'Deactivate'
    if (!window.confirm(`${action} admin access for ${item.name}?`)) return
    setBusyId(item.id)
    try {
      await adminAccessApi.setActive(item.id, isActive)
      await queryClient.invalidateQueries({ queryKey })
      onNotice(`Admin access ${isActive ? 'reactivated' : 'deactivated'} for ${item.name}.`)
    } catch (error) {
      onNotice(describeError(error))
    } finally {
      setBusyId(null)
    }
  }

  function section(title: string, records: AdminUserRecord[], empty: string, renderActions: (item: AdminUserRecord) => ReactNode) {
    return <section className="admin-access-section">
      <h3>{title}</h3>
      {records.length ? <div className="admin-table-wrap">
        <table className="admin-table">
          <thead><tr>
            <th scope="col">Name</th>
            <th scope="col">Email</th>
            <th scope="col">Phone</th>
            <th scope="col">Status</th>
            <th scope="col">Requested</th>
            <th scope="col">Reason</th>
            <th scope="col"><span className="visually-hidden">Actions</span></th>
          </tr></thead>
          <tbody>{records.map((item) => <tr key={`${item.kind}-${item.id}`}>
            <td><b>{item.name}</b></td>
            <td>{item.email}</td>
            <td>{item.phone_e164 || '—'}</td>
            <td>{item.status}{item.kind === 'admin' ? ` · ${item.is_active ? 'Active' : 'Deactivated'}` : ''}</td>
            <td>{item.requested_at ? new Date(item.requested_at).toLocaleString() : '—'}</td>
            <td>{item.reason || '—'}</td>
            <td>{renderActions(item)}</td>
          </tr>)}</tbody>
        </table>
      </div> : <p className="admin-empty-state">{empty}</p>}
    </section>
  }

  return <section className="admin-view-panel">
    <div className="admin-panel-heading">
      <div><p className="eyebrow">ACCESS CONTROL</p><h2>Admin Users</h2></div>
      <button className="button button-quiet" type="button" onClick={() => void users.refetch()} disabled={users.isFetching}><RotateCw size={15} /> Refresh</button>
    </div>
    {users.isLoading ? <p role="status">Loading admin users…</p>
      : users.isError ? <div role="alert"><p>{describeError(users.error)}</p><button className="button button-primary" type="button" onClick={() => void users.refetch()}>Try again</button></div>
        : <>
          {section('Pending', pending, 'There are no pending admin requests.', (item) => item.kind === 'request' && approvalEnabled ? <>
            <button className="text-button" type="button" disabled={busyId !== null} onClick={() => void review(item, 'approved')}><CheckCircle2 size={14} /> Approve</button>{' '}
            <button className="text-button" type="button" disabled={busyId !== null} onClick={() => void review(item, 'rejected')}><XCircle size={14} /> Reject</button>
          </> : item.kind === 'request' ? <span>{featureFlags.isError ? 'Approval settings could not be loaded.' : 'Approval is disabled.'}</span> : null)}
          {section('Approved', approved, 'There are no approved admin accounts.', (item) =>
            <button className="text-button" type="button" disabled={busyId !== null} onClick={() => void setActive(item)}>
              {item.is_active ? 'Deactivate' : 'Reactivate'}
            </button>,
          )}
          {section('Rejected', rejected, 'There are no rejected admin requests.', () => null)}
          {featureFlags.isError
            ? <p className="auth-intro" role="alert">Approval settings could not be loaded. Existing approved accounts can still be deactivated or reactivated.</p>
            : featureFlags.isSuccess && !approvalEnabled
              ? <p className="auth-intro">Admin approval is off. Existing approved accounts can still be deactivated or reactivated.</p>
              : null}
        </>}
  </section>
}
