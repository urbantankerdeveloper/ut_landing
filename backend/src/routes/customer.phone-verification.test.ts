import express from 'express'
import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  userId: 'customer-phone-user',
  currentEmail: 'customer@example.com',
  phoneProfile: { phone_e164: null as string | null, phone_verified: false, phone_verified_at: null as string | null },
  bookingChallengeAvailable: false,
  bookingChallengeConsumed: false,
  emailChallengeAvailable: false,
  emailChallengeConsumed: false,
  emailUpdates: [] as Array<{ email: string; email_confirm: boolean }>,
  calls: [] as Array<{ table: string; operations: Array<{ name: string; args: unknown[] }> }>,
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
    auth: {
      admin: {
        getUserById: async () => ({ data: { user: { email: mocks.currentEmail } }, error: null }),
        updateUserById: async (_userId: string, attributes: { email: string; email_confirm: boolean }) => {
          mocks.emailUpdates.push(attributes)
          return { error: null }
        },
      },
    },
  },
}))
vi.mock('../middleware/auth.js', () => ({
  requireAuth: (request: object, _response: unknown, next: () => void) => {
    Object.assign(request, { authUser: { id: mocks.userId, email: 'customer@example.com' } })
    next()
  },
}))
vi.mock('../services/scaling.js', () => ({ limiterStore: () => undefined }))

import customerRouter from './customer.js'
import { config } from '../config.js'

function buildApp() {
  const app = express()
  app.use(express.json())
  app.use(customerRouter)
  return app
}

beforeEach(() => {
  config.PHONE_VERIFY_DIALOG_ENABLED = false
  config.PHONE_VERIFY_REQUIRED_AFTER = undefined
  config.REQUIRE_BOOKING_PHONE_VERIFICATION = true
  mocks.phoneProfile = { phone_e164: null, phone_verified: false, phone_verified_at: null }
  mocks.currentEmail = 'customer@example.com'
  mocks.bookingChallengeAvailable = false
  mocks.bookingChallengeConsumed = false
  mocks.emailChallengeAvailable = false
  mocks.emailChallengeConsumed = false
  mocks.emailUpdates = []
  mocks.calls = []
  mocks.respond.mockReset()
  mocks.respond.mockImplementation((table, operations) => {
    mocks.calls.push({ table, operations })
    if (table === 'profiles') return { data: mocks.phoneProfile, error: null }
    if (table === 'guest_otp_challenges') {
      const bookingChallenge = operations.some((operation) =>
        operation.name === 'eq' && operation.args[0] === 'template_key' && operation.args[1] === 'booking_verification_otp',
      )
      if (bookingChallenge && operations.some((operation) => operation.name === 'update')) {
        if (!mocks.bookingChallengeAvailable || mocks.bookingChallengeConsumed) return { data: null, error: null }
        mocks.bookingChallengeConsumed = true
        return { data: { id: '11111111-1111-4111-8111-111111111111' }, error: null }
      }
      return {
        data: bookingChallenge
          ? mocks.bookingChallengeAvailable && !mocks.bookingChallengeConsumed
            ? { id: '11111111-1111-4111-8111-111111111111' }
            : null
          : { id: '11111111-1111-4111-8111-111111111111' },
        error: null,
      }
    }
    if (table === 'email_otp_challenges' && operations.some((operation) => operation.name === 'delete')) {
      if (!mocks.emailChallengeAvailable || mocks.emailChallengeConsumed) {
        return { data: null, error: null }
      }
      mocks.emailChallengeConsumed = true
      return { data: { id: '22222222-2222-4222-8222-222222222222' }, error: null }
    }
    return { data: null, error: null }
  })
})

describe('account phone verification on customer orders', () => {
  it('rejects unverified accounts after the deadline when the dialog flag is enabled', async () => {
    config.PHONE_VERIFY_DIALOG_ENABLED = true
    config.PHONE_VERIFY_REQUIRED_AFTER = new Date(Date.now() - 1_000).toISOString()

    const response = await request(buildApp()).post('/orders').send({})

    expect(response.status).toBe(403)
    expect(response.body).toEqual({
      code: 'PHONE_NOT_VERIFIED',
      error: 'Verify your account phone number before placing an order.',
    })
    expect(mocks.calls).toEqual([expect.objectContaining({ table: 'profiles' })])
  })

  it('does not enforce the account requirement while the feature flag is off', async () => {
    config.PHONE_VERIFY_REQUIRED_AFTER = new Date(Date.now() - 1_000).toISOString()

    const response = await request(buildApp()).post('/orders').send({})

    expect(response.status).toBe(400)
    expect(response.body.error).toBe('Invalid booking')
    expect(mocks.calls).toEqual([])
  })

  it('still requires a fresh per-order contact OTP when the account phone is verified', async () => {
    config.PHONE_VERIFY_DIALOG_ENABLED = true
    config.PHONE_VERIFY_REQUIRED_AFTER = new Date(Date.now() - 1_000).toISOString()
    mocks.phoneProfile = { phone_e164: '+919876543210', phone_verified: true, phone_verified_at: new Date().toISOString() }

    const response = await request(buildApp()).post('/orders').send({
      serviceId: 'water_tanker',
      capacity: '6000 litres',
      location: '12 Main Road, Chennai',
      deliveryDate: new Date(Date.now() + 24 * 60 * 60_000).toISOString().slice(0, 10),
      phone: '9876543210',
      phoneVerificationChallengeId: '11111111-1111-4111-8111-111111111111',
      paymentMethod: 'cod',
    })

    expect(response.status).toBe(400)
    expect(response.body.error).toContain('Verify the contact number')
    expect(mocks.calls.map(({ table }) => table)).toContain('guest_otp_challenges')
    const challengeQuery = mocks.calls.find(({ table }) => table === 'guest_otp_challenges')?.operations
    expect(challengeQuery).toContainEqual({ name: 'eq', args: ['template_key', 'booking_verification_otp'] })
    expect(mocks.calls.some(({ table }) => table === 'bookings')).toBe(false)
  })

  it('does not present an account-verification challenge as per-order verification', async () => {
    config.REQUIRE_BOOKING_PHONE_VERIFICATION = true
    mocks.phoneProfile = { phone_e164: '+919876543210', phone_verified: true, phone_verified_at: new Date().toISOString() }

    const response = await request(buildApp()).get('/phone-verification')

    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({ phoneVerified: true, verified: false, challengeId: null, required: true })
    const challengeQuery = mocks.calls.find(({ table }) => table === 'guest_otp_challenges')?.operations
    expect(challengeQuery).toContainEqual({ name: 'eq', args: ['template_key', 'booking_verification_otp'] })
    expect(challengeQuery).toContainEqual({ name: 'is', args: ['user_id', null] })
  })

  it('does not replace a verified account phone until the new number has its own OTP challenge', async () => {
    mocks.phoneProfile = {
      phone_e164: '+919999999999',
      phone_verified: true,
      phone_verified_at: new Date().toISOString(),
    }

    const response = await request(buildApp()).patch('/profile').send({
      name: 'Customer Name',
      email: 'customer@example.com',
      phone: '9876543210',
    })

    expect(response.status).toBe(400)
    expect(response.body.error).toContain('Verify the new mobile number')
    expect(mocks.calls.some(({ table, operations }) =>
      table === 'profiles' && operations.some((operation) => operation.name === 'update'),
    )).toBe(false)
  })

  it('requires a verified email challenge before changing the account email', async () => {
    const response = await request(buildApp()).patch('/profile').send({
      name: 'Customer Name',
      email: 'new@example.com',
    })

    expect(response.status).toBe(400)
    expect(response.body.error).toContain('Verify the new email address')
    expect(mocks.emailUpdates).toEqual([])
    expect(mocks.calls.some(({ table, operations }) =>
      table === 'profiles' && operations.some((operation) => operation.name === 'update'),
    )).toBe(false)
  })

  it('consumes a verified email challenge before saving an account email change', async () => {
    mocks.emailChallengeAvailable = true

    const response = await request(buildApp()).patch('/profile').send({
      name: 'Customer Name',
      email: 'new@example.com',
      emailVerificationChallengeId: '22222222-2222-4222-8222-222222222222',
    })

    expect(response.status).toBe(200)
    expect(response.body.email).toBe('new@example.com')
    expect(mocks.emailChallengeConsumed).toBe(true)
    expect(mocks.emailUpdates).toEqual([{ email: 'new@example.com', email_confirm: true }])
    expect(mocks.calls.some(({ table, operations }) =>
      table === 'profiles' && operations.some((operation) => operation.name === 'update'),
    )).toBe(true)
  })

  it('consumes a verified booking OTP so a second order must request a new one', async () => {
    config.PHONE_VERIFY_DIALOG_ENABLED = true
    config.PHONE_VERIFY_REQUIRED_AFTER = new Date(Date.now() - 1_000).toISOString()
    mocks.phoneProfile = {
      phone_e164: '+919876543210',
      phone_verified: true,
      phone_verified_at: new Date().toISOString(),
    }
    mocks.bookingChallengeAvailable = true
    const body = {
      serviceId: 'water_tanker',
      capacity: '6000 litres',
      location: '12 Main Road, Chennai',
      deliveryDate: new Date(Date.now() + 24 * 60 * 60_000).toISOString().slice(0, 10),
      phone: '9876543210',
      phoneVerificationChallengeId: '11111111-1111-4111-8111-111111111111',
      paymentMethod: 'cod',
    }

    const first = await request(buildApp()).post('/orders').send(body)
    const second = await request(buildApp()).post('/orders').send(body)

    expect(first.body.error).not.toContain('Verify the contact number')
    expect(second.status).toBe(400)
    expect(second.body.error).toContain('Verify the contact number')
    const claims = mocks.calls.filter(({ table, operations }) =>
      table === 'guest_otp_challenges' && operations.some((operation) => operation.name === 'update'),
    )
    expect(claims).toHaveLength(2)
    expect(claims[0]?.operations).toContainEqual({ name: 'is', args: ['consumed_at', null] })
  })
})
