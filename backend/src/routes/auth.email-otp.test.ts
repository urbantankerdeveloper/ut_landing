import express from 'express'
import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  respond: vi.fn((_table: string, _ops: Array<{ name: string; args: unknown[] }>): unknown => ({ data: null, error: null })),
  rpc: vi.fn(),
  createUser: vi.fn(),
  deleteUser: vi.fn(),
  signInWithPassword: vi.fn(),
  isEmailConfigured: vi.fn(() => true),
  sendEmail: vi.fn(),
  sendTemplateSms: vi.fn(),
}))

// Builds a chain like supabase-js. The final awaited call is answered by mocks.respond.
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
    rpc: (...args: unknown[]) => mocks.rpc(...args),
    storage: { from: () => ({ upload: vi.fn(), remove: vi.fn() }) },
  },
  authSupabase: {
    auth: {
      admin: {
        createUser: (...args: unknown[]) => mocks.createUser(...args),
        deleteUser: (...args: unknown[]) => mocks.deleteUser(...args),
        generateLink: vi.fn(),
        getUserById: vi.fn(),
      },
      signInWithPassword: (...args: unknown[]) => mocks.signInWithPassword(...args),
    },
  },
}))
vi.mock('express-rate-limit', () => ({ default: () => (_req: unknown, _res: unknown, next: () => void) => next() }))
vi.mock('../services/scaling.js', () => ({ limiterStore: () => undefined, getRedisPair: () => null }))
vi.mock('../middleware/auth.js', () => ({ requireAuth: (_req: unknown, _res: unknown, next: () => void) => next() }))
vi.mock('../services/providers.js', () => ({
  isEmailConfigured: () => mocks.isEmailConfigured(),
  sendEmail: (...args: unknown[]) => mocks.sendEmail(...args),
}))
vi.mock('../services/sms.js', () => ({ sendTemplateSms: (...args: unknown[]) => mocks.sendTemplateSms(...args) }))

import authRouter from './auth.js'
import { hashOtp } from '../services/otp.js'

const CHALLENGE = '11111111-1111-4111-8111-111111111111'
const EMAIL_CHALLENGE = '22222222-2222-4222-8222-222222222222'
const PHONE = '9876543210'

function buildApp() {
  const app = express()
  app.use(express.json())
  app.use(authRouter)
  return app
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  mocks.respond.mockReset()
  mocks.respond.mockImplementation((table, ops) => {
    const last = ops[ops.length - 1]?.name
    const hasInsert = ops.some((op) => op.name === 'insert')
    if (hasInsert && (table === 'email_otp_challenges' || table === 'guest_otp_challenges')) {
      return { data: { id: table === 'email_otp_challenges' ? EMAIL_CHALLENGE : CHALLENGE }, error: null }
    }
    if (last === 'maybeSingle' && table === 'email_otp_challenges') return { data: { id: EMAIL_CHALLENGE }, error: null }
    return { data: null, error: null }
  })
  mocks.rpc.mockReset()
  mocks.createUser.mockReset()
  mocks.createUser.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
  mocks.deleteUser.mockReset()
  mocks.deleteUser.mockResolvedValue({ error: null })
  mocks.signInWithPassword.mockReset()
  mocks.signInWithPassword.mockResolvedValue({ data: { session: { access_token: 'access-token', refresh_token: 'refresh-token' } }, error: null })
  mocks.isEmailConfigured.mockReturnValue(true)
  mocks.sendEmail.mockReset()
  mocks.sendEmail.mockResolvedValue({ queued: true })
  mocks.sendTemplateSms.mockReset()
  mocks.sendTemplateSms.mockResolvedValue({ queued: false, reason: 'SMS is not configured' })
})

describe('POST /signup', () => {
  const body = { email: 'new@example.com', password: 'longenough1', name: 'New User', phone: PHONE }

  it('creates an unconfirmed account and sends the email code, with the phone code skipped when SMS is off', async () => {
    const response = await request(buildApp()).post('/signup').send(body)
    expect(response.status).toBe(201)
    expect(response.body).toMatchObject({ requiresEmailVerification: true, emailSent: true, phoneOtpSent: false, phoneChallengeId: null, challengeId: EMAIL_CHALLENGE })
    expect(mocks.createUser).toHaveBeenCalledWith(expect.objectContaining({ email: 'new@example.com', email_confirm: false }))
    expect(mocks.sendEmail).toHaveBeenCalledWith('new@example.com', expect.any(String), expect.stringContaining('verification code'))
    expect(mocks.sendTemplateSms).toHaveBeenCalledWith('user_registration_otp', expect.any(String), expect.any(Object))
    expect(mocks.deleteUser).not.toHaveBeenCalled()
  })

  it('also returns a phone challenge when SMS is delivered', async () => {
    mocks.sendTemplateSms.mockResolvedValue({ queued: true, provider: 'msg91', requestId: 'req-1' })
    const response = await request(buildApp()).post('/signup').send(body)
    expect(response.status).toBe(201)
    expect(response.body).toMatchObject({ phoneOtpSent: true, phoneChallengeId: CHALLENGE })
  })

  it('still creates the account when the SMS provider throws', async () => {
    mocks.sendTemplateSms.mockRejectedValue(new Error('gateway down'))
    const response = await request(buildApp()).post('/signup').send(body)
    expect(response.status).toBe(201)
    expect(response.body.phoneOtpSent).toBe(false)
  })
})

describe('POST /guest/request-otp', () => {
  it('keeps the phone-only behaviour: 503 when SMS is off and no email is given', async () => {
    const response = await request(buildApp()).post('/guest/request-otp').send({ phone: PHONE })
    expect(response.status).toBe(503)
    expect(response.body.error).toBe('Mobile verification is not configured yet.')
    expect(mocks.sendEmail).not.toHaveBeenCalled()
  })

  it('sends an email code when SMS is off and an email is given', async () => {
    const response = await request(buildApp()).post('/guest/request-otp').send({ phone: PHONE, email: 'guest@example.com' })
    expect(response.status).toBe(202)
    expect(response.body).toMatchObject({ challengeId: null, phoneOtpSent: false, emailChallengeId: EMAIL_CHALLENGE, emailOtpSent: true })
    expect(mocks.sendEmail).toHaveBeenCalledWith('guest@example.com', expect.any(String), expect.any(String))
  })

  it('returns both challenges when SMS and email both go out', async () => {
    mocks.sendTemplateSms.mockResolvedValue({ queued: true, provider: 'msg91', requestId: 'req-2' })
    const response = await request(buildApp()).post('/guest/request-otp').send({ phone: PHONE, email: 'guest@example.com' })
    expect(response.status).toBe(202)
    expect(response.body).toMatchObject({ challengeId: CHALLENGE, phoneOtpSent: true, emailChallengeId: EMAIL_CHALLENGE, emailOtpSent: true })
  })

  it('returns 503 when neither channel can send', async () => {
    mocks.isEmailConfigured.mockReturnValue(false)
    const response = await request(buildApp()).post('/guest/request-otp').send({ phone: PHONE, email: 'guest@example.com' })
    expect(response.status).toBe(503)
  })
})

describe('POST /guest/verify-phone (booking, signed in)', () => {
  it('accepts the booking email code alone', async () => {
    mocks.rpc.mockResolvedValue({ data: [{ otp_hash: hashOtp('123456'), purpose: 'booking', user_id: null }], error: null })
    const response = await request(buildApp()).post('/guest/verify-phone').send({
      phone: PHONE,
      email: 'guest@example.com',
      emailChallengeId: EMAIL_CHALLENGE,
      emailOtp: '123456',
    })
    expect(response.status).toBe(200)
    expect(response.body).toEqual({ verified: true })
  })

  it('rejects a wrong email code', async () => {
    mocks.rpc.mockResolvedValue({ data: [{ otp_hash: hashOtp('123456'), purpose: 'booking', user_id: null }], error: null })
    const response = await request(buildApp()).post('/guest/verify-phone').send({
      phone: PHONE,
      email: 'guest@example.com',
      emailChallengeId: EMAIL_CHALLENGE,
      emailOtp: '654321',
    })
    expect(response.status).toBe(400)
    expect(response.body.error).toBe('The verification code is incorrect.')
  })

  it('requires a code from either channel', async () => {
    const response = await request(buildApp()).post('/guest/verify-phone').send({ phone: PHONE })
    expect(response.status).toBe(400)
  })
})

describe('POST /guest/verify-otp', () => {
  it('signs in a guest with the email code alone when SMS is off', async () => {
    mocks.rpc.mockResolvedValue({ data: [{ otp_hash: hashOtp('123456'), purpose: 'booking', user_id: null }], error: null })
    const response = await request(buildApp()).post('/guest/verify-otp').send({
      phone: PHONE,
      email: 'guest@example.com',
      emailChallengeId: EMAIL_CHALLENGE,
      emailOtp: '123456',
    })
    expect(response.status).toBe(200)
    expect(response.body.accessToken).toBe('access-token')
    expect(mocks.rpc).toHaveBeenCalledWith('consume_email_otp_attempt', expect.objectContaining({ p_purposes: ['booking'], p_email: 'guest@example.com' }))
  })

  it('rejects a wrong email code', async () => {
    mocks.rpc.mockResolvedValue({ data: [{ otp_hash: hashOtp('123456'), purpose: 'booking', user_id: null }], error: null })
    const response = await request(buildApp()).post('/guest/verify-otp').send({
      phone: PHONE,
      email: 'guest@example.com',
      emailChallengeId: EMAIL_CHALLENGE,
      emailOtp: '654321',
    })
    expect(response.status).toBe(400)
    expect(response.body.error).toBe('The verification code is incorrect.')
    expect(mocks.createUser).not.toHaveBeenCalled()
  })

  it('requires at least one challenge', async () => {
    const response = await request(buildApp()).post('/guest/verify-otp').send({ phone: PHONE, otp: '123456' })
    expect(response.status).toBe(400)
  })

  it('requires the email address with an email challenge', async () => {
    const response = await request(buildApp()).post('/guest/verify-otp').send({ phone: PHONE, emailChallengeId: EMAIL_CHALLENGE, emailOtp: '123456' })
    expect(response.status).toBe(400)
    expect(response.body.error).toBe('Enter the verification code sent to your email.')
  })
})
