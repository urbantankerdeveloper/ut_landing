import express from 'express'
import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { config } from '../config.js'

const state = vi.hoisted(() => ({
  results: new Map<string, unknown[]>(),
}))

const mocks = vi.hoisted(() => ({
  transitionBooking: vi.fn(),
  otpMatches: vi.fn(),
  deliveryVerificationMethod: vi.fn(),
  notifyCustomer: vi.fn(),
  notifyCustomerWhatsAppById: vi.fn(),
  notifyCustomerOfAssignment: vi.fn(),
  notifyCustomerOfBookingStatus: vi.fn(),
  notifyCustomerOfBookingWhatsApp: vi.fn(),
  recordAnalyticsEvent: vi.fn(),
  emitRealtime: vi.fn(),
  emitBookingLifecycleEvent: vi.fn(),
  emitRealtimeToUser: vi.fn(),
  emitRealtimeToVendor: vi.fn(),
  emitRealtimeToBooking: vi.fn(),
  getManualAssignmentModeEnabled: vi.fn(),
  setManualAssignmentModeEnabled: vi.fn(),
}))

function nextResult(table: string) {
  const queue = state.results.get(table)
  return queue && queue.length > 0 ? queue.shift() : { data: null, error: null }
}

function queryBuilder(table: string) {
  const result = nextResult(table)
  const builder: Record<string, unknown> = {}
  for (const method of ['select', 'eq', 'in', 'is', 'or', 'update', 'insert', 'order', 'range', 'limit', 'upsert', 'gte', 'lt', 'not']) {
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
  notifyCustomerOfBookingStatus: mocks.notifyCustomerOfBookingStatus,
  notifyCustomerOfBookingWhatsApp: mocks.notifyCustomerOfBookingWhatsApp,
  notifyCustomerWhatsAppById: mocks.notifyCustomerWhatsAppById,
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
vi.mock('../services/manualAssignmentMode.js', () => ({
  getManualAssignmentModeEnabled: mocks.getManualAssignmentModeEnabled,
  setManualAssignmentModeEnabled: mocks.setManualAssignmentModeEnabled,
}))

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
  config.featureFlags.admin_dashboard_v2_enabled = false
  config.featureFlags.area_availability_enabled = false
  mocks.transitionBooking.mockResolvedValue({ data: { id: BOOKING_ID, reference: 'UT-1', customer_id: 'cust-9', status: 'accepted' }, error: null })
  mocks.otpMatches.mockReturnValue(true)
  mocks.deliveryVerificationMethod.mockReturnValue('otp')
  mocks.getManualAssignmentModeEnabled.mockResolvedValue(false)
  mocks.setManualAssignmentModeEnabled.mockImplementation(async (enabled: boolean) => enabled)
})

describe('admin dispatch settings', () => {
  it('returns the current manual assignment mode to admins', async () => {
    mocks.getManualAssignmentModeEnabled.mockResolvedValueOnce(true)

    const response = await request(buildApp())
      .get('/api/admin/dispatch-settings')
      .set('x-test-role', 'admin')

    expect(response.status).toBe(200)
    expect(response.body).toEqual({ manualAssignmentModeEnabled: true })
  })

  it('allows admins to persist the manual assignment mode', async () => {
    const response = await request(buildApp())
      .patch('/api/admin/dispatch-settings')
      .set('x-test-role', 'admin')
      .send({ manualAssignmentModeEnabled: true })

    expect(response.status).toBe(200)
    expect(response.body).toEqual({ manualAssignmentModeEnabled: true })
    expect(mocks.setManualAssignmentModeEnabled).toHaveBeenCalledWith(true)
  })

  it('does not allow dispatchers to change global dispatch settings', async () => {
    const response = await request(buildApp())
      .patch('/api/admin/dispatch-settings')
      .set('x-test-role', 'dispatcher')
      .send({ manualAssignmentModeEnabled: true })

    expect(response.status).toBe(403)
    expect(mocks.setManualAssignmentModeEnabled).not.toHaveBeenCalled()
  })
})

describe('admin dashboard summaries', () => {
  it('keeps new summary endpoints disabled until their flags are enabled', async () => {
    const dashboard = await request(buildApp())
      .get('/api/admin/dashboard-summary')
      .set('x-test-role', 'admin')
    const availability = await request(buildApp())
      .get('/api/admin/availability-by-area')
      .set('x-test-role', 'admin')

    expect(dashboard.status).toBe(404)
    expect(availability.status).toBe(404)
  })

  it('returns captured revenue, operational counts, and two-hour stale orders', async () => {
    config.featureFlags.admin_dashboard_v2_enabled = true
    setResults('bookings',
      ...[1, 2, 3, 4, 5].map((count) => ({ data: null, error: null, count })),
      { data: null, error: null, count: 6 },
    )
    setResults('payments',
      { data: [{ amount_paise: 4100 }, { amount_paise: 900 }], error: null },
      { data: null, error: null, count: 7 },
    )
    setResults('partner_applications', { data: null, error: null, count: 8 })
    setResults('vendors', { data: null, error: null, count: 9 })
    setResults('drivers', { data: null, error: null, count: 10 })
    setResults('dispatcher_alerts', { data: null, error: null, count: 11 })

    const response = await request(buildApp())
      .get('/api/admin/dashboard-summary')
      .set('x-test-role', 'admin')

    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({
      activeOrdersByStatus: {
        pending_vendor: 1,
        vendor_assigned: 2,
        accepted: 3,
        en_route: 4,
        arrived: 5,
      },
      todayRevenuePaise: 5000,
      pendingPartnerApplications: 8,
      onlineVendors: 9,
      activeDrivers: 10,
      openOrderAlerts: 11,
      failedPayments: 7,
      stuckOrders: 6,
    })
  })

  it('returns availability grouped by the vendors service area', async () => {
    config.featureFlags.area_availability_enabled = true
    setResults('vendors', {
      data: [{
        service_zone: 'Chennai North',
        is_online: true,
        verification: 'approved',
        vehicles: [{ is_active: true, verification: 'approved' }],
        drivers: [{ is_active: true, verification: 'approved' }],
      }],
      error: null,
    })

    const response = await request(buildApp())
      .get('/api/admin/availability-by-area')
      .set('x-test-role', 'admin')

    expect(response.status).toBe(200)
    expect(response.body).toEqual([{
      area: 'Chennai North',
      onlineVendors: 1,
      activeVehicles: 1,
      activeDrivers: 1,
    }])
  })
})

describe('vendor order lifecycle events', () => {
  it('emits booking.vendor_accepted to the customer rooms after booking.updated when a vendor accepts', async () => {
    setResults('vendors', { data: { id: 'vendor-1' }, error: null }, { data: { owner_profile_id: 'prof-v1' }, error: null }, { data: { owner_profile_id: 'prof-v1' }, error: null })
    setResults('bookings', { data: { id: BOOKING_ID, reference: 'UT-1', status: 'pending_vendor', vendor_id: null, vehicle_id: null, driver_id: null, customer_id: 'cust-9' }, error: null }, { data: { vendor_id: null, vehicle_id: 'veh-1', driver_id: 'drv-1' }, error: null })
    setResults('notifications', { data: [{ id: 'n1', event_type: 'vendor_order_created', payload: { bookingId: BOOKING_ID } }], error: null }, { data: [], error: null })
    mocks.transitionBooking.mockResolvedValueOnce({
      data: {
        id: BOOKING_ID,
        reference: 'UT-1',
        customer_id: 'cust-9',
        customer_phone_e164: '+919123456789',
        vehicle_id: 'veh-1',
        driver_id: 'drv-1',
        status: 'accepted',
      },
      error: null,
    })

    const response = await request(buildApp()).patch(`/api/vendor/orders/${BOOKING_ID}/transition`).set('x-test-role', 'vendor').send({ action: 'accept' })

    expect(response.status).toBe(200)
    expect(mocks.emitRealtime).toHaveBeenCalledWith('booking.updated', { bookingId: BOOKING_ID, status: 'accepted' }, 'cust-9')
    expect(mocks.emitBookingLifecycleEvent).toHaveBeenCalledWith(
      'booking.vendor_accepted',
      { bookingId: BOOKING_ID, vendorId: 'vendor-1', reference: 'UT-1' },
      'cust-9',
    )
    expect(mocks.notifyCustomerOfAssignment).toHaveBeenCalledWith(
      expect.objectContaining({
        id: BOOKING_ID,
        customer_id: 'cust-9',
        customer_phone_e164: '+919123456789',
        vehicle_id: 'veh-1',
        driver_id: 'drv-1',
      }),
    )
  })

  it('sends WhatsApp updates to the booking customer for en-route and arrival events', async () => {
    setResults('vendors', { data: { id: 'vendor-1' } })
    setResults('bookings', { data: { id: BOOKING_ID, reference: 'UT-1', status: 'accepted', vendor_id: 'vendor-1', customer_id: 'cust-9' } })
    mocks.transitionBooking.mockResolvedValueOnce({
      data: { id: BOOKING_ID, reference: 'UT-1', customer_id: 'cust-9', status: 'en_route' },
      error: null,
    })

    const response = await request(buildApp())
      .patch(`/api/vendor/orders/${BOOKING_ID}/transition`)
      .set('x-test-role', 'vendor')
      .send({ action: 'status', status: 'en_route' })

    expect(response.status).toBe(200)
    expect(mocks.notifyCustomerOfBookingStatus).toHaveBeenCalledWith(BOOKING_ID, 'en_route')
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
    expect(mocks.emitRealtimeToVendor).toHaveBeenCalledWith(
      'vendor-1',
      'booking.updated',
      { bookingId: BOOKING_ID, status: 'delivered' },
    )
    expect(mocks.notifyCustomerOfBookingWhatsApp).toHaveBeenCalledWith(
      BOOKING_ID,
      'delivery_confirmation',
      { reference: 'UT-1' },
    )
  })
})

describe('admin order status events', () => {
  it('notifies the assigned vendor so their order list refreshes immediately', async () => {
    mocks.transitionBooking.mockResolvedValueOnce({
      data: {
        id: BOOKING_ID,
        reference: 'UT-1',
        customer_id: 'cust-9',
        vendor_id: 'vendor-1',
        status: 'vendor_assigned',
      },
      error: null,
    })

    const response = await request(buildApp())
      .patch(`/api/admin/orders/${BOOKING_ID}/assignment`)
      .set('x-test-role', 'admin')
      .send({ vendorId: 'c0000000-0000-4000-8000-000000000001' })

    expect(response.status).toBe(200)
    expect(mocks.emitRealtimeToVendor).toHaveBeenCalledWith(
      'vendor-1',
      'booking.updated',
      { bookingId: BOOKING_ID, status: 'vendor_assigned' },
    )
    expect(mocks.emitRealtime).toHaveBeenCalledWith(
      'booking.updated',
      { bookingId: BOOKING_ID, status: 'vendor_assigned' },
      'cust-9',
    )
    expect(mocks.notifyCustomerOfBookingStatus).toHaveBeenCalledWith(BOOKING_ID, 'vendor_assigned')
  })

  it('emits booking.delivered to the customer when an admin marks the order delivered', async () => {
    mocks.transitionBooking.mockResolvedValueOnce({ data: { id: BOOKING_ID, reference: 'UT-1', customer_id: 'cust-9', vendor_id: 'vendor-1', status: 'delivered' }, error: null })
    const response = await request(buildApp()).patch(`/api/admin/orders/${BOOKING_ID}/status`).set('x-test-role', 'admin').send({ status: 'delivered' })

    expect(response.status).toBe(200)
    expect(mocks.emitRealtime).toHaveBeenCalledWith('booking.updated', { bookingId: BOOKING_ID, status: 'delivered' }, 'cust-9')
    expect(mocks.emitBookingLifecycleEvent).toHaveBeenCalledWith(
      'booking.delivered',
      { bookingId: BOOKING_ID, reference: 'UT-1', deliveredAt: expect.any(String) },
      'cust-9',
    )
    expect(mocks.notifyCustomerOfBookingWhatsApp).toHaveBeenCalledWith(
      BOOKING_ID,
      'delivery_confirmation',
      { reference: 'UT-1' },
    )
    expect(mocks.emitRealtimeToVendor).toHaveBeenCalledWith(
      'vendor-1',
      'booking.updated',
      { bookingId: BOOKING_ID, status: 'delivered' },
    )
  })

  it('tells the customer room about admin cancellations so customers outside the booking room are notified', async () => {
    mocks.transitionBooking.mockResolvedValueOnce({ data: { id: BOOKING_ID, reference: 'UT-1', customer_id: 'cust-9', status: 'cancelled' }, error: null })

    const response = await request(buildApp()).post(`/api/admin/orders/${BOOKING_ID}/cancel`).set('x-test-role', 'admin').send({ reason: 'Vendor unavailable' })

    expect(response.status).toBe(200)
    expect(mocks.emitRealtime).toHaveBeenCalledWith('booking.updated', { bookingId: BOOKING_ID, status: 'cancelled' }, 'cust-9')
    expect(mocks.notifyCustomerOfBookingStatus).toHaveBeenCalledWith(BOOKING_ID, 'cancelled')
  })

  it('does not emit booking.delivered for other admin status changes', async () => {
    mocks.transitionBooking.mockResolvedValueOnce({ data: { id: BOOKING_ID, reference: 'UT-1', customer_id: 'cust-9', status: 'en_route' }, error: null })

    const response = await request(buildApp()).patch(`/api/admin/orders/${BOOKING_ID}/status`).set('x-test-role', 'admin').send({ status: 'en_route' })

    expect(response.status).toBe(200)
    expect(mocks.emitBookingLifecycleEvent).not.toHaveBeenCalled()
    expect(mocks.notifyCustomerOfBookingStatus).toHaveBeenCalledWith(BOOKING_ID, 'en_route')
  })

  it('notifies the customer when an admin restarts vendor assignment', async () => {
    mocks.transitionBooking.mockResolvedValueOnce({ data: { id: BOOKING_ID, reference: 'UT-1', customer_id: 'cust-9', status: 'pending_vendor' }, error: null })

    const response = await request(buildApp())
      .patch(`/api/admin/orders/${BOOKING_ID}/status`)
      .set('x-test-role', 'admin')
      .send({ status: 'pending_vendor' })

    expect(response.status).toBe(200)
    expect(mocks.notifyCustomerOfBookingStatus).toHaveBeenCalledWith(BOOKING_ID, 'pending_vendor')
  })
})

describe('dispatcher order support actions', () => {
  it('returns only the assigned driver contact for dispatchers', async () => {
    config.featureFlags.AUTH_MOUNT_ONCE = false
    setResults('bookings', {
      data: {
        id: BOOKING_ID,
        vendor_id: 'vendor-1',
        driver_id: 'driver-1',
        status: 'en_route',
      },
      error: null,
    })
    setResults('drivers', {
      data: {
        id: 'driver-1',
        name: 'Driver One',
        mobile_e164: '+919876543210',
      },
      error: null,
    })

    const response = await request(buildApp())
      .get(`/api/admin/orders/${BOOKING_ID}/driver-contact`)
      .set('x-test-role', 'dispatcher')

    expect(response.status).toBe(200)
    expect(response.body).toEqual({
      driverId: 'driver-1',
      name: 'Driver One',
      phone: '+919876543210',
    })
  })

  it('does not expose driver contact information to customers', async () => {
    config.featureFlags.AUTH_MOUNT_ONCE = false

    const response = await request(buildApp())
      .get(`/api/admin/orders/${BOOKING_ID}/driver-contact`)
      .set('x-test-role', 'customer')

    expect(response.status).toBe(403)
  })

  it('creates an in-app/push delay update for an active booking customer', async () => {
    config.featureFlags.AUTH_MOUNT_ONCE = false
    setResults('bookings', {
      data: {
        id: BOOKING_ID,
        customer_id: 'customer-1',
        status: 'en_route',
      },
      error: null,
    })
    mocks.notifyCustomer.mockResolvedValueOnce({ id: 'notification-1' })

    const response = await request(buildApp())
      .post(`/api/admin/orders/${BOOKING_ID}/notify-customer`)
      .set('x-test-role', 'dispatcher')
      .send({ message: 'Your delivery is delayed.' })

    expect(response.status).toBe(201)
    expect(response.body).toEqual({ notified: true, reason: null })
    expect(mocks.notifyCustomer).toHaveBeenCalledWith({
      customerId: 'customer-1',
      eventType: 'booking_dispatcher_delay',
      title: 'Delivery update',
      detail: 'Your delivery is delayed.',
      bookingId: BOOKING_ID,
    })
  })
})
