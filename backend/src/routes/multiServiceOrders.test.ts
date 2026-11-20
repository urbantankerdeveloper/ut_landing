import express from 'express'
import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  role: 'customer',
  calls: [] as Array<{ table: string; operations: Array<{ name: string; args: unknown[] }> }>,
  rpcCalls: [] as Array<{ name: string; args: unknown }>,
  rpcResult: { data: null as unknown, error: null as { message: string } | null },
  quote: {
    subtotalPaise: 10000,
    gstPaise: 1800,
    serviceAmountsPaise: [5900, 5900],
    invoiceLineItems: [
      { serviceCode: 'water_tanker', description: 'Water', quantity: 1, subtotalPaise: 5000, taxPaise: 900, taxRate: 0.18, discountPaise: 0, totalPaise: 5900 },
      { serviceCode: 'sewage_tanker', description: 'Sewage', quantity: 1, subtotalPaise: 5000, taxPaise: 900, taxRate: 0.18, discountPaise: 0, totalPaise: 5900 },
    ],
  },
  respond: vi.fn<(table: string, operations: Array<{ name: string; args: unknown[] }>) => unknown>(),
}))

function chain(table: string, operations: Array<{ name: string; args: unknown[] }> = []): unknown {
  return new Proxy({}, {
    get(_target, prop) {
      if (prop === 'then') {
        return (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
          Promise.resolve(mocks.respond(table, operations)).then(resolve, reject)
      }
      return (...args: unknown[]) => chain(table, [...operations, { name: String(prop), args }])
    },
  })
}

vi.mock('../supabase.js', () => ({
  supabase: {
    from: (table: string) => chain(table),
    rpc: (name: string, args: unknown) => {
      mocks.rpcCalls.push({ name, args })
      return Promise.resolve(mocks.rpcResult)
    },
  },
}))
vi.mock('../middleware/auth.js', () => ({
  requireAuth: (request: object, _response: unknown, next: () => void) => {
    Object.assign(request, { authUser: { id: 'auth-user' }, profile: { role: mocks.role } })
    next()
  },
  requireRole: (...roles: string[]) => (request: object, response: { status: (code: number) => { json: (body: unknown) => void } }, next: () => void) => {
    if (!roles.includes(mocks.role)) return response.status(403).json({ error: 'Insufficient permissions' })
    next()
  },
}))
vi.mock('../services/realtime.js', () => ({ emitRealtimeToUser: vi.fn(), emitRealtimeToVendor: vi.fn() }))
vi.mock('../services/pushNotifications.js', () => ({ sendPushNotification: vi.fn().mockResolvedValue(undefined) }))
vi.mock('../services/sms.js', () => ({ sendTemplateSms: vi.fn().mockResolvedValue({ queued: true }) }))
vi.mock('../services/manualAssignmentMode.js', () => ({ getManualAssignmentModeEnabled: vi.fn().mockResolvedValue(false) }))
vi.mock('../services/pricing.js', () => ({ quoteServices: vi.fn(() => Promise.resolve(mocks.quote)) }))
vi.mock('../services/invoices.js', () => ({ createInvoiceIfEligible: vi.fn() }))
vi.mock('./customer.js', () => ({ debitWalletForBooking: vi.fn() }))

import { config } from '../config.js'
import { multiServiceAdminRoutes, multiServiceCustomerRoutes, multiServiceVendorRoutes, runMultiServiceOrderSweep } from './multiServiceOrders.js'

function buildApp() {
  const app = express()
  app.use(express.json())
  app.use('/customer', multiServiceCustomerRoutes)
  app.use('/vendor', multiServiceVendorRoutes)
  app.use('/admin', multiServiceAdminRoutes)
  return app
}

beforeEach(() => {
  config.MULTI_SERVICE_ORDERS_ENABLED = true
  config.MULTI_SERVICE_MIN_APP_VERSION = '1.1.0'
  config.FULFILMENT_DELIVERY_CHARGE_PAISE = 0
  config.FULFILMENT_MINIMUM_CHARGE_PAISE = 0
  config.BUNDLE_DISCOUNT_PAISE = 0
  config.REQUIRE_BOOKING_PHONE_VERIFICATION = true
  mocks.role = 'customer'
  mocks.calls = []
  mocks.rpcCalls = []
  mocks.rpcResult = { data: null, error: null }
  mocks.respond.mockReset()
  mocks.respond.mockImplementation((table, operations) => {
    mocks.calls.push({ table, operations })
    if (table === 'service_types') return { data: [{ id: 'type-1', code: 'water_tanker', name: 'Water tanker', active: true, min_quantity: 1, max_quantity: 5, quantity_unit: 'load' }], error: null }
    if (table === 'guest_otp_challenges') return { data: { id: 'challenge-1' }, error: null }
    if (table === 'vendors') return { data: { id: 'vendor-1' }, error: null }
    if (table === 'orders') return { data: { id: 'order-1', customer_id: 'auth-user', legacy_booking_id: 'booking-1', reference: 'UT-ORDER', total_paise: 12500, status: 'partially_accepted' }, error: null }
    if (table === 'order_items') return { data: [{ id: 'item-1', order_id: 'order-1', status: 'accepted' }], error: null }
    if (table === 'order_fulfilments') return { data: [{ id: 'fulfilment-1', order_id: 'order-1', status: 'accepted' }], error: null }
    if (table === 'bookings') return { data: { customer_phone_e164: '+919876543210' }, error: null }
    return { data: null, error: null }
  })
  mocks.quote = {
    subtotalPaise: 10000,
    gstPaise: 1800,
    serviceAmountsPaise: [5900, 5900],
    invoiceLineItems: [
      { serviceCode: 'water_tanker', description: 'Water', quantity: 1, subtotalPaise: 5000, taxPaise: 900, taxRate: 0.18, discountPaise: 0, totalPaise: 5900 },
      { serviceCode: 'sewage_tanker', description: 'Sewage', quantity: 1, subtotalPaise: 5000, taxPaise: 900, taxRate: 0.18, discountPaise: 0, totalPaise: 5900 },
    ],
  }
})

describe('multi-service order contracts', () => {
  it('rejects clients below the configured app version before querying service data', async () => {
    const response = await request(buildApp()).get('/customer/service-types').set('x-app-version', '1.0.9')
    expect(response.status).toBe(426)
    expect(response.body).toMatchObject({ code: 'APP_UPDATE_REQUIRED', minAppVersion: '1.1.0' })
    expect(mocks.calls).toEqual([])
  })

  it('keeps new endpoints unavailable when the feature flag is disabled', async () => {
    config.MULTI_SERVICE_ORDERS_ENABLED = false
    const response = await request(buildApp()).get('/customer/service-types')
    expect(response.status).toBe(404)
    expect(mocks.calls).toEqual([])
  })

  it('exposes service quantity bounds and units for dynamic forms', async () => {
    const response = await request(buildApp()).get('/customer/service-types')
    expect(response.status).toBe(200)
    expect(response.body.rows[0]).toMatchObject({ min_quantity: 1, max_quantity: 5, quantity_unit: 'load', unit: 'load' })
  })

  it('creates one parent payment snapshot for multiple service items', async () => {
    mocks.respond.mockImplementation((table, operations) => {
      mocks.calls.push({ table, operations })
      if (table === 'service_types') return {
        data: [
          { id: 'type-1', code: 'water_tanker', name: 'Water tanker', min_quantity: 1, max_quantity: 5, quantity_unit: 'load', active: true },
          { id: 'type-2', code: 'sewage_tanker', name: 'Sewage tanker', min_quantity: 1, max_quantity: 5, quantity_unit: 'load', active: true },
        ], error: null,
      }
      if (table === 'guest_otp_challenges') return { data: { id: 'challenge-1' }, error: null }
      if (table === 'vendors' || table === 'vendor_services') return { data: [], error: null }
      if (table === 'order_items') return { data: [
        { id: 'item-1', service_type_id: 'type-1', latitude: null, longitude: null },
        { id: 'item-2', service_type_id: 'type-2', latitude: null, longitude: null },
      ], error: null }
      if (table === 'orders') return { data: { id: 'order-1', customer_id: 'auth-user', reference: 'UT-ORDER', total_paise: 11800, status: 'pending_vendor' }, error: null }
      if (table === 'order_fulfilments') return { data: [{ id: 'fulfilment-1', status: 'pending_vendor' }, { id: 'fulfilment-2', status: 'pending_vendor' }], error: null }
      return { data: [], error: null }
    })
    mocks.rpcResult = { data: { created: true, order: { id: 'order-1' }, legacyBookingId: 'booking-1' }, error: null }
    const response = await request(buildApp()).post('/customer/multi-service-orders').send({
      paymentMethod: 'cod',
      phone: '9876543210',
      phoneVerificationChallengeId: '11111111-1111-4111-8111-111111111111',
      items: [
        { serviceId: 'water_tanker', quantity: 1, location: '12 Main Road, Chennai', deliveryDate: '2026-12-01', details: {} },
        { serviceId: 'sewage_tanker', quantity: 1, location: '14 Main Road, Chennai', deliveryDate: '2026-12-01', details: {} },
      ],
    })
    expect(response.status).toBe(201)
    expect(response.body.items).toHaveLength(2)
    expect(response.body.fulfilments).toHaveLength(2)
    expect(mocks.rpcCalls[0]?.name).toBe('create_multi_service_order')
    const rpcArgs = mocks.rpcCalls[0]?.args as { p_order: Record<string, unknown>; p_items: unknown[]; p_payment: Record<string, unknown> }
    expect(rpcArgs.p_items).toHaveLength(2)
    expect(rpcArgs.p_order.total_paise).toBe(11800)
    expect(rpcArgs.p_payment).toMatchObject({ provider: 'cash_on_delivery', status: 'pending' })
  })

  it('returns an existing parent order without consuming another OTP on an idempotent retry', async () => {
    const response = await request(buildApp()).post('/customer/multi-service-orders').send({
      idempotencyKey: '11111111-1111-4111-8111-111111111111',
      paymentMethod: 'cod',
      items: [{ serviceId: 'water_tanker', quantity: 1, location: '12 Main Road, Chennai', deliveryDate: '2026-12-01' }],
    })
    expect(response.status).toBe(200)
    expect(response.body.legacyBookingId).toBe('booking-1')
    expect(mocks.rpcCalls).toEqual([])
    expect(mocks.calls.some((call) => call.table === 'guest_otp_challenges')).toBe(false)
  })

  it('returns parent orders with items and fulfilments', async () => {
    const response = await request(buildApp()).get('/customer/orders/order-1')
    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({
      id: 'order-1',
      items: [{ id: 'item-1' }],
      fulfilments: [{ id: 'fulfilment-1' }],
    })
    expect(mocks.calls.some((call) => call.table === 'orders' && call.operations.some((operation) => operation.name === 'eq' && operation.args[0] === 'customer_id' && operation.args[1] === 'auth-user'))).toBe(true)
  })

  it('returns a clean conflict when another vendor wins an acceptance race', async () => {
    mocks.role = 'vendor'
    mocks.rpcResult = { data: { accepted: false, reason: 'items_taken' }, error: null }
    const response = await request(buildApp()).post('/vendor/multi-service-orders/offers/offer-1/accept')
    expect(response.status).toBe(409)
    expect(response.body.error).toContain('already taken')
    expect(mocks.rpcCalls).toEqual([{ name: 'accept_multi_service_offer', args: { p_offer_id: 'offer-1', p_vendor_id: 'vendor-1' } }])
  })

  it('returns idempotent success for a repeated acceptance', async () => {
    mocks.role = 'vendor'
    mocks.rpcResult = { data: { accepted: true, idempotent: true, orderId: 'order-1' }, error: null }
    const response = await request(buildApp()).post('/vendor/multi-service-orders/offers/offer-1/accept')
    expect(response.status).toBe(200)
    expect(response.body).toEqual({ accepted: true, idempotent: true, orderId: 'order-1' })
  })

  it('scopes customer cancellation to both the parent and item IDs', async () => {
    mocks.rpcResult = { data: { cancelled: false, reason: 'already_accepted' }, error: null }
    const response = await request(buildApp()).delete('/customer/orders/order-1/items/item-1')
    expect(response.status).toBe(409)
    expect(mocks.calls.some((call) => call.table === 'order_items'
      && call.operations.some((operation) => operation.name === 'eq' && operation.args[0] === 'order_id' && operation.args[1] === 'order-1'))).toBe(true)
    expect(mocks.rpcCalls[0]).toEqual({
      name: 'cancel_multi_service_item',
      args: { p_item_id: 'item-1', p_customer_id: 'auth-user', p_reason: 'Customer cancelled before vendor acceptance' },
    })
  })

  it('returns the fulfilment-specific delivery OTP lockout to the assigned vendor', async () => {
    mocks.role = 'vendor'
    mocks.respond.mockImplementation((table, operations) => {
      mocks.calls.push({ table, operations })
      if (table === 'vendors') return { data: { id: 'vendor-1' }, error: null }
      if (table === 'order_fulfilments') return { data: { delivery_otp_hash: 'stored-hash' }, error: null }
      return { data: null, error: null }
    })
    mocks.rpcResult = { data: { verified: false, reason: 'locked' }, error: null }
    const response = await request(buildApp()).post('/vendor/multi-service-fulfilments/fulfilment-1/delivery/verify').send({ otp: '123456' })
    expect(response.status).toBe(429)
    expect(mocks.rpcCalls[0]?.name).toBe('claim_multi_service_delivery_attempt')
    expect((mocks.rpcCalls[0]?.args as Record<string, unknown>).p_vendor_id).toBe('vendor-1')
  })

  it('issues a delivery OTP through an ownership-scoped fulfilment RPC', async () => {
    mocks.respond.mockImplementation((table, operations) => {
      mocks.calls.push({ table, operations })
      if (table === 'orders') return { data: { id: 'order-1', legacy_booking_id: 'booking-1' }, error: null }
      if (table === 'order_fulfilments') return { data: { id: 'fulfilment-1', reference: 'UT-REF', status: 'arrived' }, error: null }
      if (table === 'bookings') return { data: { customer_phone_e164: '+919876543210' }, error: null }
      return { data: null, error: null }
    })
    mocks.rpcResult = { data: { issued: true, reference: 'UT-REF' }, error: null }
    const response = await request(buildApp()).post('/customer/orders/order-1/fulfilments/fulfilment-1/delivery-otp')
    expect(response.status).toBe(202)
    expect(response.body).not.toHaveProperty('otp')
    expect(mocks.rpcCalls[0]).toMatchObject({
      name: 'issue_multi_service_delivery_otp',
      args: { p_fulfilment_id: 'fulfilment-1', p_customer_id: 'auth-user' },
    })
  })

  it('scopes vendor drop to the vendor-owned fulfilment', async () => {
    mocks.role = 'vendor'
    mocks.rpcResult = { data: { dropped: false, reason: 'already_started' }, error: null }
    const response = await request(buildApp()).post('/vendor/multi-service-fulfilments/fulfilment-1/drop')
    expect(response.status).toBe(409)
    expect(mocks.rpcCalls[0]).toEqual({
      name: 'drop_multi_service_fulfilment',
      args: { p_fulfilment_id: 'fulfilment-1', p_vendor_id: 'vendor-1' },
    })
  })

  it('passes an audit reason to the admin reassignment transaction', async () => {
    mocks.role = 'admin'
    mocks.rpcResult = { data: { reassigned: true, orderId: 'order-1' }, error: null }
    const response = await request(buildApp()).post('/admin/multi-service-fulfilments/fulfilment-1/reassign')
      .send({ vendorId: '11111111-1111-4111-8111-111111111111', reason: 'Assigning qualified vendor' })
    expect(response.status).toBe(200)
    expect(mocks.rpcCalls[0]).toEqual({
      name: 'reassign_multi_service_fulfilment_admin',
      args: {
        p_fulfilment_id: 'fulfilment-1',
        p_vendor_id: '11111111-1111-4111-8111-111111111111',
        p_actor_id: 'auth-user',
        p_reason: 'Assigning qualified vendor',
      },
    })
  })

  it('expires and redispatches unassigned items with bundle and single-service offers', async () => {
      mocks.rpcResult = { data: { expiredOffers: 1, alerts: 2 }, error: null }
      let upsertedOffers: Array<Record<string, unknown>> = []
      mocks.respond.mockImplementation((table, operations) => {
        mocks.calls.push({ table, operations })
        if (table === 'order_fulfilments') {
          const deliveredQuery = operations.some((operation) => operation.name === 'eq' && operation.args[0] === 'status')
          return deliveredQuery
            ? { data: [], error: null }
            : { data: [{
              id: 'fulfilment-1', order_id: 'order-1',
              order_fulfilment_items: [
                { order_items: [{ id: 'item-1', service_type_id: 'water-type', latitude: null, longitude: null, status: 'pending_vendor' }] },
                { order_items: [{ id: 'item-2', service_type_id: 'sewage-type', latitude: null, longitude: null, status: 'pending_vendor' }] },
              ],
            }], error: null }
        }
        if (table === 'vendors') return { data: [
          { id: 'both-vendor', owner_profile_id: 'owner-both', latitude: null, longitude: null },
          { id: 'water-vendor', owner_profile_id: 'owner-water', latitude: null, longitude: null },
        ], error: null }
        if (table === 'vendor_services') return { data: [
          { vendor_id: 'both-vendor', service_type_id: 'water-type' },
          { vendor_id: 'both-vendor', service_type_id: 'sewage-type' },
          { vendor_id: 'water-vendor', service_type_id: 'water-type' },
        ], error: null }
        if (table === 'order_offers') {
          const upsert = operations.find((operation) => operation.name === 'upsert')
          if (upsert) {
            upsertedOffers = upsert.args[0] as Array<Record<string, unknown>>
            return { data: upsertedOffers.map((offer, index) => ({
              id: `offer-${index}`, vendor_id: offer.vendor_id, is_bundle: offer.is_bundle, fulfilment_id: offer.fulfilment_id,
            })), error: null }
          }
          return { data: [{ vendor_id: 'both-vendor', is_bundle: false, offer_scope_id: 'item-1', status: 'expired' }], error: null }
        }
        return { data: [], error: null }
      })
      const result = await runMultiServiceOrderSweep()
      expect(result).toMatchObject({ expiredOffers: 1, escalations: 2, dispatchedOrders: 1 })
      expect(upsertedOffers.some((offer) => offer.is_bundle === true && offer.vendor_id === 'both-vendor')).toBe(true)
      expect(upsertedOffers.some((offer) => offer.is_bundle === false && offer.vendor_id === 'water-vendor' && (offer.item_ids as string[]).includes('item-1'))).toBe(true)
      expect(upsertedOffers.some((offer) => offer.is_bundle === false && (offer.item_ids as string[]).includes('item-2') && offer.vendor_id === 'water-vendor')).toBe(false)
      expect(mocks.rpcCalls[0]).toEqual({
        name: 'sweep_multi_service_order_offers',
        args: { p_escalation_minutes: config.NO_VENDOR_ESCALATION_MINUTES },
    })
  })

  it('requires an audit reason for admin manual completion', async () => {
    mocks.role = 'admin'
    const response = await request(buildApp()).post('/admin/multi-service-fulfilments/fulfilment-1/complete').send({ reason: 'no' })
    expect(response.status).toBe(400)
    expect(mocks.rpcCalls).toEqual([])
  })
})
