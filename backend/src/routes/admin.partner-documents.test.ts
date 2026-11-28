import express from 'express'
import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { config } from '../config.js'

const mocks = vi.hoisted(() => ({
  respond: vi.fn<(table: string, ops: Array<{ name: string; args: unknown[] }>) => unknown>(),
  createSignedUrl: vi.fn(),
  reportBookings: [] as Array<Record<string, unknown>>,
  reportFulfilments: [] as Array<Record<string, unknown>>,
  reportVendors: [] as Array<{ id: string; business_name: string }>,
  reportQueries: [] as Array<Array<{ name: string; args: unknown[] }>>,
  partnerApplication: {
    id: '44444444-4444-4444-8444-444444444444',
    status: 'submitted',
    email: 'vendor@example.com',
    business_name: 'Example Vendor',
    reference: 'PA-100',
  } as Record<string, unknown>,
  notifyVendorByEmail: vi.fn(),
}))

function chain(table: string, ops: Array<{ name: string; args: unknown[] }> = []): unknown {
  return new Proxy({}, {
    get(_target, prop) {
      if (prop === 'then') {
        return (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
          Promise.resolve(mocks.respond(table, ops)).then(resolve, reject)
      }
      return (...args: unknown[]) => chain(table, [...ops, { name: String(prop), args }])
    },
  })
}

vi.mock('../supabase.js', () => ({
  supabase: {
    from: (table: string) => chain(table),
    storage: {
      from: () => ({ createSignedUrl: (...args: unknown[]) => mocks.createSignedUrl(...args) }),
    },
  },
  authSupabase: { auth: { admin: {} } },
}))
vi.mock('../middleware/auth.js', () => ({
  requireAuth: (_request: object, _response: unknown, next: () => void) => next(),
  requireRole: () => (request: object, _response: unknown, next: () => void) => {
    Object.assign(request, { authUser: { id: 'admin-test-id' } })
    next()
  },
}))
vi.mock('../services/vendorNotifications.js', () => ({
  notifyVendorByEmail: (...args: unknown[]) => mocks.notifyVendorByEmail(...args),
}))

import adminRouter from './admin.js'

const APPLICATION_ID = '44444444-4444-4444-8444-444444444444'
const multiServiceOrdersEnabled = config.MULTI_SERVICE_ORDERS_ENABLED

function buildApp() {
  const app = express()
  app.use(express.json())
  app.use(adminRouter)
  return app
}

beforeEach(() => {
  config.MULTI_SERVICE_ORDERS_ENABLED = multiServiceOrdersEnabled
  mocks.reportBookings = []
  mocks.reportFulfilments = []
  mocks.reportVendors = []
  mocks.reportQueries = []
  mocks.partnerApplication = {
    id: APPLICATION_ID,
    status: 'submitted',
    email: 'vendor@example.com',
    business_name: 'Example Vendor',
    reference: 'PA-100',
  }
  mocks.notifyVendorByEmail.mockReset()
  mocks.notifyVendorByEmail.mockResolvedValue(undefined)
  mocks.createSignedUrl.mockReset()
  mocks.createSignedUrl.mockResolvedValue({
    data: { signedUrl: 'https://storage.example/download' },
    error: null,
  })
  mocks.respond.mockReset()
  mocks.respond.mockImplementation((table, operations) => {
    if (table === 'bookings') mocks.reportQueries.push(operations)
    if (table === 'partner_applications') {
      const update = operations.find((operation) => operation.name === 'update')?.args[0] as Record<string, unknown> | undefined
      if (update) mocks.partnerApplication = { ...mocks.partnerApplication, ...update }
      return { data: mocks.partnerApplication, error: null }
    }
    if (table === 'bookings') return { data: mocks.reportBookings, error: null }
    if (table === 'order_fulfilments') return { data: mocks.reportFulfilments, error: null }
    if (table === 'vendors') return { data: mocks.reportVendors, error: null }
    if (table === 'partner_application_history') {
      return {
        data: [{
          id: 'history-1',
          application_id: APPLICATION_ID,
          action: 'reviewed',
          old_status: 'submitted',
          new_status: 'under_review',
          review_note: 'Checking documents',
          created_at: '2026-11-18T10:00:00.000Z',
        }],
        error: null,
      }
    }
    if (table === 'documents') {
      return {
        data: [{
          id: 'document-1',
          document_type: 'application/pdf',
          object_key: 'partner-applications/batch/33333333-3333-4333-8333-333333333333-vehicle-registration.pdf',
        }],
        error: null,
      }
    }
    return { data: null, error: null }
  })
})

describe('GET /partner-applications/:id/history', () => {
  it('returns the append-only application review history', async () => {
    const response = await request(buildApp()).get(`/partner-applications/${APPLICATION_ID}/history`)
    expect(response.status).toBe(200)
    expect(response.body).toEqual([expect.objectContaining({
      action: 'reviewed',
      old_status: 'submitted',
      new_status: 'under_review',
      review_note: 'Checking documents',
    })])
  })

  it('rejects invalid application identifiers before querying the database', async () => {
    const response = await request(buildApp()).get('/partner-applications/not-a-uuid/history')
    expect(response.status).toBe(400)
    expect(mocks.respond).not.toHaveBeenCalled()
  })
})

describe('PATCH /partner-applications/:id', () => {
  it('emails the applicant once when the application is approved', async () => {
    const app = buildApp()
    const patch = () => request(app)
      .patch(`/partner-applications/${APPLICATION_ID}`)
      .send({ status: 'approved' })

    expect((await patch()).status).toBe(200)
    expect((await patch()).status).toBe(200)
    expect(mocks.notifyVendorByEmail).toHaveBeenCalledTimes(1)
    expect(mocks.notifyVendorByEmail).toHaveBeenCalledWith(
      'vendor@example.com',
      'vendor_application_approved',
      expect.objectContaining({ businessName: 'Example Vendor', reference: 'PA-100' }),
      'partner_application_approved',
    )
  })

  it('accepts the additional-information review status and records the review note', async () => {
    const response = await request(buildApp())
      .patch(`/partner-applications/${APPLICATION_ID}`)
      .send({ status: 'additional_info_required', reviewNote: 'Please upload vehicle insurance.' })
    expect(response.status).toBe(200)
    const update = mocks.respond.mock.calls.find(([table, ops]) =>
      table === 'partner_applications' && ops.some((operation) => operation.name === 'update'),
    )
    expect(update?.[1].find((operation) => operation.name === 'update')?.args[0]).toMatchObject({
      status: 'additional_info_required',
      review_note: 'Please upload vehicle insurance.',
    })
  })
})

describe('POST /reports', () => {
  it('rejects reversed date ranges before querying report data', async () => {
    const response = await request(buildApp()).post('/reports').send({
      type: 'revenue',
      from: '2026-11-18',
      to: '2026-11-01',
    })
    expect(response.status).toBe(400)
    expect(mocks.respond.mock.calls.some(([table]) => table === 'bookings')).toBe(false)
  })

  it('applies selected date and category filters and returns an empty report safely', async () => {
    const response = await request(buildApp()).post('/reports').send({
      type: 'revenue',
      from: '2026-11-01',
      to: '2026-11-18',
      status: 'delivered',
      service: 'Water tanker',
      customerType: 'guest',
    })
    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({ type: 'revenue', rows: [], total: 0 })
    const reportQuery = mocks.respond.mock.calls.find(([table]) => table === 'bookings')
    expect(reportQuery?.[1]).toEqual(expect.arrayContaining([
      { name: 'gte', args: ['created_at', '2026-11-01T00:00:00.000Z'] },
      { name: 'lte', args: ['created_at', '2026-11-18T23:59:59.999Z'] },
      { name: 'eq', args: ['status', 'delivered'] },
      { name: 'eq', args: ['service_code', 'Water tanker'] },
      { name: 'eq', args: ['customer_type', 'guest'] },
    ]))
  })

  it('filters revenue rows by the selected vendor on the server', async () => {
    const vendorId = '55555555-5555-4555-8555-555555555555'
    const response = await request(buildApp()).post('/reports').send({
      type: 'revenue',
      from: '2026-11-01',
      to: '2026-11-18',
      vendorId,
    })
    expect(response.status).toBe(200)
    expect(mocks.reportQueries[0]).toContainEqual({
      name: 'eq',
      args: ['vendor_id', vendorId],
    })
  })

  it('includes vendor multi-service quotes without double-counting legacy bookings', async () => {
    const vendorId = '55555555-5555-4555-8555-555555555555'
    config.MULTI_SERVICE_ORDERS_ENABLED = true
    mocks.reportBookings = [{
      id: 'booking-1',
      vendor_id: vendorId,
      service_code: 'WATER',
      quoted_amount_paise: 90000,
      created_at: '2026-11-18T10:00:00.000Z',
    }]
    mocks.reportFulfilments = [
      {
        id: 'legacy-fulfilment',
        legacy_booking_id: 'booking-1',
        created_at: '2026-11-18T10:00:00.000Z',
        order_fulfilment_items: [{
          order_items: {
            locked_price_paise: 90000,
            service_types: { code: 'WATER' },
          },
        }],
      },
      {
        id: 'multi-fulfilment',
        created_at: '2026-11-18T11:00:00.000Z',
        orders: { customer_id: 'customer-1' },
        order_fulfilment_items: [{
          order_items: {
            locked_price_paise: 8000,
            delivery_charge_paise: 200,
            discount_paise: 100,
            service_types: { code: 'SEWAGE' },
          },
        }],
      },
    ]

    const response = await request(buildApp()).post('/reports').send({
      type: 'revenue',
      from: '2026-11-01',
      to: '2026-11-18',
      vendorId,
    })

    expect(response.status).toBe(200)
    expect(response.body.total).toBe(981)
    expect(response.body.rows).toHaveLength(2)
    expect(response.body.rows[1]).toMatchObject({
      id: 'multi-fulfilment',
      vendor_id: vendorId,
      service_code: 'SEWAGE',
      quoted_amount_paise: 8100,
    })
  })

  it('rejects vendor filtering for non-revenue report types', async () => {
    const response = await request(buildApp()).post('/reports').send({
      type: 'orders',
      from: '2026-11-01',
      to: '2026-11-18',
      vendorId: '55555555-5555-4555-8555-555555555555',
    })

    expect(response.status).toBe(400)
    expect(mocks.respond.mock.calls.some(([table]) => table === 'bookings')).toBe(false)
  })

  it('groups vendor performance by assigned vendor and includes completion totals', async () => {
    mocks.reportBookings = [
      { vendor_id: 'vendor-1', quoted_amount_paise: 12000, status: 'delivered' },
      { vendor_id: 'vendor-1', quoted_amount_paise: 3000, status: 'in_progress' },
      { vendor_id: 'vendor-2', quoted_amount_paise: 5000, status: 'in_progress' },
    ]
    mocks.reportVendors = [
      { id: 'vendor-1', business_name: 'Water Works' },
      { id: 'vendor-2', business_name: 'City Tankers' },
    ]
    const response = await request(buildApp()).post('/reports').send({
      type: 'vendors',
      from: '2026-11-01',
      to: '2026-11-18',
    })
    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({
      type: 'vendors',
      total: 200,
      rows: [
        {
          vendor_id: 'vendor-1',
          business_name: 'Water Works',
          booking_count: 2,
          completed_count: 1,
          quoted_amount_paise: 15000,
        },
        {
          vendor_id: 'vendor-2',
          business_name: 'City Tankers',
          booking_count: 1,
          completed_count: 0,
          quoted_amount_paise: 5000,
        },
      ],
    })
  })
})

describe('GET /partner-applications/:id/documents', () => {
  it('returns short-lived download URLs for the application documents', async () => {
    const response = await request(buildApp()).get(`/partner-applications/${APPLICATION_ID}/documents`)
    expect(response.status).toBe(200)
    expect(response.body).toEqual([{
      id: 'document-1',
      name: 'vehicle-registration.pdf',
      documentType: 'application/pdf',
      downloadUrl: 'https://storage.example/download',
      expiresInSeconds: 300,
    }])
    expect(mocks.createSignedUrl).toHaveBeenCalledWith(
      'partner-applications/batch/33333333-3333-4333-8333-333333333333-vehicle-registration.pdf',
      300,
    )
  })

  it('rejects invalid application identifiers', async () => {
    const response = await request(buildApp()).get('/partner-applications/not-a-uuid/documents')
    expect(response.status).toBe(400)
    expect(mocks.respond).not.toHaveBeenCalled()
  })
})
