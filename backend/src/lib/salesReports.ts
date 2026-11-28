export type SalesPeriod = 'day' | 'week' | 'month'

export type SalesOrder = {
  id?: string
  legacyBookingId?: string | null
  service_code: string
  quoted_amount_paise: number | null
  created_at: string
}

export type SalesFulfilment = {
  id: string
  legacy_booking_id?: string | null
  created_at: string
  orders?: { customer_id?: string | null } | Array<{ customer_id?: string | null }> | null
  order_fulfilment_items?: Array<{ order_items?: unknown | unknown[] }>
}

const INDIA_OFFSET_MS = 330 * 60_000
const DAY_MS = 24 * 60 * 60_000

function indiaDateParts(date: Date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((item) => item.type === type)?.value)
  return { year: part('year'), month: part('month'), day: part('day') }
}

function dayKey(date: Date) {
  const { year, month, day } = indiaDateParts(date)
  return `${year.toString().padStart(4, '0')}-${month
    .toString()
    .padStart(2, '0')}-${day.toString().padStart(2, '0')}`
}

export function salesPeriodWindows(period: SalesPeriod, now = new Date()) {
  const days = period === 'day' ? 1 : period === 'week' ? 7 : 30
  const today = indiaDateParts(now)
  const indiaMidnightUtc =
    Date.UTC(today.year, today.month - 1, today.day) - INDIA_OFFSET_MS
  const currentStart = indiaMidnightUtc - (days - 1) * DAY_MS
  const currentEnd = indiaMidnightUtc + DAY_MS
  const previousStart = currentStart - days * DAY_MS
  const previousEnd = currentStart
  const dateAt = (value: number) => new Date(value).toISOString()

  return {
    days,
    current: { from: dateAt(currentStart), to: dateAt(currentEnd) },
    previous: { from: dateAt(previousStart), to: dateAt(previousEnd) },
    currentFromDate: dayKey(new Date(currentStart + INDIA_OFFSET_MS)),
    currentToDate: dayKey(new Date(currentEnd - DAY_MS + INDIA_OFFSET_MS)),
    previousFromDate: dayKey(new Date(previousStart + INDIA_OFFSET_MS)),
    previousToDate: dayKey(new Date(previousEnd - DAY_MS + INDIA_OFFSET_MS)),
  }
}

export function summarizeSales(rows: SalesOrder[], fromDate: string, days: number) {
  const totals = Array.from({ length: days }, () => 0)
  const byService = new Map<string, { orders: number; amountPaise: number }>()
  const orderIds = new Set<string>()
  let totalPaise = 0

  for (const [rowIndex, row] of rows.entries()) {
    const amount = Number(row.quoted_amount_paise ?? 0)
    if (!Number.isSafeInteger(amount) || amount < 0) {
      throw new Error('Booking quote amount is invalid.')
    }

    totalPaise += amount
    if (!Number.isSafeInteger(totalPaise)) {
      throw new Error('Sales report total exceeds the supported range.')
    }
    orderIds.add(row.id ?? `row-${rowIndex}`)

    const bucketIndex = Math.floor(
      (Date.parse(`${dayKey(new Date(row.created_at))}T00:00:00.000Z`) -
        Date.parse(`${fromDate}T00:00:00.000Z`)) /
        DAY_MS,
    )
    if (bucketIndex >= 0 && bucketIndex < days) {
      totals[bucketIndex] = (totals[bucketIndex] ?? 0) + amount
    }

    const service = byService.get(row.service_code) ?? {
      orders: 0,
      amountPaise: 0,
    }
    service.orders += 1
    service.amountPaise += amount
    byService.set(row.service_code, service)
  }

  return {
    totalPaise,
    orderCount: orderIds.size,
    dailyTotalsPaise: totals,
    breakdown: [...byService.entries()]
      .map(([serviceCode, value]) => ({
        serviceCode,
        orders: value.orders,
        amountPaise: value.amountPaise,
      }))
      .sort((first, second) => second.amountPaise - first.amountPaise),
  }
}

export function salesRowsFromFulfilments(
  fulfilments: SalesFulfilment[],
  legacyBookingIds: ReadonlySet<string> = new Set(),
): SalesOrder[] {
  const rows: SalesOrder[] = []
  for (const fulfilment of fulfilments) {
    if (
      fulfilment.legacy_booking_id &&
      legacyBookingIds.has(fulfilment.legacy_booking_id)
    ) {
      continue
    }

    const amountsByService = new Map<string, number>()
    for (const link of fulfilment.order_fulfilment_items ?? []) {
      const items = Array.isArray(link.order_items)
        ? link.order_items
        : [link.order_items]
      for (const value of items) {
        if (!value || typeof value !== 'object') continue
        const item = value as {
          locked_price_paise?: number | null
          delivery_charge_paise?: number | null
          discount_paise?: number | null
          service_types?: { code?: string } | Array<{ code?: string }> | null
        }
        const serviceType = Array.isArray(item.service_types)
          ? item.service_types[0]
          : item.service_types
        const serviceCode = serviceType?.code
        if (!serviceCode) {
          throw new Error('Multi-service report item has no service code.')
        }
        const amount =
          Number(item.locked_price_paise ?? 0) +
          Number(item.delivery_charge_paise ?? 0) -
          Number(item.discount_paise ?? 0)
        if (!Number.isSafeInteger(amount) || amount < 0) {
          throw new Error('Multi-service quote amount is invalid.')
        }
        amountsByService.set(
          serviceCode,
          (amountsByService.get(serviceCode) ?? 0) + amount,
        )
      }
    }

    for (const [serviceCode, amount] of amountsByService) {
      rows.push({
        id: fulfilment.id,
        legacyBookingId: fulfilment.legacy_booking_id,
        service_code: serviceCode,
        quoted_amount_paise: amount,
        created_at: fulfilment.created_at,
      })
    }
  }
  return rows
}
