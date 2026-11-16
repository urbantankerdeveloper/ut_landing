import { beforeEach, describe, expect, it, vi } from 'vitest'
import { config } from '../config.js'

const state = vi.hoisted(() => ({
  results: new Map<string, unknown[]>(),
  calls: [] as Array<{ table: string; method: string; args: unknown[] }>,
}))

function nextResult(table: string) {
  const queue = state.results.get(table)
  return queue && queue.length > 0 ? queue.shift() : { data: null, error: null }
}

function queryBuilder(table: string) {
  const result = nextResult(table)
  const builder: Record<string, unknown> = {}
  for (const method of ['select', 'eq', 'in', 'order', 'limit', 'update', 'upsert']) {
    builder[method] = (...args: unknown[]) => {
      state.calls.push({ table, method, args })
      return builder
    }
  }
  builder.maybeSingle = () => Promise.resolve(result)
  builder.single = () => Promise.resolve(result)
  builder.then = (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) => Promise.resolve(result).then(resolve, reject)
  return builder
}

vi.mock('../supabase.js', () => ({
  supabase: { from: (table: string) => queryBuilder(table) },
}))
vi.mock('../lib/logger.js', () => ({ logger: { warn: vi.fn(), error: vi.fn() } }))

import { createInvoiceIfEligible, generateMissingCustomerInvoices } from './invoices.js'

const bookingId = '11111111-1111-4111-8111-111111111111'
const line = {
  serviceCode: 'water_tanker',
  description: 'Water tanker · 5000 litres',
  quantity: 1,
  subtotalPaise: 250000,
  taxPaise: 45000,
  taxRate: 0.18,
  discountPaise: 10000,
  totalPaise: 285000,
}
const booking = {
  id: bookingId,
  reference: 'UT-100001',
  customer_id: 'customer-1',
  status: 'delivered',
  payment_method: 'cod',
  quoted_amount_paise: 285000,
  service_details: [{ invoice_line: line }],
  address_text: 'Chennai',
  order_group_id: null,
  updated_at: '2026-10-14T10:00:00.000Z',
}

function setResults(table: string, ...results: unknown[]) {
  state.results.set(table, [...(state.results.get(table) ?? []), ...results])
}

function upsertPayload() {
  return state.calls.find((call) => call.table === 'invoices' && call.method === 'upsert')?.args[0] as Record<string, unknown> | undefined
}

beforeEach(() => {
  state.results.clear()
  state.calls.length = 0
  config.featureFlags.invoice_generation_enabled = true
})

describe('invoice generation', () => {
  it('waits for delivery and payment before issuing an itemized COD invoice', async () => {
    setResults('bookings', { data: { ...booking, status: 'arrived' }, error: null })
    await expect(createInvoiceIfEligible(bookingId)).resolves.toBe(false)
    expect(state.calls.some((call) => call.table === 'invoices')).toBe(false)

    state.results.clear()
    state.calls.length = 0
    setResults('bookings', { data: booking, error: null })
    setResults('payments', { data: null, error: null })
    setResults('invoices', { data: { id: 'invoice-1' }, error: null })
    await expect(createInvoiceIfEligible(bookingId)).resolves.toBe(true)
    expect(state.calls.find((call) => call.table === 'payments' && call.method === 'update')?.args[0]).toMatchObject({
      status: 'paid',
      captured_at: booking.updated_at,
    })
    expect(upsertPayload()).toMatchObject({
      number: 'INV-UT-100001',
      amount: 2850,
      line_items: [line],
      subtotal_paise: 250000,
      tax_paise: 45000,
      discount_paise: 10000,
      total_paise: 285000,
      payment_status: 'paid',
    })
  })

  it('requires a captured gateway payment for the complete multi-task order', async () => {
    setResults('bookings',
      { data: { ...booking, payment_method: 'gateway', order_group_id: 'group-1' }, error: null },
      { data: [
        { id: bookingId, created_at: '2026-10-14T09:00:00Z', quoted_amount_paise: 285000 },
        { id: 'task-2', created_at: '2026-10-14T09:00:01Z', quoted_amount_paise: 150000 },
      ], error: null },
    )
    setResults('payments', { data: { status: 'paid', amount_paise: 435000, refunded_paise: 0, captured_at: booking.updated_at }, error: null })
    setResults('invoices', { data: { id: 'invoice-1' }, error: null })
    await expect(createInvoiceIfEligible(bookingId)).resolves.toBe(true)
    expect(upsertPayload()).toMatchObject({ booking_id: bookingId, total_paise: 285000, payment_status: 'paid' })
  })

  it('does not issue a gateway invoice while payment is pending', async () => {
    setResults('bookings', { data: { ...booking, payment_method: 'gateway' }, error: null })
    setResults('payments', { data: { status: 'pending', amount_paise: 285000, refunded_paise: 0 }, error: null })
    await expect(createInvoiceIfEligible(bookingId)).resolves.toBe(false)
    expect(state.calls.some((call) => call.table === 'invoices')).toBe(false)
  })

  it('records a fully refunded capture as a refunded invoice after delivery', async () => {
    setResults('bookings', { data: { ...booking, payment_method: 'gateway' }, error: null })
    setResults('payments', { data: { status: 'refunded', amount_paise: 285000, refunded_paise: 285000, captured_at: booking.updated_at }, error: null })
    setResults('invoices', { data: { id: 'invoice-1' }, error: null })
    await expect(createInvoiceIfEligible(bookingId)).resolves.toBe(true)
    expect(upsertPayload()).toMatchObject({ status: 'refunded', payment_status: 'refunded' })
  })

  it('repairs a missed delivery trigger when the customer opens invoice history', async () => {
    setResults('bookings',
      { data: [{ id: bookingId }], error: null },
      { data: booking, error: null },
    )
    setResults('invoices',
      { data: [], error: null },
      { data: { id: 'invoice-1' }, error: null },
    )
    await expect(generateMissingCustomerInvoices('customer-1')).resolves.toBeUndefined()
    expect(upsertPayload()).toMatchObject({ booking_id: bookingId, total_paise: 285000 })
  })
})
