export type NormalizedNotification = { id: string; title: string; detail: string; unread: boolean }
export type NormalizedInvoice = { number: string; date: string; customer: string; service: string; location: string; amount: number; status: string }

export function normalizeNotification(item: unknown): NormalizedNotification {
  const value = item as Record<string, unknown>
  const payload = (value.payload ?? {}) as Record<string, unknown>
  return {
    id: String(value.id ?? 'notification'),
    title: String(value.title ?? value.event_type ?? 'Booking update'),
    detail: String(value.detail ?? payload.detail ?? payload.message ?? 'Your account has a new update.'),
    unread: !value.read_at,
  }
}

export function normalizeInvoice(item: unknown): NormalizedInvoice {
  const value = item as Record<string, unknown>
  return {
    number: String(value.number ?? value.invoice_number ?? value.id ?? 'Invoice'),
    date: String(value.date ?? value.issued_at ?? value.created_at ?? '').slice(0, 10),
    customer: String(value.customer ?? 'Urban Tanker customer'),
    service: String(value.service ?? value.service_code ?? 'Urban Tanker service'),
    location: String(value.location ?? value.address_text ?? '-'),
    amount: Number(value.amount ?? value.total_amount ?? 0),
    status: String(value.status ?? 'Pending'),
  }
}

export function isTrackingStale(timestamp: string | undefined, now = Date.now(), maxAgeMs = 120000) {
  return Boolean(timestamp && now - new Date(timestamp).getTime() > maxAgeMs)
}
