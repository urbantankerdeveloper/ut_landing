import express from 'express'
import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  results: new Map<string, unknown[]>(),
}))

const mocks = vi.hoisted(() => ({
  transitionBooking: vi.fn(),
  otpMatches: vi.fn(),
  deliveryVerificationMethod: vi.fn(),
  notifyCustomer: vi.fn(),
  notifyCustomerSmsById: vi.fn(),
  notifyCustomerOfAssignment: vi.fn(),
  recordAnalyticsEvent: vi.fn(),
  emitRealtime: vi.fn(),
  emitBookingLifecycleEvent: vi.fn(),
  emitRealtimeToUser: vi.fn(),
  emitRealtimeToVendor: vi.fn(),
  emitRealtimeToBooking: vi.fn(),
}))

function nextResult(table: string) {
  const queue = state.results.get(table)
  return queue && queue.length > 0 ? queue.shift() : { data: null, error: null }
}

function queryBuilder(table: string) {
  const result = nextResult(table)
  const builder: Record<string, unknown> = {}
  for (const method of ['select', 'eq', 'in', 'is', 'or', 'update', 'insert', 'order', 'range', 'limit', 'upsert']) {
    builder[method] = () => builder
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
    request.authUser = { id: 'user-1' }
    request.profile = { id: 'user-1', role: String(request.headers['x-test-role'] ?? 'customer') }
    next()
  },
  requireRole: (role: string) => (request: { profile?: { role?: string } }, response: { status: (code: number) => { json: (body: unknown) => void } }, next: () => void) =>
    request.profile?.role === role ? next() : response.status(403).json({ error: 'Insufficient permissions' }),
}))
vi.mock('../services/realtime.js', () => ({
  emitRealtime: mocks.emitRealtime,
  emitBookingLifecycleEvent: mocks.emitBookingLifecycleEvent,
  emitRealtimeToUser: mocks.emitRealtimeToUser,
  emitRealtimeToVendor: mocks.emitRealtimeToVendor,
  emitRealtimeToBooking: mocks.emitRealtimeToBooking,
  realtimeHealth: vi.fn(),
}))
vi.mock('../services/bookingLifecycle.js', () => ({ transitionBooking: mocks.transitionBooking }))
vi.mock('../services/customerNotifications.js', () => ({ notifyCustomer: mocks.notifyCustomer }))
vi.mock('../services/bookingNotifications.js', () => ({
  notifyCustomerOfAssignment: mocks.notifyCustomerOfAssignment,
  notifyCustomerSmsById: mocks.notifyCustomerSmsById,
}))
vi.mock('../services/otp.js', () => ({ otpMatches: mocks.otpMatches }))
vi.mock('../services/deliveryVerification.js', () => ({ deliveryVerificationMethod: mocks.deliveryVerificationMethod }))
vi.mock('../lib/analytics.js', () => ({
  analyticsEventNames: { vendorAccepted: 'vendor_accepted', rejected: 'rejected', delivered: 'delivered' },
  recordAnalyticsEvent: mocks.recordAnalyticsEvent,
}))
vi.mock('../lib/logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
vi.mock('express-rate-limit', () => ({
  default: () => (_request: unknown, _response: unknown, next: () => void) => next(),
}))
vi.mock('../services/scaling.js', () => ({ limiterStore: () => undefined }))

import adminRouter from './adminExtended.js'
import vendorRouter from './vendorExtended.js'

const BOOKING_ID = 'b0000000-0000-4000-8000-000000000001'

function buildApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/vendor', vendorRouter)
  app.use('/api/admin', adminRouter)
  return app
}

function setResults(table: string, ...results: unknown[]) {
  state.results.set(table, [...(state.results.get(table) ?? []), ...results])
}

beforeEach(() => {
  state.results.clear()
  vi.clearAllMocks()
  mocks.transitionBooking.mockResolvedValue({ data: { id: BOOKING_ID, reference: 'UT-1', customer_id: 'cust-9', status: 'accepted' }, error: null })
  mocks.otpMatches.mockReturnValue(true)
  mocks.deliveryVerificationMethod.mockReturnValue('otp')
})

describe('vendor order lifecycle events', () => {
  it('emits booking.vendor_accepted to the customer rooms after booking.updated when a vendor accepts', async () => {
    setResults('vendors', { data: { id: 'vendor-1' }, error: null }, { data: { owner_profile_id: 'prof-v1' }, error: null }, { data: { owner_profile_id: 'prof-v1' }, error: null })
    setResults('bookings', { data: { id: BOOKING_ID, reference: 'UT-1', status: 'pending_vendor', vendor_id: null, vehicle_id: null, driver_id: null, customer_id: 'cust-9' }, error: null }, { data: { vendor_id: null, vehicle_id: 'veh-1', driver_id: 'drv-1' }, error: null })
    setResults('notifications', { data: [{ id: 'n1', event_type: 'vendor_order_created', payload: { bookingId: BOOKING_ID } }], error: null }, { data: [], error: null })

    const response = await request(buildApp()).patch(`/api/vendor/orders/${BOOKING_ID}/transition`).set('x-test-role', 'vendor').send({ action: 'accept' })

    expect(response.status).toBe(200)
    expect(mocks.emitRealtime).toHaveBeenCalledWith('booking.updated', { bookingId: BOOKING_ID, status: 'accepted' }, 'cust-9')
    expect(mocks.emitBookingLifecycleEvent).toHaveBeenCalledWith(
      'booking.vendor_accepted',
      { bookingId: BOOKING_ID, vendorId: 'vendor-1', reference: 'UT-1' },
      'cust-9',
    )
  })

  it('emits booking.delivered and booking.updated when delivery is verified with the OTP', async () => {
    setResults('vendors', { data: { id: 'vendor-1' }, error: null })
    setResults('bookings', {
      data: {
        id: BOOKING_ID,
        status: 'arrived',
        customer_id: 'cust-9',
        reference: 'UT-1',
        delivery_otp_hash: 'hash',
        delivery_otp_expires_at: new Date(Date.now() + 60_000).toISOString(),
        delivery_otp_attempts: 0,
        delivery_otp_sms_sent: true,
      },
      error: null,
    })
    setResults('bookings', { data: { id: BOOKING_ID }, error: null })

    const response = await request(buildApp()).post(`/api/vendor/orders/${BOOKING_ID}/delivery/verify`).set('x-test-role', 'vendor').send({ otp: '123456' })

    expect(response.status).toBe(200)
    expect(mocks.emitRealtime).toHaveBeenCalledWith('booking.updated', { bookingId: BOOKING_ID, status: 'delivered' }, 'cust-9')
    expect(mocks.emitBookingLifecycleEvent).toHaveBeenCalledWith(
      'booking.delivered',
      { bookingId: BOOKING_ID, reference: 'UT-1', deliveredAt: expect.any(String) },
      'cust-9',
    )
  })
})

describe('admin order status events', () => {
  it('emits booking.delivered to the customer when an admin marks the order delivered', async () => {
    const response = await request(buildApp()).patch(`/api/admin/orders/${BOOKING_ID}/status`).set('x-test-role', 'admin').send({ status: 'delivered' })

    expect(response.status).toBe(200)
    expect(mocks.emitRealtime).toHaveBeenCalledWith('booking.updated', { bookingId: BOOKING_ID, status: 'delivered' })
    expect(mocks.emitBookingLifecycleEvent).toHaveBeenCalledWith(
      'booking.delivered',
      { bookingId: BOOKING_ID, reference: 'UT-1', deliveredAt: expect.any(String) },
      'cust-9',
    )
  })

  it('does not emit booking.delivered for other admin status changes', async () => {
    mocks.transitionBooking.mockResolvedValueOnce({ data: { id: BOOKING_ID, reference: 'UT-1', customer_id: 'cust-9', status: 'en_route' }, error: null })

    const response = await request(buildApp()).patch(`/api/admin/orders/${BOOKING_ID}/status`).set('x-test-role', 'admin').send({ status: 'en_route' })

    expect(response.status).toBe(200)
    expect(mocks.emitBookingLifecycleEvent).not.toHaveBeenCalled()
  })
})
