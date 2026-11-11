import crypto from 'node:crypto'
import express from 'express'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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
  for (const method of ['select', 'eq', 'in', 'or', 'update', 'insert', 'order', 'range', 'limit']) {
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
  authSupabase: {},
}))
vi.mock('../middleware/auth.js', () => ({
  requireAuth: (request: { headers: Record<string, unknown>; authUser?: unknown; profile?: unknown }, _response: unknown, next: () => void) => {
    request.authUser = { id: 'cust-1' }
    request.profile = { role: String(request.headers['x-test-role'] ?? 'customer') }
    next()
  },
  requireRole: (role: string) => (request: { profile?: { role?: string } }, response: { status: (code: number) => { json: (body: unknown) => void } }, next: () => void) =>
    request.profile?.role === role ? next() : response.status(403).json({ error: 'Insufficient permissions' }),
}))
vi.mock('express-rate-limit', () => ({
  default: () => (_request: unknown, _response: unknown, next: () => void) => next(),
}))
vi.mock('../services/scaling.js', () => ({ limiterStore: () => undefined }))
vi.mock('../lib/logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
vi.mock('../services/sms.js', () => ({ sendTemplateSms: vi.fn() }))
vi.mock('../services/customerNotifications.js', () => ({ notifyCustomer: vi.fn() }))

import { logger } from '../lib/logger.js'
import adminRouter from './adminExtended.js'
import customerRouter from './customerExtended.js'
import paymentsRouter from './payments.js'

const WEBHOOK_SECRET = 'whsec_test'
const KEY_SECRET = 'key_secret_test'

function buildApp() {
  const app = express()
  app.use(express.json({
    verify: (request, _response, buffer) => {
      Object.assign(request, { rawBody: buffer })
    },
  }))
  app.use('/api/payment', paymentsRouter)
  app.use('/api/customer', customerRouter)
  app.use('/api/admin', adminRouter)
  return app
}

function setResults(table: string, ...results: unknown[]) {
  state.results.set(table, [...(state.results.get(table) ?? []), ...results])
}

function updatePayloads(table: string) {
  return state.calls.filter((call) => call.table === table && call.method === 'update').map((call) => call.args[0] as Record<string, unknown>)
}

const capturedEvent = {
  event: 'payment.captured',
  created_at: 1700000000,
  payload: {
    payment: {
      entity: {
        id: 'pay_1',
        order_id: 'order_1',
        amount: 50000,
        currency: 'INR',
        status: 'captured',
        method: 'card',
        international: false,
        fee: 1180,
        tax: 180,
        email: 'payer@example.com',
        contact: '+919999999999',
        card: { last4: '4242', network: 'Visa', type: 'credit', issuer: 'HDFC' },
      },
    },
  },
}

function signedWebhook(event: unknown) {
  const body = JSON.stringify(event)
  const signature = crypto.createHmac('sha256', WEBHOOK_SECRET).update(body).digest('hex')
  return request(buildApp()).post('/api/payment/razorpay/webhook').set('Content-Type', 'application/json').set('x-razorpay-signature', signature).send(body)
}

function signedVerify(orderId: string, paymentId: string) {
  const signature = crypto.createHmac('sha256', KEY_SECRET).update(`${orderId}|${paymentId}`).digest('hex')
  return request(buildApp()).post('/api/payment/razorpay/verify').send({ orderId, paymentId, signature })
}

const verifyPaymentRow = { id: 'row-1', booking_id: 'booking-1', amount_paise: 50000 }

beforeEach(() => {
  state.results.clear()
  state.calls.length = 0
  vi.stubEnv('RAZORPAY_WEBHOOK_SECRET', WEBHOOK_SECRET)
  vi.stubEnv('RAZORPAY_KEY_ID', 'rzp_test_key')
  vi.stubEnv('RAZORPAY_KEY_SECRET', KEY_SECRET)
  vi.mocked(logger.warn).mockClear()
  vi.mocked(logger.error).mockClear()
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('razorpay webhook payment details', () => {
  it('stores structured card details and captured_at for a captured payment', async () => {
    setResults('payments', { data: { amount_paise: 50000 }, error: null }, { data: [{ id: 'row-1' }], error: null })

    const response = await signedWebhook(capturedEvent)

    expect(response.status).toBe(202)
    const [payload] = updatePayloads('payments')
    expect(payload).toBeDefined()
    expect(payload).toMatchObject({
      status: 'paid',
      provider_payment_id: 'pay_1',
      method: 'card',
      card_network: 'Visa',
      card_last4: '4242',
      card_type: 'credit',
      card_issuer: 'HDFC',
      fee_paise: 1180,
      tax_paise: 180,
      captured_at: '2023-11-14T22:13:20.000Z',
    })
    expect(payload?.raw_webhook).toEqual(capturedEvent)
  })

  it('refunds a capture that lands after the customer switched to cash', async () => {
    setResults(
      'payments',
      { data: { id: 'row-1', amount_paise: 50000 }, error: null },
      { data: [{ id: 'row-1' }], error: null },
      { data: [{ id: 'row-1' }], error: null },
      { data: [{ id: 'row-1' }], error: null },
    )
    setResults('bookings', { data: { payment_method: 'cod' }, error: null })
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const response = await signedWebhook(capturedEvent)

    expect(response.status).toBe(202)
    expect(updatePayloads('payments')[0]).toMatchObject({ status: 'paid', reconciliation_note: 'captured_after_cod_switch' })
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://api.razorpay.com/v1/payments/pay_1/refund')
  })

  it('guards paid updates so they cannot overwrite a row paid by a different payment', async () => {
    setResults('payments', { data: { amount_paise: 50000 }, error: null }, { data: [{ id: 'row-1' }], error: null })

    await signedWebhook(capturedEvent)

    const orFilter = state.calls.find((call) => call.table === 'payments' && call.method === 'or')
    expect(orFilter?.args[0]).toBe('status.in.(pending,failed),and(status.eq.paid,provider_payment_id.eq.pay_1)')
  })

  it('does not set captured_at for an authorized payment', async () => {
    setResults('payments', { data: { amount_paise: 50000 }, error: null }, { data: [{ id: 'row-1' }], error: null })

    await signedWebhook({ ...capturedEvent, event: 'payment.authorized' })

    const [payload] = updatePayloads('payments')
    expect(payload).toBeDefined()
    expect(payload?.status).toBe('pending')
    expect(payload).not.toHaveProperty('captured_at')
    expect(payload?.card_last4).toBe('4242')
  })

  it('stores error fields and leaves captured_at unset for a failed payment', async () => {
    setResults('payments', { data: { amount_paise: 50000 }, error: null }, { data: [{ id: 'row-1' }], error: null })
    const failedEvent = {
      event: 'payment.failed',
      created_at: 1700000000,
      payload: {
        payment: {
          entity: {
            id: 'pay_2',
            order_id: 'order_1',
            amount: 50000,
            status: 'failed',
            method: 'card',
            error_code: 'BAD_REQUEST_ERROR',
            error_description: 'Payment failed',
            error_source: 'customer',
            error_step: 'payment_authorization',
            error_reason: 'payment_failed',
          },
        },
      },
    }

    await signedWebhook(failedEvent)

    const [payload] = updatePayloads('payments')
    expect(payload).toBeDefined()
    expect(payload).toMatchObject({ status: 'failed', error_code: 'BAD_REQUEST_ERROR', error_reason: 'payment_failed' })
    expect(payload).not.toHaveProperty('captured_at')
  })

  it('does not update the row when the captured amount differs from the order', async () => {
    setResults('payments', { data: { amount_paise: 49900 }, error: null })

    const response = await signedWebhook(capturedEvent)

    expect(response.status).toBe(202)
    expect(updatePayloads('payments')).toHaveLength(0)
    expect(logger.error).toHaveBeenCalledWith('payment.amount_mismatch', expect.any(Object))
  })
})

describe('razorpay verify payment details', () => {
  const entity = {
    id: 'pay_1',
    order_id: 'order_1',
    amount: 50000,
    status: 'captured',
    method: 'upi',
    vpa: 'payer@okaxis',
    fee: null,
    tax: null,
  }

  it('stores details fetched from Razorpay alongside the paid status', async () => {
    setResults('payments', { data: verifyPaymentRow, error: null }, { data: { id: 'row-1' }, error: null })
    setResults('bookings', { data: { id: 'booking-1' }, error: null })
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(entity), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const response = await signedVerify('order_1', 'pay_1')

    expect(response.status).toBe(200)
    expect(response.body).toEqual({ verified: true, orderId: 'booking-1' })
    expect(fetchMock).toHaveBeenCalledWith('https://api.razorpay.com/v1/payments/pay_1', expect.objectContaining({ headers: expect.objectContaining({ Authorization: expect.stringMatching(/^Basic /) }) }))
    expect(updatePayloads('payments')[0]).toMatchObject({ status: 'paid', method: 'upi', vpa: 'payer@okaxis', fee_paise: null, captured_at: expect.any(String) })
  })

  it('still verifies and leaves details to the webhook when the Razorpay fetch fails', async () => {
    setResults('payments', { data: verifyPaymentRow, error: null }, { data: { id: 'row-1' }, error: null })
    setResults('bookings', { data: { id: 'booking-1' }, error: null })
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')))

    const response = await signedVerify('order_1', 'pay_1')

    expect(response.status).toBe(200)
    expect(response.body).toEqual({ verified: true, orderId: 'booking-1' })
    const [payload] = updatePayloads('payments')
    expect(payload).toMatchObject({ status: 'paid', provider_payment_id: 'pay_1' })
    expect(payload).not.toHaveProperty('method')
    expect(logger.warn).toHaveBeenCalledWith('payment.details_fetch_failed', expect.any(Object))
  })

  it('rejects with 409 and does not mark paid when the fetched amount differs', async () => {
    setResults('payments', { data: verifyPaymentRow, error: null })
    setResults('bookings', { data: { id: 'booking-1' }, error: null })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ ...entity, amount: 49900 }), { status: 200 })))

    const response = await signedVerify('order_1', 'pay_1')

    expect(response.status).toBe(409)
    expect(updatePayloads('payments')).toHaveLength(0)
  })
})

describe('customer payment receipt', () => {
  it('returns a receipt-shaped payment without provider identifiers', async () => {
    setResults('bookings', { data: { id: 'booking-1' }, error: null })
    setResults('payments', {
      data: {
        status: 'paid',
        amount_paise: 50000,
        currency: 'INR',
        method: 'upi',
        card_network: null,
        card_last4: null,
        bank: null,
        wallet: null,
        vpa: 'payer@okaxis',
        captured_at: '2023-11-14T22:13:20.000Z',
        fee_paise: null,
        tax_paise: null,
        refunded_paise: 0,
      },
      error: null,
    })

    const response = await request(buildApp()).get('/api/customer/payments/booking-1')

    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({ status: 'paid', amountPaise: 50000, method: 'upi', vpa: 'payer@okaxis', feePaise: null, refundedPaise: 0 })
    expect(response.body).not.toHaveProperty('providerOrderId')
    expect(response.body).not.toHaveProperty('provider_payment_id')
    const paymentSelect = state.calls.find((call) => call.table === 'payments' && call.method === 'select')
    expect(String(paymentSelect?.args[0])).not.toContain('provider')
  })

  it('returns 404 and reads no payment when the booking belongs to another customer', async () => {
    setResults('bookings', { data: null, error: null })

    const response = await request(buildApp()).get('/api/customer/payments/booking-other')

    expect(response.status).toBe(404)
    expect(state.calls.some((call) => call.table === 'payments')).toBe(false)
  })
})

describe('switch gateway booking to cash on delivery', () => {
  const gatewayBooking = { id: 'booking-1', status: 'pending_vendor', payment_method: 'gateway', quoted_amount_paise: 50000 }

  it('switches the booking and creates a COD payment row when no order exists', async () => {
    setResults('bookings', { data: gatewayBooking, error: null }, { data: { id: 'booking-1' }, error: null })
    setResults('payments', { data: null, error: null }, { data: null, error: null })

    const response = await request(buildApp()).post('/api/customer/orders/booking-1/payment-method').send({ paymentMethod: 'cod' })

    expect(response.status).toBe(200)
    expect(response.body).toEqual({ id: 'booking-1', paymentMethod: 'cod' })
    expect(updatePayloads('bookings')[0]).toMatchObject({ payment_method: 'cod' })
    expect(state.calls.find((call) => call.table === 'payments' && call.method === 'insert')?.args[0]).toMatchObject({ booking_id: 'booking-1', provider: 'cash_on_delivery', amount_paise: 50000 })
  })

  it('refuses when the booking is already paid online', async () => {
    setResults('bookings', { data: gatewayBooking, error: null })
    setResults('payments', { data: { id: 'row-1', status: 'paid' }, error: null })

    const response = await request(buildApp()).post('/api/customer/orders/booking-1/payment-method').send({ paymentMethod: 'cod' })

    expect(response.status).toBe(409)
    expect(updatePayloads('bookings')).toHaveLength(0)
  })

  it('returns 404 for a booking owned by another customer', async () => {
    setResults('bookings', { data: null, error: null })

    const response = await request(buildApp()).post('/api/customer/orders/booking-other/payment-method').send({ paymentMethod: 'cod' })

    expect(response.status).toBe(404)
    expect(updatePayloads('bookings')).toHaveLength(0)
  })

  it('reverts the switch when a capture lands during the update', async () => {
    setResults('bookings', { data: gatewayBooking, error: null }, { data: { id: 'booking-1' }, error: null }, { data: null, error: null })
    setResults('payments', { data: { id: 'row-1', status: 'pending' }, error: null }, { data: { status: 'paid' }, error: null })

    const response = await request(buildApp()).post('/api/customer/orders/booking-1/payment-method').send({ paymentMethod: 'cod' })

    expect(response.status).toBe(409)
    expect(updatePayloads('bookings').map((payload) => payload.payment_method)).toEqual(['cod', 'gateway'])
  })
})

describe('admin payment detail', () => {
  it('returns the full payment row to admins and blocks other roles', async () => {
    setResults('payments', { data: { id: 'row-1', status: 'failed', error_reason: 'payment_failed' }, error: null })
    const app = buildApp()

    const forbidden = await request(app).get('/api/admin/payments/row-1').set('x-test-role', 'customer')
    expect(forbidden.status).toBe(403)

    const allowed = await request(app).get('/api/admin/payments/row-1').set('x-test-role', 'admin')
    expect(allowed.status).toBe(200)
    expect(allowed.body).toMatchObject({ id: 'row-1', error_reason: 'payment_failed' })
  })
})
