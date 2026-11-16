export type NormalizedNotification = { id: string; title: string; detail: string; unread: boolean }
export type NormalizedInvoiceLine = { description: string; quantity: number; subtotalPaise: number; taxPaise: number; taxRate: number; discountPaise: number; totalPaise: number }
export type NormalizedInvoice = {
  number: string
  date: string
  customer: string
  service: string
  location: string
  amount: number
  status: string
  lineItems: NormalizedInvoiceLine[]
  subtotalPaise: number
  taxPaise: number
  discountPaise: number
}

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
  const rawLines = value.line_items ?? value.lineItems
  const lineItems = Array.isArray(rawLines) ? rawLines.map((item) => {
    const line = item as Record<string, unknown>
    return {
      description: String(line.description ?? line.serviceCode ?? line.service_code ?? 'Service'),
      quantity: Number(line.quantity ?? 1),
      subtotalPaise: Number(line.subtotalPaise ?? line.subtotal_paise ?? 0),
      taxPaise: Number(line.taxPaise ?? line.tax_paise ?? 0),
      taxRate: Number(line.taxRate ?? line.tax_rate ?? 0),
      discountPaise: Number(line.discountPaise ?? line.discount_paise ?? 0),
      totalPaise: Number(line.totalPaise ?? line.total_paise ?? 0),
    }
  }) : []
  const totalPaise = Number(value.total_paise ?? value.totalPaise)
  return {
    number: String(value.number ?? value.invoice_number ?? value.id ?? 'Invoice'),
    date: String(value.date ?? value.issued_at ?? value.created_at ?? '').slice(0, 10),
    customer: String(value.customer ?? 'Urban Tanker customer'),
    service: String(value.service ?? value.service_code ?? 'Urban Tanker service'),
    location: String(value.location ?? value.address_text ?? '-'),
    amount: Number.isFinite(totalPaise) ? totalPaise / 100 : Number(value.amount ?? value.total_amount ?? 0),
    status: String(value.payment_status ?? value.status ?? 'Pending'),
    lineItems,
    subtotalPaise: Number(value.subtotal_paise ?? value.subtotalPaise ?? 0),
    taxPaise: Number(value.tax_paise ?? value.taxPaise ?? 0),
    discountPaise: Number(value.discount_paise ?? value.discountPaise ?? 0),
  }
}

export function isTrackingStale(timestamp: string | undefined, now = Date.now(), maxAgeMs = 120000) {
  return Boolean(timestamp && now - new Date(timestamp).getTime() > maxAgeMs)
}
