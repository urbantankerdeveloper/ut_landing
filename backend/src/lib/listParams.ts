import type { Response } from 'express'

// Two list modes, so existing clients keep working:
// - legacy: no page or pageSize. The response stays a bare array. `limit` (1-100) caps it when sent. Without it, rows are capped at LEGACY_ROW_CEILING and X-Truncated says so.
// - paged: page or pageSize sent. The response is { rows, total, page, pageSize }, the shape /admin/orders already uses.
export const DEFAULT_PAGE_SIZE = 50
export const MAX_PAGE_SIZE = 100
export const LEGACY_ROW_CEILING = 1000

export type ListWindow =
  | { mode: 'legacy'; limit: number; from: number; to: number }
  | { mode: 'paged'; page: number; pageSize: number; from: number; to: number }

function positiveInteger(value: unknown) {
  const number = typeof value === 'string' ? Number(value) : NaN
  return Number.isInteger(number) && number > 0 ? number : null
}

export function listWindow(query: Record<string, unknown>): ListWindow {
  if (query.page === undefined && query.pageSize === undefined) {
    const requested = positiveInteger(query.limit)
    const limit = requested ? Math.min(requested, MAX_PAGE_SIZE) : LEGACY_ROW_CEILING
    // One extra row is fetched so truncation is known without a count query.
    return { mode: 'legacy', limit, from: 0, to: limit }
  }
  const page = positiveInteger(query.page) ?? 1
  const pageSize = Math.min(positiveInteger(query.pageSize) ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE)
  const from = (page - 1) * pageSize
  return { mode: 'paged', page, pageSize, from, to: from + pageSize - 1 }
}

// `fetched` is what the query returned. For a legacy window it may hold one extra row, which marks truncation.
// `total` is only needed in paged mode (fetch with count: 'exact').
export function sendList<T>(response: Response, window: ListWindow, fetched: T[], total?: number | null) {
  if (window.mode === 'paged') {
    return response.json({ rows: fetched.slice(0, window.pageSize), total: total ?? 0, page: window.page, pageSize: window.pageSize })
  }
  const rows = fetched.slice(0, window.limit)
  response.setHeader('X-Truncated', String(fetched.length > window.limit))
  if (total !== undefined && total !== null) response.setHeader('X-Total-Count', String(total))
  return response.json(rows)
}
