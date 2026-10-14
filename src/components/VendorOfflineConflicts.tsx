import { useEffect, useState } from 'react'
import { AlertTriangle, RefreshCw, Trash2 } from 'lucide-react'
import { vendorApi } from '../api/vendor'
import { discardQueuedMutation, queuedMutations, retryQueuedMutation, type QueuedMutation } from '../services/offlineMutationQueue'

export function VendorOfflineConflicts() {
  const [items, setItems] = useState<QueuedMutation[]>(() => queuedMutations().filter((item) => item.conflictStatus === 'conflict'))
  const [remoteItems, setRemoteItems] = useState<{ id: string; client_version: number; last_error?: string }[]>([])
  async function refresh() {
    const localItems = queuedMutations().filter((item) => item.conflictStatus === 'conflict')
    if (navigator.onLine) {
      try {
        const remote = await vendorApi.offlineMutations()
        const localServerIds = new Set(localItems.map((item) => item.serverMutationId).filter(Boolean))
        setRemoteItems(remote.filter((item) => item.conflict_status === 'conflict' && !localServerIds.has(item.id)))
      } catch {
        setRemoteItems([])
      }
    }
  }
  useEffect(() => { const handleOnline = () => { const localServerIds = new Set(queuedMutations().filter((item) => item.conflictStatus === 'conflict').map((item) => item.serverMutationId).filter(Boolean)); void vendorApi.offlineMutations().then((remote) => setRemoteItems(remote.filter((item) => item.conflict_status === 'conflict' && !localServerIds.has(item.id)))).catch(() => setRemoteItems([])) }; window.addEventListener('online', handleOnline); return () => window.removeEventListener('online', handleOnline) }, [])
  if (!items.length && !remoteItems.length) return null
  return <section className="workspace-view-panel vendor-offline-conflicts"><div className="view-panel-heading"><div><p className="eyebrow">OFFLINE CONFLICTS</p><h2>Review queued changes.</h2></div></div>{items.map((item) => <article key={item.id}><AlertTriangle size={17} /><div><b>{item.endpoint}</b><p>Client version {item.clientVersion} could not sync.</p></div><button className="button button-quiet" onClick={() => { retryQueuedMutation(item.id); setItems(queuedMutations().filter((queued) => queued.conflictStatus === 'conflict')); void (item.serverMutationId ? vendorApi.retryOfflineMutation(item.serverMutationId) : Promise.resolve()).then(refresh) }}><RefreshCw size={14} /> Retry</button><button className="icon-action danger" aria-label="Discard queued change" onClick={() => { discardQueuedMutation(item.id); setItems(queuedMutations().filter((queued) => queued.conflictStatus === 'conflict')); void (item.serverMutationId ? vendorApi.discardOfflineMutation(item.serverMutationId) : Promise.resolve()).then(refresh) }}><Trash2 size={14} /></button></article>)}{remoteItems.map((item) => <article key={item.id}><AlertTriangle size={17} /><div><b>Server mutation {item.id.slice(0, 8)}</b><p>Client version {item.client_version} could not sync.{item.last_error ? ` ${item.last_error}` : ''}</p></div><button className="button button-quiet" onClick={() => { void vendorApi.retryOfflineMutation(item.id).then(refresh) }}><RefreshCw size={14} /> Retry</button><button className="icon-action danger" aria-label="Discard server mutation" onClick={() => { void vendorApi.discardOfflineMutation(item.id).then(refresh) }}><Trash2 size={14} /></button></article>)}</section>
}