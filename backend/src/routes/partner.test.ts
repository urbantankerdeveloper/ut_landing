import express from 'express'
import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  respond: vi.fn<(table: string, ops: Array<{ name: string; args: unknown[] }>) => unknown>(),
  createSignedUploadUrl: vi.fn(),
  registeredDocuments: [] as Array<{ object_key: string; document_type: string }>,
  existingApplication: null as { id: string } | null,
  notificationError: false,
  admins: [{ id: 'admin-1' }],
  featureFlags: { partner_application_otp_enabled: true },
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
      from: () => ({
        createSignedUploadUrl: (...args: unknown[]) => mocks.createSignedUploadUrl(...args),
      }),
    },
  },
}))
vi.mock('../config.js', () => ({ config: { featureFlags: mocks.featureFlags } }))
vi.mock('express-rate-limit', () => ({ default: () => (_req: unknown, _res: unknown, next: () => void) => next() }))
vi.mock('../services/scaling.js', () => ({ limiterStore: () => undefined }))
vi.mock('../lib/logger.js', () => ({ logger: { error: vi.fn() } }))

import partnerRouter from './partner.js'

const CHALLENGE = '11111111-1111-4111-8111-111111111111'
const UPLOAD_BATCH = '33333333-3333-4333-8333-333333333333'
const APPLICATION_ID = '44444444-4444-4444-8444-444444444444'
const application = {
  businessName: 'Water Works',
  partnerType: 'Fleet operator',
  phone: '9876543210',
  email: 'owner@example.com',
  zone: 'Adyar',
  address: '12 Main Road, Chennai',
  serviceCodes: ['Water tanker'],
  vehicleCount: 1,
  registration: 'TN 09 AB 1234',
  capacity: '6 KL',
  availability: 'Available for new orders',
}

function buildApp() {
  const app = express()
  app.use(express.json())
  app.use(partnerRouter)
  return app
}

beforeEach(() => {
  mocks.featureFlags.partner_application_otp_enabled = true
  mocks.respond.mockReset()
  mocks.createSignedUploadUrl.mockReset()
  mocks.createSignedUploadUrl.mockResolvedValue({ data: { token: 'upload-token', signedUrl: 'https://storage.example/upload' }, error: null })
  mocks.registeredDocuments = []
  mocks.existingApplication = null
  mocks.notificationError = false
  mocks.admins = [{ id: 'admin-1' }]
  mocks.respond.mockImplementation((table, ops) => {
    if (table === 'guest_otp_challenges') return { data: { id: CHALLENGE }, error: null }
    if (table === 'documents') {
      const insert = ops.find((operation) => operation.name === 'insert')
      if (insert) mocks.registeredDocuments.push(insert.args[0] as { object_key: string; document_type: string })
      if (ops.some((operation) => operation.name === 'select')) return { data: mocks.registeredDocuments, error: null }
      return { data: null, error: null }
    }
    if (table === 'partner_applications') {
      if (ops.some((operation) => operation.name === 'insert')) return { data: { id: APPLICATION_ID, reference: 'PA-12345678', status: 'submitted' }, error: null }
      return { data: mocks.existingApplication, error: null }
    }
    if (table === 'profiles') return { data: mocks.admins, error: null }
    if (table === 'notifications') return { data: null, error: mocks.notificationError ? { code: 'NOTIFY_FAILED' } : null }
    return { data: null, error: null }
  })
})

describe('POST /documents/signed-url', () => {
  it('requires a verified phone challenge before preparing a public upload', async () => {
    const response = await request(buildApp()).post('/documents/signed-url').send({
      uploadBatchId: UPLOAD_BATCH,
      fileName: 'Vehicle registration.pdf',
      contentType: 'application/pdf',
      size: 1024,
    })
    expect(response.status).toBe(400)
    expect(response.body.error).toBe('Upload an allowed document type up to 10 MB.')
    expect(mocks.createSignedUploadUrl).not.toHaveBeenCalled()
  })

  it('creates a constrained public upload path and records its application batch', async () => {
    const response = await request(buildApp()).post('/documents/signed-url').send({
      uploadBatchId: UPLOAD_BATCH,
      phoneChallengeId: CHALLENGE,
      phone: application.phone,
      fileName: 'Vehicle registration.pdf',
      contentType: 'application/pdf',
      size: 1024,
    })
    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({
      token: 'upload-token',
      signedUrl: 'https://storage.example/upload',
      contentType: 'application/pdf',
      maxBytes: 10 * 1024 * 1024,
    })
    expect(response.body.path).toMatch(new RegExp(`^partner-applications/${UPLOAD_BATCH}/[0-9a-f-]+-Vehicle-registration\\.pdf$`))
    expect(mocks.createSignedUploadUrl).toHaveBeenCalledWith(response.body.path)
    expect(mocks.registeredDocuments).toEqual([expect.objectContaining({
      owner_type: 'partner_application_upload',
      owner_id: UPLOAD_BATCH,
      object_key: response.body.path,
      document_type: 'application/pdf',
    })])
  })

  it('rejects a mismatched file extension and content type', async () => {
    const response = await request(buildApp()).post('/documents/signed-url').send({
      uploadBatchId: UPLOAD_BATCH,
      phoneChallengeId: CHALLENGE,
      phone: application.phone,
      fileName: 'Vehicle registration.pdf',
      contentType: 'image/png',
      size: 1024,
    })
    expect(response.status).toBe(400)
    expect(mocks.createSignedUploadUrl).not.toHaveBeenCalled()
  })
})

describe('POST /applications', () => {
  it('requires a phone challenge when partner application OTP is enabled', async () => {
    const response = await request(buildApp()).post('/applications').send(application)
    expect(response.status).toBe(400)
    expect(response.body.error).toBe('Verify your mobile number before submitting the application.')
    expect(mocks.respond).not.toHaveBeenCalled()
  })

  it('rejects a second active application for the same mobile number', async () => {
    mocks.existingApplication = { id: APPLICATION_ID }
    const response = await request(buildApp()).post('/applications').send({
      ...application,
      phoneChallengeId: CHALLENGE,
    })
    expect(response.status).toBe(409)
    expect(response.body.error).toContain('active application already exists')
    expect(mocks.respond.mock.calls.some(([table, ops]) =>
      table === 'partner_applications' && ops.some((operation) => operation.name === 'insert'),
    )).toBe(false)
  })

  it('accepts a recently verified challenge matching the application phone', async () => {
    const response = await request(buildApp()).post('/applications').send({
      ...application,
      phoneChallengeId: CHALLENGE,
    })
    expect(response.status).toBe(201)
    expect(response.body).toMatchObject({ ok: true, reference: 'PA-12345678', status: 'submitted' })
    const challengeQuery = mocks.respond.mock.calls.find(([table]) => table === 'guest_otp_challenges')
    expect(challengeQuery?.[1]).toEqual(expect.arrayContaining([
      { name: 'eq', args: ['id', CHALLENGE] },
      { name: 'eq', args: ['phone_e164', '+919876543210'] },
      { name: 'not', args: ['verified_at', 'is', null] },
    ]))
    expect(mocks.respond.mock.calls.some(([table]) => table === 'partner_applications')).toBe(true)
  })

  it('stores the supplied details and documents for each vehicle', async () => {
    const vehicles = [{
      registrationNumber: 'TN 09 AB 1234',
      vehicleType: 'Water tanker',
      serviceCategory: 'Water tanker',
      capacity: '6 KL',
      availability: 'Available for new orders',
      documents: [],
    }]
    const response = await request(buildApp()).post('/applications').send({
      ...application,
      phoneChallengeId: CHALLENGE,
      vehicles,
    })
    expect(response.status).toBe(201)
    const insert = mocks.respond.mock.calls.find(([table, ops]) =>
      table === 'partner_applications' && ops.some((operation) => operation.name === 'insert'),
    )
    expect(insert?.[1].find((operation) => operation.name === 'insert')?.args[0]).toMatchObject({
      vehicle_count: 1,
      vehicle_details: vehicles,
    })
  })

  it('creates an internal admin notification after saving the application', async () => {
    const response = await request(buildApp()).post('/applications').send({
      ...application,
      phoneChallengeId: CHALLENGE,
    })
    expect(response.status).toBe(201)
    expect(response.body.notificationStatus).toBe('created')
    const notification = mocks.respond.mock.calls.find(([table, ops]) =>
      table === 'notifications' && ops.some((operation) => operation.name === 'insert'),
    )
    expect(notification?.[1].find((operation) => operation.name === 'insert')?.args[0]).toMatchObject([
      {
        recipient_id: 'admin-1',
        event_type: 'partner.application_submitted',
        payload: { applicationId: APPLICATION_ID, status: 'submitted' },
      },
    ])
  })

  it('keeps the application when admin notification creation fails', async () => {
    mocks.notificationError = true
    const response = await request(buildApp()).post('/applications').send({
      ...application,
      phoneChallengeId: CHALLENGE,
    })
    expect(response.status).toBe(201)
    expect(response.body).toMatchObject({
      ok: true,
      reference: 'PA-12345678',
      notificationStatus: 'unavailable',
    })
    expect(mocks.respond.mock.calls.some(([table, ops]) =>
      table === 'partner_applications' && ops.some((operation) => operation.name === 'insert'),
    )).toBe(true)
  })

  it('rejects incomplete or duplicate per-vehicle registrations', async () => {
    const vehicle = {
      registrationNumber: 'TN 09 AB 1234',
      vehicleType: 'Water tanker',
      serviceCategory: 'Water tanker',
      capacity: '6 KL',
      availability: 'Available for new orders',
      documents: [],
    }
    const incomplete = await request(buildApp()).post('/applications').send({
      ...application,
      phoneChallengeId: CHALLENGE,
      vehicleCount: 2,
      vehicles: [vehicle],
    })
    expect(incomplete.status).toBe(400)

    const duplicate = await request(buildApp()).post('/applications').send({
      ...application,
      phoneChallengeId: CHALLENGE,
      vehicleCount: 2,
      vehicles: [vehicle, { ...vehicle, registrationNumber: 'TN09AB1234' }],
    })
    expect(duplicate.status).toBe(400)
    expect(mocks.respond.mock.calls.some(([table, ops]) =>
      table === 'partner_applications' && ops.some((operation) => operation.name === 'insert'),
    )).toBe(false)
  })

  it('attaches only documents uploaded for this application batch', async () => {
    const upload = await request(buildApp()).post('/documents/signed-url').send({
      uploadBatchId: UPLOAD_BATCH,
      phoneChallengeId: CHALLENGE,
      phone: application.phone,
      fileName: 'Vehicle registration.pdf',
      contentType: 'application/pdf',
      size: 1024,
    })
    const response = await request(buildApp()).post('/applications').send({
      ...application,
      phoneChallengeId: CHALLENGE,
      uploadBatchId: UPLOAD_BATCH,
      documents: [{ path: upload.body.path, type: 'application/pdf' }],
    })
    expect(response.status).toBe(201)
    const attach = mocks.respond.mock.calls.find(([table, ops]) =>
      table === 'documents' && ops.some((operation) => operation.name === 'update'),
    )
    expect(attach?.[1]).toEqual(expect.arrayContaining([
      { name: 'eq', args: ['owner_type', 'partner_application_upload'] },
      { name: 'eq', args: ['owner_id', UPLOAD_BATCH] },
      { name: 'in', args: ['object_key', [upload.body.path]] },
    ]))
  })

  it('preserves the legacy submission path while the feature flag is off', async () => {
    mocks.featureFlags.partner_application_otp_enabled = false
    const response = await request(buildApp()).post('/applications').send(application)
    expect(response.status).toBe(201)
    expect(mocks.respond.mock.calls.some(([table, ops]) =>
      table === 'partner_applications' && ops.some((operation) => operation.name === 'insert'),
    )).toBe(true)
  })
})
