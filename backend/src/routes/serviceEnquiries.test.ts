import express from 'express'
import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  respond: vi.fn<(table: string, operations: Array<{ name: string; args: unknown[] }>) => unknown>(),
  loggerError: vi.fn(),
  realtime: vi.fn(),
  submitted: [] as Array<Record<string, unknown>>,
  notificationError: null as { message: string } | null,
  enquiryError: null as { message: string } | null,
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
  supabase: { from: (table: string) => chain(table) },
}))
vi.mock('../services/scaling.js', () => ({ limiterStore: () => undefined }))
vi.mock('../services/realtime.js', () => ({
  emitRealtimeToAdmins: (...args: unknown[]) => mocks.realtime(...args),
}))
vi.mock('../lib/logger.js', () => ({ logger: { error: (...args: unknown[]) => mocks.loggerError(...args) } }))
vi.mock('express-rate-limit', () => ({
  default: () => (_request: unknown, _response: unknown, next: () => void) => next(),
}))

import serviceEnquiriesRouter from './serviceEnquiries.js'

const validPayload = {
  customerName: 'Ananya Rao',
  mobile: '9876543210',
  email: 'ananya@example.com',
  location: '12 Lake View Road, Chennai',
  requiredDate: '2099-05-21',
  serviceCategory: 'rmc',
  details: {
    grade: 'M25',
    quantityCubicMetres: 12.5,
    pumpRequired: true,
    requirements: 'Deliver before the site crew starts.',
  },
}

function buildApp() {
  const app = express()
  app.use(express.json())
  app.use('/service-enquiries', serviceEnquiriesRouter)
  return app
}

beforeEach(() => {
  mocks.respond.mockReset()
  mocks.loggerError.mockReset()
  mocks.realtime.mockReset()
  mocks.submitted = []
  mocks.notificationError = null
  mocks.enquiryError = null
  mocks.respond.mockImplementation((table, operations) => {
    const insert = operations.find((operation) => operation.name === 'insert')
    if (table === 'enquiries' && insert) {
      mocks.submitted.push(insert.args[0] as Record<string, unknown>)
      return mocks.enquiryError
        ? { data: null, error: mocks.enquiryError }
        : {
            data: {
              id: 'enquiry-1',
              subject: String((insert.args[0] as Record<string, unknown>).subject),
              status: 'new',
              created_at: '2099-05-21T09:00:00.000Z',
            },
            error: null,
          }
    }
    if (table === 'profiles') return { data: [{ id: 'admin-1' }], error: null }
    if (table === 'notifications') return { data: null, error: mocks.notificationError }
    return { data: null, error: null }
  })
})

describe('POST /service-enquiries', () => {
  it('stores validated service-specific details and alerts administrators', async () => {
    const response = await request(buildApp())
      .post('/service-enquiries')
      .send(validPayload)

    expect(response.status).toBe(201)
    expect(response.body).toMatchObject({
      id: 'enquiry-1',
      status: 'new',
      notificationStatus: 'created',
    })
    expect(mocks.submitted).toHaveLength(1)
    expect(mocks.submitted[0]).toMatchObject({
      customer_name: 'Ananya Rao',
      mobile_e164: '+919876543210',
      email: 'ananya@example.com',
      location: '12 Lake View Road, Chennai',
      service_category: 'rmc',
      required_date: '2099-05-21',
      service_details: validPayload.details,
    })
    expect(mocks.submitted[0]?.message).toContain('Concrete quantity (m³): 12.5')
    expect(mocks.realtime).toHaveBeenCalledWith('enquiry.created', {
      enquiryId: 'enquiry-1',
      serviceCategory: 'rmc',
      status: 'new',
    })
  })

  it('accepts empty tanker capacity and service requirements', async () => {
    const response = await request(buildApp())
      .post('/service-enquiries')
      .send({
        ...validPayload,
        serviceCategory: 'empty_tanker',
        details: { capacityLitres: 12000, requirements: 'Dedicated tanker for a site project.' },
      })

    expect(response.status).toBe(201)
    expect(mocks.submitted[0]).toMatchObject({
      service_category: 'empty_tanker',
      service_details: { capacityLitres: 12000 },
    })
  })

  it('accepts borewell depth and site requirements', async () => {
    const response = await request(buildApp())
      .post('/service-enquiries')
      .send({
        ...validPayload,
        serviceCategory: 'borewell',
        details: { proposedDepthMetres: 60, siteRequirements: 'Rig access from the east gate.' },
      })

    expect(response.status).toBe(201)
    expect(mocks.submitted[0]).toMatchObject({
      service_category: 'borewell',
      service_details: { proposedDepthMetres: 60 },
    })
  })

  it('rejects invalid service-specific data before writing to the database', async () => {
    const response = await request(buildApp())
      .post('/service-enquiries')
      .send({
        ...validPayload,
        serviceCategory: 'borewell',
        details: { proposedDepthMetres: -1, siteRequirements: '' },
      })

    expect(response.status).toBe(400)
    expect(mocks.submitted).toHaveLength(0)
  })

  it('reports notification failure without losing the saved enquiry', async () => {
    mocks.notificationError = { message: 'notification insert failed' }

    const response = await request(buildApp())
      .post('/service-enquiries')
      .send(validPayload)

    expect(response.status).toBe(201)
    expect(response.body.notificationStatus).toBe('unavailable')
    expect(mocks.submitted).toHaveLength(1)
    expect(mocks.loggerError).toHaveBeenCalledWith(
      'service_enquiry.notification_failed',
      expect.objectContaining({ enquiryId: 'enquiry-1' }),
    )
    expect(mocks.realtime).not.toHaveBeenCalled()
  })

  it('does not report success when the enquiry itself could not be saved', async () => {
    mocks.enquiryError = { message: 'database unavailable' }

    const response = await request(buildApp())
      .post('/service-enquiries')
      .send(validPayload)

    expect(response.status).toBe(500)
    expect(response.body.error).toContain('could not be saved')
    expect(mocks.loggerError).toHaveBeenCalledWith(
      'service_enquiry.create_failed',
      expect.any(Object),
    )
    expect(mocks.realtime).not.toHaveBeenCalled()
  })
})
