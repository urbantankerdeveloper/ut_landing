import express from 'express'
import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  respond: vi.fn<(table: string, ops: Array<{ name: string; args: unknown[] }>) => unknown>(),
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
  supabase: { from: (table: string) => chain(table) },
}))
vi.mock('../config.js', () => ({ config: { featureFlags: mocks.featureFlags } }))
vi.mock('express-rate-limit', () => ({ default: () => (_req: unknown, _res: unknown, next: () => void) => next() }))
vi.mock('../services/scaling.js', () => ({ limiterStore: () => undefined }))
vi.mock('../lib/logger.js', () => ({ logger: { error: vi.fn() } }))

import partnerRouter from './partner.js'

const CHALLENGE = '11111111-1111-4111-8111-111111111111'
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
  mocks.respond.mockImplementation((table) => {
    if (table === 'guest_otp_challenges') return { data: { id: CHALLENGE }, error: null }
    if (table === 'partner_applications') return { data: { reference: 'PA-12345678', status: 'submitted' }, error: null }
    return { data: null, error: null }
  })
})

describe('POST /applications', () => {
  it('requires a phone challenge when partner application OTP is enabled', async () => {
    const response = await request(buildApp()).post('/applications').send(application)
    expect(response.status).toBe(400)
    expect(response.body.error).toBe('Verify your mobile number before submitting the application.')
    expect(mocks.respond).not.toHaveBeenCalled()
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

  it('preserves the legacy submission path while the feature flag is off', async () => {
    mocks.featureFlags.partner_application_otp_enabled = false
    const response = await request(buildApp()).post('/applications').send(application)
    expect(response.status).toBe(201)
    expect(mocks.respond).toHaveBeenCalledTimes(1)
    expect(mocks.respond.mock.calls[0]?.[0]).toBe('partner_applications')
  })
})
