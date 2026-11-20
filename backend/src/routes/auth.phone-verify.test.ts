import express from 'express'
import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  userId: 'phone-verify-user',
  owner: null as null | { id: string },
  challenge: { id: '11111111-1111-4111-8111-111111111111' } as null | { id: string },
  otpHash: '',
  rpc: vi.fn(),
  respond: vi.fn<(table: string, ops: Array<{ name: string; args: unknown[] }>) => unknown>(),
  sendTemplateWhatsApp: vi.fn(),
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
    rpc: (...args: unknown[]) => mocks.rpc(...args),
  },
  authSupabase: { auth: { admin: {} } },
}))
vi.mock('../middleware/auth.js', () => ({
  requireAuth: (request: object, _response: unknown, next: () => void) => {
    Object.assign(request, { authUser: { id: mocks.userId, email: 'person@example.com' } })
    next()
  },
}))
vi.mock('../services/scaling.js', () => ({ limiterStore: () => undefined }))
vi.mock('../services/whatsapp.js', () => ({
  sendTemplateWhatsApp: (...args: unknown[]) => mocks.sendTemplateWhatsApp(...args),
}))
vi.mock('../services/sms.js', () => ({ sendTemplateSms: vi.fn() }))
vi.mock('../services/providers.js', () => ({
  isEmailConfigured: vi.fn(() => true),
  sendEmail: vi.fn(),
}))

import authRouter from './auth.js'
import { config } from '../config.js'
import { hashOtp } from '../services/otp.js'

const PHONE = '9876543210'
const CHALLENGE = '11111111-1111-4111-8111-111111111111'

function buildApp() {
  const app = express()
  app.set('trust proxy', 1)
  app.use(express.json())
  app.use(authRouter)
  return app
}

function fromIp(ip: string) {
  return request(buildApp()).post('/phone/verify/request').set('x-forwarded-for', ip)
}

beforeEach(() => {
  config.PHONE_VERIFY_DIALOG_ENABLED = true
  config.USE_DEFAULT_VERIFICATION_CODE = false
  config.featureFlags.otp_sms_fallback_enabled = true
  mocks.userId = 'phone-verify-user'
  mocks.owner = null
  mocks.challenge = { id: CHALLENGE }
  mocks.otpHash = hashOtp('123456')
  mocks.sendTemplateWhatsApp.mockReset()
  mocks.sendTemplateWhatsApp.mockResolvedValue({
    queued: true,
    provider: 'combirds-whatsapp',
    requestId: 'message-id',
  })
  mocks.respond.mockReset()
  mocks.respond.mockImplementation((table, ops) => {
    const last = ops[ops.length - 1]?.name
    const hasOperation = (name: string) => ops.some((operation) => operation.name === name)
    if (table === 'profiles' && hasOperation('update')) {
      return {
        data: {
          phone_e164: '+919876543210',
          phone_verified: true,
          phone_verified_at: new Date().toISOString(),
        },
        error: null,
      }
    }
    if (table === 'profiles' && last === 'maybeSingle') {
      return { data: mocks.owner, error: null }
    }
    if (table === 'guest_otp_challenges' && last === 'maybeSingle') {
      return { data: hasOperation('order') ? mocks.challenge : { id: CHALLENGE }, error: null }
    }
    if (table === 'guest_otp_challenges' && hasOperation('update')) {
      return { data: null, error: null }
    }
    return { data: null, error: null }
  })
  mocks.rpc.mockReset()
  mocks.rpc.mockImplementation(async (procedure: string) => {
    if (procedure === 'claim_guest_otp_challenge') {
      const now = new Date()
      return {
        data: [{
          challenge_id: CHALLENGE,
          delivery_channel: 'pending',
          created_at: now.toISOString(),
          expires_at: new Date(now.getTime() + 5 * 60_000).toISOString(),
          is_new: true,
        }],
        error: null,
      }
    }
    if (procedure === 'consume_user_phone_otp_attempt') {
      return { data: [{ otp_hash: mocks.otpHash }], error: null }
    }
    return { data: null, error: null }
  })
})

describe('authenticated phone verification', () => {
  it('keeps the endpoints unavailable when the feature flag is off', async () => {
    config.PHONE_VERIFY_DIALOG_ENABLED = false
    const response = await fromIp('198.51.100.9').send({ phone: PHONE })

    expect(response.status).toBe(404)
    expect(mocks.sendTemplateWhatsApp).not.toHaveBeenCalled()
  })

  it('sends a WhatsApp code using the existing challenge flow and E.164 number', async () => {
    const response = await fromIp('198.51.100.10').send({ phone: PHONE })

    expect(response.status).toBe(202)
    expect(response.body).toMatchObject({
      challengeId: CHALLENGE,
      channel: 'whatsapp',
      expiresInSeconds: 300,
      resendAfterSeconds: 30,
    })
    expect(mocks.sendTemplateWhatsApp).toHaveBeenCalledWith(
      'user_registration_otp',
      '+919876543210',
      { otp: expect.any(String) },
    )
    expect(mocks.rpc).toHaveBeenCalledWith('claim_guest_otp_challenge', expect.objectContaining({
      p_phone_e164: '+919876543210',
      p_user_id: 'phone-verify-user',
    }))
  })

  it('marks the authenticated profile verified after a correct code', async () => {
    const response = await request(buildApp())
      .post('/phone/verify/confirm')
      .send({ phone: PHONE, code: '123456' })

    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({
      verified: true,
      phone: PHONE,
      phoneVerified: true,
      challengeId: CHALLENGE,
    })
    expect(mocks.rpc).toHaveBeenCalledWith('consume_user_phone_otp_attempt', {
      p_challenge_id: CHALLENGE,
      p_phone: '+919876543210',
      p_user_id: 'phone-verify-user',
    })
    expect(mocks.respond).toHaveBeenCalled()
  })

  it('rejects a wrong code without changing the profile', async () => {
    const response = await request(buildApp())
      .post('/phone/verify/confirm')
      .send({ phone: PHONE, code: '654321' })

    expect(response.status).toBe(400)
    expect(response.body.error).toContain('incorrect')
    expect(mocks.respond).not.toHaveBeenCalledWith('profiles', expect.arrayContaining([
      expect.objectContaining({ name: 'update' }),
    ]))
  })

  it('rejects an expired challenge without consuming an attempt', async () => {
    mocks.challenge = null
    const response = await request(buildApp())
      .post('/phone/verify/confirm')
      .send({ phone: PHONE, code: '123456' })

    expect(response.status).toBe(400)
    expect(response.body.error).toContain('invalid or expired')
    expect(mocks.rpc).not.toHaveBeenCalledWith('consume_user_phone_otp_attempt', expect.anything())
  })

  it('rejects a phone number verified by another account', async () => {
    mocks.owner = { id: 'another-user' }
    const response = await fromIp('198.51.100.11').send({ phone: PHONE })

    expect(response.status).toBe(409)
    expect(response.body.error).toContain('already registered')
    expect(mocks.sendTemplateWhatsApp).not.toHaveBeenCalled()
  })

  it('limits requests per authenticated user', async () => {
    mocks.userId = 'rate-limited-user'
    const app = buildApp()
    const send = (phone: string) => request(app)
      .post('/phone/verify/request')
      .set('x-forwarded-for', '198.51.100.12')
      .send({ phone })

    for (const phone of ['9876543210', '9876543211', '9876543212']) {
      expect((await send(phone)).status).toBe(202)
    }
    const limited = await send('9876543213')
    expect(limited.status).toBe(429)
    expect(limited.body.error).toContain('Too many phone verification codes')
  })
})
