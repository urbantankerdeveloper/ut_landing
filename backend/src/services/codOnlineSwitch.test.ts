import express from 'express'
import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'

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
  for (const method of ['select', 'eq', 'in', 'or', 'is', 'update', 'insert', 'order', 'range', 'limit']) {
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
  requireAuth: (request: { authUser?: unknown }, _response: unknown, next: () => void) => {
    request.authUser = { id: 'cust-1' }
    next()
  },
  requireRole: () => (_request: unknown, _response: unknown, next: () => void) => next(),
}))
vi.mock('express-rate-limit', () => ({
  default: () => (_request: unknown, _response: unknown, next: () => void) => next(),
}))
vi.mock('../services/scaling.js', () => ({ limiterStore: () => undefined }))
vi.mock('../lib/logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
vi.mock('../services/sms.js', () => ({ sendTemplateSms: vi.fn(async () => undefined) }))
vi.mock('../services/pushNotifications.js', () => ({ sendPushNotification: vi.fn(async () => undefined) }))
vi.mock('../services/realtime.js', () => ({ emitRealtimeToVendor: vi.fn() }))
vi.mock('../services/customerNotifications.js', () => ({ notifyCustomer: vi.fn() }))

import { logger } from '../lib/logger.js'
import { sendPushNotification } from './pushNotifications.js'
import { emitRealtimeToVendor } from './realtime.js'
import { sendTemplateSms } from './sms.js'
import { notifyPaidOnlineAfterCodSwitch } from './codOnlineSwitch.js'
import customerRouter from '../routes/customerExtended.js'

const BOOKING_ID = '11111111-1111-4111-8111-111111111111'

function setResults(table: string, ...results: unknown[]) {
  state.results.set(table, [...(state.results.get(table) ?? []), ...results])
}

function updatePayloads(table: string) {
  return state.calls.filter((call) => call.table === table && call.method === 'update').map((call) => call.args[0] as Record<string, unknown>)
}

const switchedBooking = {
  id: BOOKING_ID,
  reference: 'REF-1',
  vendor_id: 'vendor-1',
  driver_id: 'driver-1',
  payment_method: 'gateway',
  payment_switched_to_online_at: '2024-01-01T00:00:00.000Z',
}

beforeEach(() => {
  state.results.clear()
  state.calls.length = 0
  vi.mocked(sendTemplateSms).mockClear()
  vi.mocked(sendPushNotification).mockClear()
  vi.mocked(emitRealtimeToVendor).mockClear()
  vi.mocked(logger.error).mockClear()
})

describe('notifyPaidOnlineAfterCodSwitch', () => {
  it('tells the vendor and driver once the booking is paid after a COD switch', async () => {
    setResults('bookings', { data: switchedBooking, error: null }, { data: { id: BOOKING_ID }, error: null })
    setResults('vendors', { data: { owner_profile_id: 'owner-1', phone_e164: '+919000000001' }, error: null })
    setResults('drivers', { data: { mobile_e164: '+919000000002' }, error: null })
    setResults('notifications', { data: null, error: null })

    await notifyPaidOnlineAfterCodSwitch(BOOKING_ID)

    expect(vi.mocked(sendTemplateSms).mock.calls.map((call) => call[1])).toEqual(['+919000000001', '+919000000002'])
    expect(vi.mocked(sendTemplateSms).mock.calls[0]).toEqual(['cod_switched_to_online', '+919000000001', { reference: 'REF-1' }])
    expect(vi.mocked(sendPushNotification).mock.calls[0]?.[0]).toMatchObject({ recipientId: 'owner-1' })
    expect(vi.mocked(emitRealtimeToVendor)).toHaveBeenCalledWith('vendor-1', 'booking.updated', { bookingId: BOOKING_ID })
  })

  it('does nothing when the booking was never switched to online', async () => {
    setResults('bookings', { data: { ...switchedBooking, payment_method: 'cod', payment_switched_to_online_at: null }, error: null })

    await notifyPaidOnlineAfterCodSwitch(BOOKING_ID)

    expect(vi.mocked(sendTemplateSms)).not.toHaveBeenCalled()
    expect(updatePayloads('bookings')).toHaveLength(0)
  })

  it('does not notify twice when another path already claimed the notification', async () => {
    setResults('bookings', { data: switchedBooking, error: null }, { data: null, error: null })

    await notifyPaidOnlineAfterCodSwitch(BOOKING_ID)

    expect(vi.mocked(sendTemplateSms)).not.toHaveBeenCalled()
  })

  it('never throws when the booking lookup fails', async () => {
    setResults('bookings', { data: null, error: { message: 'db down' } })

    await expect(notifyPaidOnlineAfterCodSwitch(BOOKING_ID)).resolves.toBeUndefined()
    expect(vi.mocked(logger.error)).toHaveBeenCalledWith('cod_online.notification_failed', expect.objectContaining({ bookingId: BOOKING_ID }))
  })

  it('keeps notifying the driver when one SMS delivery fails', async () => {
    setResults('bookings', { data: switchedBooking, error: null }, { data: { id: BOOKING_ID }, error: null })
    setResults('vendors', { data: { owner_profile_id: 'owner-1', phone_e164: '+919000000001' }, error: null })
    setResults('drivers', { data: { mobile_e164: '+919000000002' }, error: null })
    setResults('notifications', { data: null, error: null })
    vi.mocked(sendTemplateSms).mockRejectedValueOnce(new Error('MSG91 unavailable'))

    await expect(notifyPaidOnlineAfterCodSwitch(BOOKING_ID)).resolves.toBeUndefined()
    expect(vi.mocked(sendTemplateSms)).toHaveBeenCalledTimes(2)
  })
})

describe('POST /orders/:orderId/payment-method/online', () => {
  function app() {
    const instance = express()
    instance.use(express.json())
    instance.use('/api/customer', customerRouter)
    return instance
  }

  const switchRoute = `/api/customer/orders/${BOOKING_ID}/payment-method/online`

  it('returns 404 when the booking is not owned by the customer', async () => {
    setResults('bookings', { data: null, error: null })

    const response = await request(app()).post(switchRoute)

    expect(response.status).toBe(404)
  })

  it('is idempotent when the booking is already online', async () => {
    setResults('bookings', { data: { id: BOOKING_ID, status: 'accepted', payment_method: 'gateway' }, error: null })

    const response = await request(app()).post(switchRoute)

    expect(response.status).toBe(200)
    expect(response.body).toEqual({ id: BOOKING_ID, paymentMethod: 'gateway' })
    expect(updatePayloads('bookings')).toHaveLength(0)
  })

  it('rejects a switch once the driver has started the trip', async () => {
    setResults('bookings', { data: { id: BOOKING_ID, status: 'en_route', payment_method: 'cod' }, error: null })

    const response = await request(app()).post(switchRoute)

    expect(response.status).toBe(409)
    expect(updatePayloads('bookings')).toHaveLength(0)
  })

  it('rejects a switch when the booking is already paid', async () => {
    setResults('bookings', { data: { id: BOOKING_ID, status: 'accepted', payment_method: 'cod' }, error: null })
    setResults('payments', { data: { status: 'paid' }, error: null })

    const response = await request(app()).post(switchRoute)

    expect(response.status).toBe(409)
    expect(updatePayloads('bookings')).toHaveLength(0)
  })

  it('switches a COD booking to online before the driver is en route', async () => {
    setResults('bookings', { data: { id: BOOKING_ID, status: 'accepted', payment_method: 'cod' }, error: null }, { data: { id: BOOKING_ID }, error: null })
    setResults('payments', { data: { status: 'pending' }, error: null }, { data: { status: 'pending' }, error: null })

    const response = await request(app()).post(switchRoute)

    expect(response.status).toBe(200)
    expect(response.body).toEqual({ id: BOOKING_ID, paymentMethod: 'gateway' })
    expect(updatePayloads('bookings')[0]).toMatchObject({ payment_method: 'gateway' })
  })

  it('reverts to COD when a capture lands during the switch', async () => {
    setResults('bookings', { data: { id: BOOKING_ID, status: 'accepted', payment_method: 'cod' }, error: null }, { data: { id: BOOKING_ID }, error: null })
    setResults('payments', { data: { status: 'pending' }, error: null }, { data: { status: 'paid' }, error: null })

    const response = await request(app()).post(switchRoute)

    expect(response.status).toBe(409)
    expect(updatePayloads('bookings')[1]).toMatchObject({ payment_method: 'cod', payment_switched_to_online_at: null })
  })
})
