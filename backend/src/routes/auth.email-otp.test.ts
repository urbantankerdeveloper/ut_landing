import express from 'express'
import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  respond: vi.fn<(table: string, ops: Array<{ name: string; args: unknown[] }>) => unknown>(() => ({ data: null, error: null })),
  rpc: vi.fn(),
  createUser: vi.fn(),
  deleteUser: vi.fn(),
  updateUserById: vi.fn(),
  generateLink: vi.fn(),
  verifyOtp: vi.fn(),
  signInWithPassword: vi.fn(),
  isEmailConfigured: vi.fn(() => true),
  sendEmail: vi.fn(),
  sendTemplateWhatsApp: vi.fn(),
  sendTemplateSms: vi.fn(),
  recentPhoneChallenge: null as null | { id: string; delivery_channel: string; created_at: string; expires_at: string },
  authUser: {
    id: 'user-1',
    email: 'guest@example.com',
    email_confirmed_at: '2026-01-01T00:00:00.000Z',
  },
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
        updateUserById: (...args: unknown[]) => mocks.updateUserById(...args),
        generateLink: (...args: unknown[]) => mocks.generateLink(...args),
        getUserById: vi.fn(),
      },
      verifyOtp: (...args: unknown[]) => mocks.verifyOtp(...args),
      signInWithPassword: (...args: unknown[]) => mocks.signInWithPassword(...args),
    },
  },
}))
vi.mock('express-rate-limit', () => ({ default: () => (_req: unknown, _res: unknown, next: () => void) => next() }))
vi.mock('../services/scaling.js', () => ({ limiterStore: () => undefined, getRedisPair: () => null }))
vi.mock('../middleware/auth.js', () => ({
  requireAuth: (request: object, _response: unknown, next: () => void) => {
    Object.assign(request, { authUser: mocks.authUser })
    next()
  },
}))
vi.mock('../services/sms.js', () => ({
  sendTemplateSms: (...args: unknown[]) => mocks.sendTemplateSms(...args),
}))
vi.mock('../services/providers.js', () => ({
  isEmailConfigured: () => mocks.isEmailConfigured(),
  sendEmail: (...args: unknown[]) => mocks.sendEmail(...args),
}))
vi.mock('../services/whatsapp.js', () => ({ sendTemplateWhatsApp: (...args: unknown[]) => mocks.sendTemplateWhatsApp(...args) }))

import authRouter from './auth.js'
import { hashOtp } from '../services/otp.js'
import { config } from '../config.js'

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
    if (last === 'maybeSingle' && table === 'guest_otp_challenges') {
      return { data: ops.some((op) => op.name === 'gte') ? mocks.recentPhoneChallenge : { id: CHALLENGE }, error: null }
    }
    return { data: null, error: null }
  })
  mocks.rpc.mockReset()
  mocks.rpc.mockImplementation(async (procedure) => {
    if (procedure !== 'claim_guest_otp_challenge') return { data: null, error: null }
    const now = new Date()
    const recent = mocks.recentPhoneChallenge
    return {
      data: [{
        challenge_id: recent?.id ?? CHALLENGE,
        delivery_channel: recent?.delivery_channel ?? 'pending',
        created_at: recent?.created_at ?? now.toISOString(),
        expires_at: recent?.expires_at ?? new Date(now.getTime() + 600_000).toISOString(),
        is_new: recent == null,
      }],
      error: null,
    }
  })
  mocks.sendTemplateWhatsApp.mockReset()
  mocks.sendTemplateWhatsApp.mockResolvedValue({ queued: false, reason: 'WhatsApp unavailable' })
  mocks.sendTemplateSms.mockReset()
  mocks.sendTemplateSms.mockResolvedValue({ queued: false, reason: 'SMS unavailable' })
  mocks.recentPhoneChallenge = null
  config.featureFlags.otp_sms_fallback_enabled = true
  mocks.createUser.mockReset()
  mocks.createUser.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
  mocks.deleteUser.mockReset()
  mocks.deleteUser.mockResolvedValue({ error: null })
  mocks.updateUserById.mockReset()
  mocks.updateUserById.mockResolvedValue({ data: { user: { id: 'user-1', email: 'new@example.com' } }, error: null })
  mocks.generateLink.mockReset()
  mocks.generateLink.mockResolvedValue({ data: { properties: { hashed_token: 'magic-token' } }, error: null })
  mocks.verifyOtp.mockReset()
  mocks.verifyOtp.mockResolvedValue({ data: { session: { access_token: 'access-token', refresh_token: 'refresh-token' }, user: { id: 'user-1', email: 'new@example.com' } }, error: null })
  mocks.signInWithPassword.mockReset()
  mocks.signInWithPassword.mockResolvedValue({ data: { session: { access_token: 'access-token', refresh_token: 'refresh-token' } }, error: null })
  mocks.isEmailConfigured.mockReturnValue(true)
  mocks.sendEmail.mockReset()
  mocks.sendEmail.mockResolvedValue({ queued: true })
  mocks.sendTemplateWhatsApp.mockReset()
  mocks.sendTemplateWhatsApp.mockResolvedValue({ queued: false, reason: 'Combirds WhatsApp is not configured' })
  mocks.authUser.id = 'user-1'
  mocks.authUser.email = 'guest@example.com'
  mocks.authUser.email_confirmed_at = '2026-01-01T00:00:00.000Z'
})

describe('POST /signup', () => {
  const body = { email: 'new@example.com', password: 'longenough1', name: 'New User', phone: PHONE }

  it('creates an unconfirmed account and sends the email code, with the phone code skipped when SMS is off', async () => {
    const response = await request(buildApp()).post('/signup').send(body)
    expect(response.status).toBe(201)
    expect(response.body).toMatchObject({ requiresEmailVerification: true, emailSent: true, phoneOtpSent: false, phoneChallengeId: null, challengeId: EMAIL_CHALLENGE })
    expect(mocks.createUser).toHaveBeenCalledWith(expect.objectContaining({ email: 'new@example.com', email_confirm: false }))
    expect(mocks.sendEmail).toHaveBeenCalledWith('new@example.com', expect.any(String), expect.stringContaining('verification code'))
    expect(mocks.sendTemplateWhatsApp).toHaveBeenCalledWith('user_registration_otp', expect.any(String), expect.any(Object))
    expect(mocks.deleteUser).not.toHaveBeenCalled()
  })

  it('also returns a phone challenge when SMS is delivered', async () => {
    mocks.sendTemplateWhatsApp.mockResolvedValue({ queued: true, provider: 'combirds-whatsapp', requestId: 'req-1' })
    const response = await request(buildApp()).post('/signup').send(body)
    expect(response.status).toBe(201)
    expect(response.body).toMatchObject({ phoneOtpSent: true, phoneChallengeId: CHALLENGE })
    expect(mocks.sendTemplateWhatsApp).toHaveBeenCalledWith(
      'user_registration_otp',
      '+919876543210',
      expect.any(Object),
    )
  })

  it('still creates the account when the SMS provider throws', async () => {
    mocks.sendTemplateWhatsApp.mockRejectedValue(new Error('gateway down'))
    const response = await request(buildApp()).post('/signup').send(body)
    expect(response.status).toBe(201)
    expect(response.body.phoneOtpSent).toBe(false)
  })
})

describe('partner phone OTP', () => {
  it('issues a public registration OTP challenge for the partner phone', async () => {
    mocks.sendTemplateWhatsApp.mockResolvedValue({ queued: true, provider: 'combirds-whatsapp', requestId: 'req-1' })
    const response = await request(buildApp()).post('/partner/request-otp').send({ phone: PHONE })
    expect(response.status).toBe(202)
    expect(response.body).toMatchObject({ challengeId: CHALLENGE, expiresInSeconds: 600 })
    expect(mocks.sendTemplateWhatsApp).toHaveBeenCalledWith(
      'user_registration_otp',
      '+919876543210',
      expect.any(Object),
    )
  })

  it('marks a valid partner phone challenge verified', async () => {
    mocks.rpc.mockResolvedValue({ data: [{ otp_hash: hashOtp('654321') }], error: null })
    const response = await request(buildApp()).post('/partner/verify-otp').send({
      challengeId: CHALLENGE,
      phone: PHONE,
      otp: '654321',
    })
    expect(response.status).toBe(200)
    expect(response.body).toEqual({ verified: true })
    expect(mocks.rpc).toHaveBeenCalledWith(
      'consume_guest_otp_attempt',
      { p_challenge_id: CHALLENGE, p_phone: '+919876543210' },
    )
  })

  it('rejects an incorrect partner phone code', async () => {
    mocks.rpc.mockResolvedValue({ data: [{ otp_hash: hashOtp('123456') }], error: null })
    const response = await request(buildApp()).post('/partner/verify-otp').send({
      challengeId: CHALLENGE,
      phone: PHONE,
      otp: '654321',
    })
    expect(response.status).toBe(400)
    expect(response.body.error).toBe('The verification code is incorrect.')
  })
})

describe('POST /email/verify-otp signup phone verification', () => {
    it('rejects a duplicate phone before creating an email-OTP signup account', async () => {
      mocks.rpc.mockImplementation(async (procedure: string) => {
        if (procedure === 'consume_email_otp_attempt') {
          return { data: [{ otp_hash: hashOtp('123456'), purpose: 'signup', user_id: null }], error: null }
        }
        if (procedure === 'consume_guest_otp_attempt') {
          return { data: [{ otp_hash: hashOtp('654321') }], error: null }
        }
        return { data: null, error: null }
      })
      mocks.respond.mockImplementation((table, ops) => {
        const last = ops[ops.length - 1]?.name
        const hasEq = (column: string, value: string) => ops.some(
          (op) => op.name === 'eq' && op.args[0] === column && op.args[1] === value,
        )
        if (table === 'profiles' && last === 'maybeSingle' && hasEq('phone_e164', '+919876543210')) {
          return { data: { id: 'another-user' }, error: null }
        }
        if (table === 'email_otp_challenges' && last === 'maybeSingle') {
          return { data: { id: EMAIL_CHALLENGE }, error: null }
        }
        return { data: null, error: null }
      })

      const response = await request(buildApp()).post('/email/verify-otp').send({
        challengeId: EMAIL_CHALLENGE,
        email: 'new@example.com',
        otp: '123456',
        name: 'New User',
        phone: PHONE,
        phoneChallengeId: CHALLENGE,
        phoneOtp: '654321',
      })

      expect(response.status).toBe(409)
      expect(response.body.error).toBe('This mobile number is already registered. Try signing in instead.')
      expect(mocks.createUser).not.toHaveBeenCalled()
      expect(mocks.rpc).toHaveBeenCalledWith(
        'consume_guest_otp_attempt',
        expect.objectContaining({ p_phone: '+919876543210', p_challenge_id: CHALLENGE }),
      )
    })

    it('rejects an already-verified phone only after the SMS challenge passes', async () => {
      mocks.rpc.mockImplementation(async (procedure: string) => {
        if (procedure === 'consume_email_otp_attempt') {
          return { data: [{ otp_hash: hashOtp('123456'), purpose: 'signup', user_id: 'user-1' }], error: null }
        }
        if (procedure === 'consume_guest_otp_attempt') {
          return { data: [{ otp_hash: hashOtp('654321') }], error: null }
        }
        return { data: null, error: null }
      })
      mocks.respond.mockImplementation((table, ops) => {
        const last = ops[ops.length - 1]?.name
        const hasEq = (column: string, value: string) => ops.some(
          (op) => op.name === 'eq' && op.args[0] === column && op.args[1] === value,
        )
        if (table === 'profiles' && last === 'maybeSingle' && hasEq('id', 'user-1')) {
          return {
            data: {
              id: 'user-1',
              role: 'customer',
              full_name: 'New User',
              username: 'new',
              phone_e164: null,
              theme_mode: null,
              selfie_required: false,
              approval_status: 'approved',
            },
            error: null,
          }
        }
        if (table === 'profiles' && last === 'maybeSingle' && hasEq('phone_e164', '+919876543210')) {
          return { data: { id: 'another-user' }, error: null }
        }
        if (table === 'email_otp_challenges' && last === 'maybeSingle') {
          return { data: { id: EMAIL_CHALLENGE }, error: null }
        }
        return { data: null, error: null }
      })

      const response = await request(buildApp()).post('/email/verify-otp').send({
        challengeId: EMAIL_CHALLENGE,
        email: 'new@example.com',
        otp: '123456',
        phone: PHONE,
        phoneChallengeId: CHALLENGE,
        phoneOtp: '654321',
      })

      expect(response.status).toBe(409)
      expect(response.body.error).toBe('This mobile number is already registered. Try signing in instead.')
      expect(mocks.createUser).not.toHaveBeenCalled()
      expect(mocks.rpc).toHaveBeenCalledWith(
        'consume_guest_otp_attempt',
        expect.objectContaining({ p_phone: '+919876543210', p_challenge_id: CHALLENGE }),
      )
    })

    it('marks the profile phone verified only after the SMS challenge passes', async () => {
      mocks.rpc.mockImplementation(async (procedure: string) => {
        if (procedure === 'consume_email_otp_attempt') {
          return { data: [{ otp_hash: hashOtp('123456'), purpose: 'signup', user_id: 'user-1' }], error: null }
        }
        if (procedure === 'consume_guest_otp_attempt') {
          return { data: [{ otp_hash: hashOtp('654321') }], error: null }
        }
        return { data: null, error: null }
      })
      mocks.respond.mockImplementation((table, ops) => {
        const last = ops[ops.length - 1]?.name
        const hasEq = (column: string, value: string) => ops.some(
          (op) => op.name === 'eq' && op.args[0] === column && op.args[1] === value,
        )
        if (table === 'profiles' && last === 'maybeSingle' && hasEq('id', 'user-1')) {
          return {
            data: {
              id: 'user-1',
              role: 'customer',
              full_name: 'New User',
              username: 'new',
              phone_e164: null,
              theme_mode: null,
              selfie_required: false,
              approval_status: 'approved',
            },
            error: null,
          }
        }
        if (table === 'profiles' && last === 'maybeSingle' && hasEq('phone_e164', '+919876543210')) {
          return { data: null, error: null }
        }
        if (last === 'maybeSingle' && table === 'email_otp_challenges') {
          return { data: { id: EMAIL_CHALLENGE }, error: null }
        }
        if (last === 'maybeSingle' && table === 'guest_otp_challenges') {
          return { data: { id: CHALLENGE }, error: null }
        }
        return { data: null, error: null }
      })

      const response = await request(buildApp()).post('/email/verify-otp').send({
        challengeId: EMAIL_CHALLENGE,
        email: 'new@example.com',
        otp: '123456',
        phone: PHONE,
        phoneChallengeId: CHALLENGE,
        phoneOtp: '654321',
      })

      expect(response.status).toBe(200)
      expect(mocks.respond).toHaveBeenCalledWith(
        'profiles',
        expect.arrayContaining([
          expect.objectContaining({
            name: 'update',
            args: [expect.objectContaining({
              phone_e164: '+919876543210',
              phone_verified_at: expect.any(String),
            })],
          }),
        ]),
      )
  })
})

describe('POST /guest/request-otp', () => {
  it('creates a guest challenge and queues the OTP through Combirds WhatsApp', async () => {
    mocks.sendTemplateWhatsApp.mockResolvedValue({ queued: true, provider: 'combirds-whatsapp', requestId: 'guest-otp-1' })
    const response = await request(buildApp()).post('/guest/request-otp').send({ phone: PHONE })
    expect(response.status).toBe(202)
    expect(response.body).toMatchObject({ challengeId: CHALLENGE, channel: 'whatsapp', expiresInSeconds: 600 })
    expect(mocks.sendTemplateWhatsApp).toHaveBeenCalledWith('booking_verification_otp', '+919876543210', expect.objectContaining({ otp: expect.any(String) }))
  })

  it('falls back to SMS with the same code when Combirds rejects a send', async () => {
    mocks.sendTemplateSms.mockResolvedValue({ queued: true, provider: 'msg91', requestId: 'sms-1' })
    const response = await request(buildApp()).post('/phone/request-otp').send({ phone: PHONE })
    expect(response.status).toBe(202)
    expect(response.body).toMatchObject({ challengeId: CHALLENGE, channel: 'sms' })
    expect(mocks.sendTemplateWhatsApp).toHaveBeenCalledTimes(1)
    expect(mocks.sendTemplateSms).toHaveBeenCalledWith(
      'user_registration_otp',
      '+919876543210',
      mocks.sendTemplateWhatsApp.mock.calls[0]?.[2],
    )
  })

  it('allows disabling WhatsApp-to-SMS fallback with the feature flag', async () => {
    config.featureFlags.otp_sms_fallback_enabled = false
    const response = await request(buildApp()).post('/phone/request-otp').send({ phone: PHONE })
    expect(response.status).toBe(503)
    expect(mocks.sendTemplateWhatsApp).toHaveBeenCalledTimes(1)
    expect(mocks.sendTemplateSms).not.toHaveBeenCalled()
  })

  it('does not send duplicates when the same phone retries inside the cooldown', async () => {
    const now = new Date()
    mocks.recentPhoneChallenge = {
      id: CHALLENGE,
      delivery_channel: 'whatsapp',
      created_at: new Date(now.getTime() - 5_000).toISOString(),
      expires_at: new Date(now.getTime() + 595_000).toISOString(),
    }
    const response = await request(buildApp()).post('/phone/request-otp').send({ phone: PHONE })
    expect(response.status).toBe(202)
    expect(response.body).toMatchObject({ challengeId: CHALLENGE, channel: 'whatsapp' })
    expect(mocks.sendTemplateWhatsApp).not.toHaveBeenCalled()
    expect(mocks.sendTemplateSms).not.toHaveBeenCalled()
  })

  it('keeps the phone-only behavior: 503 when both providers fail and no email is given', async () => {
    const response = await request(buildApp()).post('/guest/request-otp').send({ phone: PHONE })
    expect(response.status).toBe(503)
    expect(response.body.error).toBe('OTP delivery failed.')
    expect(mocks.sendEmail).not.toHaveBeenCalled()
  })

  it('sends an email code when SMS is off and an email is given', async () => {
    const response = await request(buildApp()).post('/guest/request-otp').send({ phone: PHONE, email: 'guest@example.com' })
    expect(response.status).toBe(202)
    expect(response.body).toMatchObject({ challengeId: null, phoneOtpSent: false, phoneOtpChannel: null, emailChallengeId: EMAIL_CHALLENGE, emailOtpSent: true })
    expect(mocks.sendEmail).toHaveBeenCalledWith('guest@example.com', expect.any(String), expect.any(String))
  })

  it('returns both challenges when SMS and email both go out', async () => {
    mocks.sendTemplateWhatsApp.mockResolvedValue({ queued: true, provider: 'combirds-whatsapp', requestId: 'req-2' })
    const response = await request(buildApp()).post('/guest/request-otp').send({ phone: PHONE, email: 'guest@example.com' })
    expect(response.status).toBe(202)
    expect(response.body).toMatchObject({ challengeId: CHALLENGE, phoneOtpSent: true, phoneOtpChannel: 'whatsapp', emailChallengeId: EMAIL_CHALLENGE, emailOtpSent: true })
  })

  it('returns 503 when neither channel can send', async () => {
    mocks.isEmailConfigured.mockReturnValue(false)
    const response = await request(buildApp()).post('/guest/request-otp').send({ phone: PHONE, email: 'guest@example.com' })
    expect(response.status).toBe(503)
  })
})

describe('POST /booking/email-fallback', () => {
  it('sends a booking code to the authenticated user email', async () => {
    mocks.authUser.email = 'registered@example.com'
    const response = await request(buildApp())
      .post('/booking/email-fallback')
      .send({ phone: PHONE })

    expect(response.status).toBe(202)
    expect(response.body).toMatchObject({
      emailChallengeId: EMAIL_CHALLENGE,
      emailOtpSent: true,
    })
    expect(mocks.sendEmail).toHaveBeenCalledWith(
      'registered@example.com',
      expect.any(String),
      expect.any(String),
    )
  })

  it('does not send email fallback to a guest account', async () => {
    mocks.authUser.email = 'guest-123@guest.urbantanker.local'
    const response = await request(buildApp())
      .post('/booking/email-fallback')
      .send({ phone: PHONE })

    expect(response.status).toBe(403)
    expect(mocks.sendEmail).not.toHaveBeenCalled()
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
