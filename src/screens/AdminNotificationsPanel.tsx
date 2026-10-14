import { Bell, Check } from 'lucide-react'
import { useAdminNotifications, useMarkAdminNotificationRead } from '../hooks/useAdminData'

export function AdminNotificationsPanel() {
  const query = useAdminNotifications()
  const markRead = useMarkAdminNotificationRead()
  if (query.isLoading) return <section className="admin-view-panel"><h2>Loading notifications...</h2></section>
  if (query.isError) return <section className="admin-view-panel"><h2>Notifications are unavailable.</h2><button className="button button-primary" onClick={() => query.refetch()}>Retry</button></section>
  const notifications = query.data ?? []
  return <section className="admin-view-panel"><div className="view-panel-heading"><div><p className="eyebrow">OPERATIONS NOTIFICATIONS</p><h2>All booking and delivery events.</h2></div><button className="button button-quiet" onClick={() => notifications.filter((item) => !item.read_at).forEach((item) => markRead.mutate(item.id))}>Mark all read</button></div><div className="vendor-notification-list">{notifications.map((item) => <article className={!item.read_at ? 'is-unread' : ''} key={item.id}><span><Bell size={17} /></span><div><b>{item.title}</b><p>{item.payload?.reference ?? item.payload?.bookingId ?? item.event_type}{item.payload?.status ? ` · ${item.payload.status}` : ''}{item.payload?.detail ? ` · ${item.payload.detail}` : ''}</p><small>{new Date(item.created_at).toLocaleString()}</small></div>{item.read_at ? <Check size={16} /> : <button className="text-button" onClick={() => markRead.mutate(item.id)}>Mark read</button>}</article>)}</div>{!notifications.length && <div className="admin-empty-state">No notifications yet.</div>}</section>
}
