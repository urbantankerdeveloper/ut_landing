import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  results: new Map<string, unknown[]>(),
  updates: [] as Array<{ table: string; values: Record<string, unknown> }>,
  calls: [] as Array<{ table: string; method: string; args: unknown[] }>,
}))

function nextResult(table: string) {
  const queue = state.results.get(table)
  return queue && queue.length > 0 ? queue.shift() : { data: null, error: null }
}

function queryBuilder(table: string) {
  const result = nextResult(table)
  const builder: Record<string, unknown> = {}
  for (const method of ['select', 'eq', 'in', 'is', 'not', 'gte', 'lte', 'or', 'order', 'limit']) {
    builder[method] = (...args: unknown[]) => {
      state.calls.push({ table, method, args })
      return builder
    }
  }
  builder.update = (values: Record<string, unknown>) => {
    state.updates.push({ table, values })
    return builder
  }
  builder.maybeSingle = () => Promise.resolve(result)
  builder.then = (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) => Promise.resolve(result).then(resolve, reject)
  return builder
}

vi.mock('../supabase.js', () => ({
  supabase: { from: (table: string) => queryBuilder(table) },
}))
vi.mock('../lib/logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import { reconcilePayment, refundCapturedAfterCod, runPaymentReconciliationSweep } from './paymentReconciliation.js'

const ROW = { id: 'pay-1', booking_id: 'bk-1', provider_order_id: 'order_1', amount_paise: 50000 }

function setResults(table: string, ...results: unknown[]) {
  state.results.set(table, [...(state.results.get(table) ?? []), ...results])
}

function razorpayItems(items: unknown[]) {
  return new Response(JSON.stringify({ items }), { status: 200, headers: { 'content-type': 'application/json' } })
}

const CAPTURED = {
  id: 'pay_1',
  status: 'captured',
  amount: 50000,
  method: 'upi',
  vpa: 'user@okhdfc',
  created_at: 1_700_000_000,
}

describe('reconcilePayment', () => {
  beforeEach(() => {
    state.results.clear()
    state.updates.length = 0
    vi.stubEnv('RAZORPAY_KEY_ID', 'rzp_test_key')
    vi.stubEnv('RAZORPAY_KEY_SECRET', 'rzp_test_secret')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('settles a stuck payment from a captured Razorpay payment', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => razorpayItems([CAPTURED])))
    setResults('bookings', { data: { payment_method: 'gateway' }, error: null })
    setResults('payments', { data: [{ id: 'pay-1' }], error: null })

    await expect(reconcilePayment(ROW)).resolves.toBe('paid')
    const update = state.updates.find((entry) => entry.table === 'payments')!.values
    expect(update).toMatchObject({ status: 'paid', provider_payment_id: 'pay_1', reconciliation_note: 'reconciled_from_razorpay' })
    expect(update.reconciled_at).toBeDefined()
  })

  it('flags a capture that arrived after the customer switched to cash', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => razorpayItems([CAPTURED])))
    setResults('bookings', { data: { payment_method: 'cod' }, error: null })
    setResults('payments', { data: [{ id: 'pay-1' }], error: null })

    await expect(reconcilePayment(ROW)).resolves.toBe('flagged')
    expect(state.updates.find((entry) => entry.table === 'payments')!.values.reconciliation_note).toBe('captured_after_cod_switch')
  })

  it('flags an amount mismatch without changing the payment status', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => razorpayItems([{ ...CAPTURED, amount: 1 }])))
    setResults('payments', { data: null, error: null })

    await expect(reconcilePayment(ROW)).resolves.toBe('flagged')
    const update = state.updates[0].values
    expect(update.reconciliation_note).toBe('amount_mismatch')
    expect(update).not.toHaveProperty('status')
  })

  it('flags an authorized-only payment for attention', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => razorpayItems([{ ...CAPTURED, status: 'authorized' }])))
    setResults('payments', { data: null, error: null })

    await expect(reconcilePayment(ROW)).resolves.toBe('flagged')
    expect(state.updates[0].values.reconciliation_note).toBe('authorized_not_captured')
  })

  it('marks an order with no payment attempts as checked without settling it', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => razorpayItems([])))
    setResults('payments', { data: null, error: null })

    await expect(reconcilePayment(ROW)).resolves.toBe('no_capture')
    expect(state.updates[0].values.reconciliation_note).toBe('no_capture_found')
    expect(state.updates[0].values).not.toHaveProperty('status')
  })

  it('leaves the row untouched when Razorpay returns an error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 500 })))

    await expect(reconcilePayment(ROW)).rejects.toThrow('Razorpay order lookup returned 500')
    expect(state.updates).toHaveLength(0)
  })

  it('skips without calling Razorpay when keys are missing', async () => {
    vi.unstubAllEnvs()
    vi.stubEnv('RAZORPAY_KEY_ID', '')
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(reconcilePayment(ROW)).resolves.toBe('skipped')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('runPaymentReconciliationSweep', () => {
  beforeEach(() => {
    state.results.clear()
    state.updates.length = 0
    state.calls.length = 0
    vi.stubEnv('RAZORPAY_KEY_ID', 'rzp_test_key')
    vi.stubEnv('RAZORPAY_KEY_SECRET', 'rzp_test_secret')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('counts outcomes and keeps going after a per-row failure', async () => {
    const rows = [
      { id: 'pay-a', booking_id: 'bk-a', provider_order_id: 'order_a', amount_paise: 50000 },
      { id: 'pay-b', booking_id: 'bk-b', provider_order_id: 'order_b', amount_paise: 50000 },
    ]
    setResults('payments', { data: rows, error: null })
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('boom', { status: 503 }))
      .mockResolvedValueOnce(razorpayItems([]))
    vi.stubGlobal('fetch', fetchMock)
    setResults('payments', { data: null, error: null })

    await expect(runPaymentReconciliationSweep()).resolves.toEqual({
      scanned: 2, paid: 0, flagged: 0, noCapture: 1, skipped: 0, failed: 1, refunded: 0, refundFailed: 0,
    })
  })

  it('keeps unpaid orders eligible for recheck until the 24-hour window closes', async () => {
    setResults('payments', { data: [], error: null })

    await runPaymentReconciliationSweep()
    const scan = state.calls.filter((call) => call.table === 'payments')
    const gte = scan.find((call) => call.method === 'gte')!
    const recheckOr = scan.find((call) => call.method === 'or' && String(call.args[0]).startsWith('reconciled_at.is.null'))!
    expect(Date.now() - new Date(String(gte.args[1])).getTime()).toBeCloseTo(24 * 60 * 60 * 1000, -4)
    expect(String(recheckOr.args[0])).toContain('reconciled_at.lte.')
    expect(scan.some((call) => call.method === 'or' && String(call.args[0]).includes('no_capture_found'))).toBe(true)
  })

  it('retries a COD refund that is still flagged', async () => {
    setResults('payments', { data: [], error: null })
    setResults('payments', { data: [{ id: 'pay-c', provider_payment_id: 'pay_c', amount_paise: 50000 }], error: null })
    setResults('payments', { data: [{ id: 'pay-c' }], error: null })
    setResults('payments', { data: [{ id: 'pay-c' }], error: null })
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })))

    await expect(runPaymentReconciliationSweep()).resolves.toMatchObject({ refunded: 1, refundFailed: 0 })
  })
})

describe('refundCapturedAfterCod', () => {
  const PAYMENT = { id: 'pay-c', provider_payment_id: 'pay_c', amount_paise: 50000 }

  beforeEach(() => {
    state.results.clear()
    state.updates.length = 0
    state.calls.length = 0
    vi.stubEnv('RAZORPAY_KEY_ID', 'rzp_test_key')
    vi.stubEnv('RAZORPAY_KEY_SECRET', 'rzp_test_secret')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('refunds the full amount and marks the payment refunded', async () => {
    setResults('payments', { data: [{ id: 'pay-c' }], error: null })
    setResults('payments', { data: [{ id: 'pay-c' }], error: null })
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(refundCapturedAfterCod(PAYMENT)).resolves.toBe('refunded')
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.razorpay.com/v1/payments/pay_c/refund')
    expect(JSON.parse(String(init.body))).toEqual({ amount: 50000 })
    expect((init.headers as Record<string, string>)['X-Razorpay-Idempotency']).toBe('cod-refund-pay-c')
    expect(state.updates[1].values).toMatchObject({ status: 'refunded', refunded_paise: 50000, reconciliation_note: 'auto_refunded_after_cod_switch' })
  })

  it('does not call Razorpay when another worker already claimed the refund', async () => {
    setResults('payments', { data: [], error: null })
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(refundCapturedAfterCod(PAYMENT)).resolves.toBe('skipped')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns the payment to flagged when Razorpay refuses the refund', async () => {
    setResults('payments', { data: [{ id: 'pay-c' }], error: null })
    setResults('payments', { data: null, error: null })
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 500 })))

    await expect(refundCapturedAfterCod(PAYMENT)).resolves.toBe('refund_failed')
    expect(state.updates[1].values).toMatchObject({ reconciliation_note: 'captured_after_cod_switch' })
    expect(state.updates[1].values).not.toHaveProperty('status')
  })
})
