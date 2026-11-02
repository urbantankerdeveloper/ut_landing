import { useMemo, useState } from 'react'
import { Bell, Check, CheckCheck, ChevronDown } from 'lucide-react'
import type { AdminNotification } from '../api/admin'
import { useAdminNotifications, useMarkAdminNotificationRead } from '../hooks/useAdminData'
import { adminEntitiesContent as c } from '../content/admin-entities'

const copy = c.notifications

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
  const [pendingGroupKeys, setPendingGroupKeys] = useState<Set<string>>(() => new Set())
  const [markingAll, setMarkingAll] = useState(false)
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
    setPendingGroupKeys((current) => new Set(current).add(group.key))
    try {
      const results = await Promise.allSettled(unread.map((item) => markRead.mutateAsync(item.id)))
      if (results.some((result) => result.status === 'rejected')) onNotice?.(copy.someFailed)
    } finally {
      setPendingGroupKeys((current) => { const next = new Set(current); next.delete(group.key); return next })
    }
  }

  async function markAllRead() {
    setMarkingAll(true)
    try {
      const results = await Promise.allSettled(unreadNotifications.map((item) => markRead.mutateAsync(item.id)))
      if (results.some((result) => result.status === 'rejected')) onNotice?.(copy.someFailed)
    } finally {
      setMarkingAll(false)
    }
  }

  if (query.isLoading) return <section className="admin-view-panel"><h2>{copy.loading}</h2></section>
  if (query.isError) return <section className="admin-view-panel"><h2>{copy.unavailable}</h2><button className="button button-primary" onClick={() => query.refetch()}>{copy.retry}</button></section>

  return <section className="admin-view-panel admin-notifications-panel">
    <div className="view-panel-heading">
      <div><p className="eyebrow">{copy.eyebrow}</p><h2>{copy.title}</h2></div>
      <button className="button button-quiet" onClick={() => void markAllRead()} disabled={!unreadNotifications.length || markingAll}>{copy.markAllRead}</button>
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
                <span>{copy.summary(group.notifications.length, latest.title)}</span>
                <small>{new Date(latest.created_at).toLocaleString()}</small>
              </span>
              {unreadCount > 0 && <span className="admin-notification-unread-count">{copy.unreadCount(unreadCount)}</span>}
              <ChevronDown className="admin-notification-chevron" size={17} aria-hidden="true" />
            </button>
            <button className="admin-notification-mark-read" type="button" onClick={() => void markGroupRead(group)} disabled={!unreadCount || pendingGroupKeys.has(group.key) || markingAll} aria-label={copy.markGroupRead(group.label)}>
              {unreadCount ? <><CheckCheck size={15} /> {copy.markRead}</> : <Check size={16} aria-label={copy.allRead} />}
            </button>
          </div>
          {isExpanded && <div className="admin-notification-events">
            {group.notifications.map((item) => <article className={!item.read_at ? 'is-unread' : ''} key={item.id}>
              <span className="admin-notification-event-indicator" />
              <div>
                <strong>{item.title}</strong>
                <p>{item.event_type}{item.payload?.status ? copy.statusPart(item.payload.status) : ''}{item.payload?.detail ? copy.detailPart(item.payload.detail) : ''}</p>
                <small>{new Date(item.created_at).toLocaleString()}</small>
              </div>
              {!item.read_at && <span className="admin-notification-unread-label">{copy.unread}</span>}
            </article>)}
          </div>}
        </section>
      })}
    </div>
    {!notifications.length && <div className="admin-empty-state">{copy.empty}</div>}
  </section>
}
