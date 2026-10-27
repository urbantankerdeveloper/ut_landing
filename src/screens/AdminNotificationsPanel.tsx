import { useMemo, useState } from 'react'
import { Bell, Check, CheckCheck, ChevronDown } from 'lucide-react'
import type { AdminNotification } from '../api/admin'
import { useAdminNotifications, useMarkAdminNotificationRead } from '../hooks/useAdminData'

type Props = { onNotice?: (message: string) => void }
type NotificationGroup = { key: string; label: string; notifications: AdminNotification[] }

function notificationGroupKey(notification: AdminNotification) {
  const reference = notification.payload?.reference?.trim()
  if (reference) return { key: `reference:${reference}`, label: reference }
  const bookingId = notification.payload?.bookingId?.trim()
  if (bookingId) return { key: `booking:${bookingId}`, label: bookingId }
  return { key: `notification:${notification.id}`, label: notification.title }
}

export function AdminNotificationsPanel({ onNotice }: Props) {
  const query = useAdminNotifications()
  const markRead = useMarkAdminNotificationRead()
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const notifications = useMemo(() => query.data ?? [], [query.data])
  const groups = useMemo(() => {
    const grouped = new Map<string, NotificationGroup>()
    for (const notification of notifications) {
      const { key, label } = notificationGroupKey(notification)
      const group = grouped.get(key) ?? { key, label, notifications: [] }
      group.notifications.push(notification)
      grouped.set(key, group)
    }
    return [...grouped.values()].map((group) => ({
      ...group,
      notifications: group.notifications.sort((first, second) => second.created_at.localeCompare(first.created_at)),
    }))
  }, [notifications])
  const unreadNotifications = notifications.filter((item) => !item.read_at)

  async function markGroupRead(group: NotificationGroup) {
    const unread = group.notifications.filter((item) => !item.read_at)
    if (!unread.length) return
    const results = await Promise.allSettled(unread.map((item) => markRead.mutateAsync(item.id)))
    if (results.some((result) => result.status === 'rejected')) onNotice?.('Some notifications could not be marked as read.')
  }

  async function markAllRead() {
    const results = await Promise.allSettled(unreadNotifications.map((item) => markRead.mutateAsync(item.id)))
    if (results.some((result) => result.status === 'rejected')) onNotice?.('Some notifications could not be marked as read.')
  }

  if (query.isLoading) return <section className="admin-view-panel"><h2>Loading notifications...</h2></section>
  if (query.isError) return <section className="admin-view-panel"><h2>Notifications are unavailable.</h2><button className="button button-primary" onClick={() => query.refetch()}>Retry</button></section>

  return <section className="admin-view-panel admin-notifications-panel">
    <div className="view-panel-heading">
      <div><p className="eyebrow">OPERATIONS NOTIFICATIONS</p><h2>All booking and delivery events.</h2></div>
      <button className="button button-quiet" onClick={() => void markAllRead()} disabled={!unreadNotifications.length || markRead.isPending}>Mark all read</button>
    </div>
    <div className="admin-notification-groups">
      {groups.map((group) => {
        const unreadCount = group.notifications.filter((item) => !item.read_at).length
        const isExpanded = expanded.has(group.key)
        const latest = group.notifications[0]
        return <section className={`admin-notification-group ${unreadCount ? 'is-unread' : ''}`} key={group.key}>
          <div className="admin-notification-group-header">
            <button className="admin-notification-toggle" type="button" aria-expanded={isExpanded} onClick={() => setExpanded((current) => {
              const next = new Set(current)
              if (next.has(group.key)) next.delete(group.key)
              else next.add(group.key)
              return next
            })}>
              <span className="admin-notification-icon"><Bell size={17} aria-hidden="true" /></span>
              <span className="admin-notification-group-summary">
                <strong>{group.label}</strong>
                <span>{group.notifications.length} notification{group.notifications.length === 1 ? '' : 's'} · Latest: {latest.title}</span>
                <small>{new Date(latest.created_at).toLocaleString()}</small>
              </span>
              {unreadCount > 0 && <span className="admin-notification-unread-count">{unreadCount} unread</span>}
              <ChevronDown className="admin-notification-chevron" size={17} aria-hidden="true" />
            </button>
            <button className="admin-notification-mark-read" type="button" onClick={() => void markGroupRead(group)} disabled={!unreadCount || markRead.isPending} aria-label={`Mark ${group.label} notifications as read`}>
              {unreadCount ? <><CheckCheck size={15} /> Mark read</> : <Check size={16} aria-label="All notifications read" />}
            </button>
          </div>
          {isExpanded && <div className="admin-notification-events">
            {group.notifications.map((item) => <article className={!item.read_at ? 'is-unread' : ''} key={item.id}>
              <span className="admin-notification-event-indicator" />
              <div>
                <strong>{item.title}</strong>
                <p>{item.event_type}{item.payload?.status ? ` · ${item.payload.status}` : ''}{item.payload?.detail ? ` · ${item.payload.detail}` : ''}</p>
                <small>{new Date(item.created_at).toLocaleString()}</small>
              </div>
              {!item.read_at && <span className="admin-notification-unread-label">Unread</span>}
            </article>)}
          </div>}
        </section>
      })}
    </div>
    {!notifications.length && <div className="admin-empty-state">No notifications yet.</div>}
  </section>
}
