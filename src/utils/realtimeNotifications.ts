import type { WorkspaceRole } from '../stores/navigationStore'
import type { RealtimeMessage } from '../services/realtime'
import { realtimeContent } from '../content/realtime'

export type RealtimeNotice = {
  // Identifies the business fact. Events describing the same fact share a key so the user sees one notice.
  key: string
  message: string
  tone: 'success' | 'info'
  newOrder: boolean
}

const customerStatusMessages: Partial<Record<string, string>> = {
  accepted: realtimeContent.customer.accepted,
  dispatched: realtimeContent.customer.dispatched,
  en_route: realtimeContent.customer.en_route,
  arrived: realtimeContent.customer.arrived,
  delivered: realtimeContent.customer.delivered,
  cancelled: realtimeContent.customer.cancelled,
}

function readPayload(payload: unknown): Record<string, unknown> | null {
  return typeof payload === 'object' && payload !== null ? (payload as Record<string, unknown>) : null
}

function bookingNotice(bookingId: string, stage: string, message: string, tone: RealtimeNotice['tone'] = 'info'): RealtimeNotice {
  return { key: `booking:${bookingId}:${stage}`, message, tone, newOrder: false }
}

function customerNotice(type: string, bookingId: string, payload: Record<string, unknown>): RealtimeNotice | null {
  if (type === 'booking.vendor_accepted') return bookingNotice(bookingId, 'accepted', realtimeContent.customer.accepted)
  if (type === 'booking.delivered') return bookingNotice(bookingId, 'delivered', realtimeContent.customer.delivered, 'success')
  if (type !== 'booking.updated' || typeof payload.status !== 'string') return null
  const status = payload.status.toLowerCase()
  const message = customerStatusMessages[status]
  if (!message) return null
  return bookingNotice(bookingId, status, message, status === 'delivered' ? 'success' : 'info')
}

function vendorNotice(type: string, bookingId: string, reference: string, payload: Record<string, unknown>): RealtimeNotice | null {
  if (type === 'vendor.order.created') {
    return { key: `offer:${bookingId}`, message: realtimeContent.vendor.newOrder(reference), tone: 'info', newOrder: true }
  }
  if (type === 'vendor.order.taken') {
    const message = typeof payload.message === 'string' && payload.message ? payload.message : realtimeContent.vendor.taken(reference)
    return { key: `taken:${bookingId}`, message, tone: 'info', newOrder: false }
  }
  if (type === 'vendor.order.declined') {
    return { key: `declined:${bookingId}`, message: realtimeContent.vendor.declined(reference), tone: 'info', newOrder: false }
  }
  return null
}

// Returns the ids of notifications that are still unread and were created after [since] (epoch ms).
export function unreadNotificationIdsSince(rows: { id: string; created_at: string; read_at?: string | null }[], since: number): string[] {
  return rows.filter((row) => !row.read_at && Date.parse(row.created_at) > since).map((row) => row.id)
}

// Returns the notice [role] should see for an event, or null when the event is not relevant to that role.
export function getRealtimeNotice(role: WorkspaceRole | null, message: RealtimeMessage): RealtimeNotice | null {
  const payload = readPayload(message.payload)
  if (!payload || typeof payload.bookingId !== 'string' || !payload.bookingId) return null
  const bookingId = payload.bookingId
  const reference = typeof payload.reference === 'string' && payload.reference ? payload.reference : bookingId
  if (role === 'customer') return customerNotice(message.type, bookingId, payload)
  if (role === 'vendor') return vendorNotice(message.type, bookingId, reference, payload)
  return null
}
