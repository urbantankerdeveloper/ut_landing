import express from 'express'
import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  booking: null as Record<string, unknown> | null,
  rpc: vi.fn(),
}))

function chain(table: string, operations: Array<{ name: string; args: unknown[] }> = []): unknown {
  const result = () => {
    if (table === 'bookings') return { data: mocks.booking, error: null }
    if (table === 'service_catalog') return { data: { name: 'Water tanker' }, error: null }
    if (table === 'booking_events') return { data: [], error: null }
    if (table === 'vendor_location_updates') return { data: null, error: null }
    if (table === 'guest_otp_challenges' && operations.some((operation) => operation.name === 'select')) return { data: { id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11' }, error: null }
    return { data: null, error: null }
  }
  return new Proxy({}, {
    get(_target, property) {
      if (property === 'then') return (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => Promise.resolve(result()).then(resolve, reject)
      if (property === 'maybeSingle') return () => Promise.resolve(result())
      return (...args: unknown[]) => chain(table, [...operations, { name: String(property), args }])
    },
  })
}

vi.mock('../supabase.js', () => ({
  supabase: {
    from: (table: string) => chain(table),
    rpc: (...args: unknown[]) => mocks.rpc(...args),
  },
}))
vi.mock('../services/scaling.js', () => ({ limiterStore: () => undefined }))
vi.mock('../services/sms.js', () => ({ sendTemplateSms: vi.fn() }))
vi.mock('../services/whatsapp.js', () => ({ sendTemplateWhatsApp: vi.fn() }))

import { config } from '../config.js'
import { hashOtp } from '../services/otp.js'
import publicTrackingRouter from './publicTracking.js'

const bookingId = 'c0a80123-4567-489a-8abc-123456789012'
const challengeId = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'

function buildApp() {
  return express().use(express.json()).use('/api/public', publicTrackingRouter)
}

beforeEach(() => {
  mocks.booking = {
    id: bookingId,
    reference: 'UT-100',
    status: 'accepted',
    service_code: 'water_tanker',
    scheduled_for: '2026-11-29T10:00:00.000Z',
    vehicle_id: null,
    driver_id: null,
  }
  mocks.rpc.mockImplementation(async (procedure: string) => {
    if (procedure === 'claim_guest_otp_challenge') {
      return { data: [{ challenge_id: challengeId, delivery_channel: null, is_new: true }], error: null }
    }
    if (procedure === 'consume_guest_otp_attempt') return { data: [{ otp_hash: hashOtp('123456') }], error: null }
    return { data: null, error: null }
  })
  config.USE_DEFAULT_VERIFICATION_CODE = true
})

describe('public order tracking lookup', () => {
  it('reveals tracking details only after the registered phone OTP is verified', async () => {
    const app = buildApp()
    const requested = await request(app).post('/api/public/tracking/request-otp').send({ reference: 'ut-100', phone: '9876543210' })
    expect(requested.status).toBe(202)
    expect(requested.body.message).toMatch(/if the order reference and phone number match/i)

    const verified = await request(app).post('/api/public/tracking/verify-otp').send({
      reference: 'UT-100',
      phone: '9876543210',
      challengeId,
      otp: '123456',
    })
    expect(verified.status).toBe(200)
    expect(verified.body).toMatchObject({
      bookingReference: 'UT-100',
      status: 'accepted',
      serviceName: 'Water tanker',
    })
    expect(verified.body).toHaveProperty('accessToken')
    expect(verified.body).not.toHaveProperty('phone')
    expect(verified.body).not.toHaveProperty('address')
    expect(verified.body).not.toHaveProperty('customer_id')
  })

  it('uses the same request response for unknown order references and rejects invalid verification', async () => {
    mocks.booking = null
    const app = buildApp()
    const requested = await request(app).post('/api/public/tracking/request-otp').send({ reference: 'UT-999', phone: '9876543210' })
    expect(requested.status).toBe(202)
    expect(requested.body.message).toMatch(/if the order reference and phone number match/i)

    const verified = await request(app).post('/api/public/tracking/verify-otp').send({
      reference: 'UT-999',
      phone: '9876543210',
      challengeId: requested.body.challengeId,
      otp: '123456',
    })
    expect(verified.status).toBe(400)
    expect(verified.body.error).toMatch(/could not be verified/i)
  })

  it('rejects tampered short-lived tracking access tokens', async () => {
    const app = buildApp()
    const verified = await request(app).post('/api/public/tracking/verify-otp').send({
      reference: 'UT-100',
      phone: '9876543210',
      challengeId,
      otp: '123456',
    })
    const denied = await request(app).post('/api/public/tracking/details').send({
      reference: 'UT-100',
      accessToken: `${verified.body.accessToken}.tampered`,
    })
    expect(denied.status).toBe(401)
  })
})
