import express from 'express'
import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  userId: 'phone-verify-user',
  owner: null as null | { id: string },
  existingPhone: null as string | null,
  challenge: { id: '11111111-1111-4111-8111-111111111111' } as null | { id: string },
  otpHash: '',
  rpcResult: null as null | Array<{ challenge_id: string | null; otp_hash: string | null; outcome: string; retry_after_seconds: number | null }>,
  finishResult: null as null | Array<{ outcome: string; locked_until: string | null }>,
  lockedUntil: null as string | null,
  countWrongAttempts: false,
  wrongAttempts: 0,
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
vi.mock('../lib/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), success: vi.fn(), debug: vi.fn() },
}))

import authRouter from './auth.js'
import { config } from '../config.js'
import { hashOtp } from '../services/otp.js'
import { logger } from '../lib/logger.js'

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
  config.PHONE_VERIFY_REQUIRED_AFTER = undefined
  config.USE_DEFAULT_VERIFICATION_CODE = false
  config.featureFlags.otp_sms_fallback_enabled = true
  mocks.userId = 'phone-verify-user'
  mocks.owner = null
  mocks.existingPhone = null
  mocks.challenge = { id: CHALLENGE }
  mocks.otpHash = hashOtp('123456')
  mocks.rpcResult = null
  mocks.finishResult = null
  mocks.lockedUntil = null
  mocks.countWrongAttempts = false
  mocks.wrongAttempts = 0
  mocks.sendTemplateWhatsApp.mockReset()
  mocks.sendTemplateWhatsApp.mockResolvedValue({
    queued: true,
    provider: 'combirds-whatsapp',
    requestId: 'message-id',
  })
  mocks.respond.mockReset()
  vi.mocked(logger.info).mockClear()
  mocks.respond.mockImplementation((table, ops) => {
    const last = ops[ops.length - 1]?.name
    const hasOperation = (name: string) => ops.some((operation) => operation.name === name)
    if (table === 'user_phone_verification_lockouts') {
      return { data: mocks.lockedUntil ? { locked_until: mocks.lockedUntil } : null, error: null }
    }
    if (table === 'profiles' && hasOperation('select') && (ops.find((operation) => operation.name === 'select')?.args[0] === 'phone_e164')) {
      return { data: { phone_e164: mocks.existingPhone }, error: null }
    }
    if (table === 'profiles' && last === 'single' && !hasOperation('update')) {
      return {
        data: {
          id: mocks.userId,
          role: 'customer',
          full_name: 'Sample User',
          username: 'sample',
          phone_e164: null,
          phone_verified: false,
          phone_verified_at: null,
          theme_mode: 'system',
          selfie_required: false,
        },
        error: null,
      }
    }
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
    if (procedure === 'begin_user_phone_verification_attempt') {
      if (mocks.lockedUntil && Date.parse(mocks.lockedUntil) > Date.now()) {
        return {
          data: [{ challenge_id: null, otp_hash: null, outcome: 'locked', retry_after_seconds: 600 }],
          error: null,
        }
      }
      return {
        data: mocks.rpcResult ?? (mocks.challenge
          ? [{ challenge_id: CHALLENGE, otp_hash: mocks.otpHash, outcome: 'check', retry_after_seconds: null }]
          : [{ challenge_id: null, otp_hash: null, outcome: 'invalid', retry_after_seconds: null }]),
        error: null,
      }
    }
    if (procedure === 'finish_user_phone_verification_attempt') {
      const request = mocks.rpc.mock.calls.at(-1)?.[1] as { p_is_correct?: boolean } | undefined
      const correct = request?.p_is_correct === true
      if (mocks.countWrongAttempts && !correct) {
        mocks.wrongAttempts += 1
        if (mocks.wrongAttempts >= 5) {
          mocks.lockedUntil = new Date(Date.now() + 10 * 60_000).toISOString()
          return {
            data: [{ outcome: 'locked', locked_until: mocks.lockedUntil }],
            error: null,
          }
        }
      }
      return {
        data: mocks.finishResult ?? [{
          outcome: mocks.challenge ? (correct ? 'valid' : 'incorrect') : 'invalid',
          locked_until: null,
        }],
        error: null,
      }
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

  it('exposes the account verification requirement in the authenticated profile payload', async () => {
    config.PHONE_VERIFY_REQUIRED_AFTER = new Date(Date.now() - 1_000).toISOString()
    const response = await request(buildApp()).get('/me')

    expect(response.status).toBe(200)
    expect(response.body.user.phoneVerificationRequired).toBe(true)
  })

  it('sends a WhatsApp code using the existing challenge flow and E.164 number', async () => {
    mocks.userId = 'request-success-user'
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
      p_user_id: 'request-success-user',
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
    expect(mocks.rpc).toHaveBeenCalledWith('begin_user_phone_verification_attempt', {
      p_phone: '+919876543210',
      p_user_id: 'phone-verify-user',
    })
    expect(mocks.rpc).toHaveBeenCalledWith('finish_user_phone_verification_attempt', {
      p_challenge_id: CHALLENGE,
      p_user_id: 'phone-verify-user',
      p_is_correct: true,
    })
    expect(mocks.respond).toHaveBeenCalled()
    const auditActions = vi.mocked(logger.info).mock.calls
      .filter(([event]) => event === 'phone_verification.audit')
      .map(([, fields]) => (fields as { action?: string }).action)
    expect(auditActions).toContain('confirm_success')
    expect(auditActions).toContain('number_change')
  })

  it('rejects a wrong code without changing the profile', async () => {
    mocks.existingPhone = '+919999999999'
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
    expect(mocks.rpc).toHaveBeenCalledWith('begin_user_phone_verification_attempt', expect.objectContaining({
      p_phone: '+919876543210',
      p_user_id: 'phone-verify-user',
    }))
    expect(mocks.rpc).not.toHaveBeenCalledWith('finish_user_phone_verification_attempt', expect.anything())
  })

  it('does not reveal a duplicate phone number while requesting a code', async () => {
    mocks.userId = 'non-enumerating-request-user'
    mocks.owner = { id: 'another-user' }
    const response = await fromIp('198.51.100.11').send({ phone: PHONE })

    expect(response.status).toBe(202)
    expect(mocks.sendTemplateWhatsApp).toHaveBeenCalled()
    expect(mocks.respond.mock.calls.some(([table, ops]) => table === 'profiles'
      && ops.some((operation) => operation.name === 'eq' && operation.args[0] === 'phone_e164'))).toBe(false)
  })

  it('rejects a duplicate number only after a correct confirmation code', async () => {
    mocks.owner = { id: 'another-user' }
    const response = await request(buildApp())
      .post('/phone/verify/confirm')
      .send({ phone: PHONE, code: '123456' })

    expect(response.status).toBe(409)
    expect(response.body.error).toContain('already registered')
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

  it('enforces the daily per-phone send cap across short-window resets', async () => {
    const originalTime = Date.now()
    mocks.userId = 'daily-phone-cap-user'
    try {
      for (let index = 0; index < 11; index += 1) {
        vi.setSystemTime(originalTime + Math.floor(index / 3) * 11 * 60_000)
        const response = await fromIp(`198.51.100.${20 + index}`).send({ phone: '9876543219' })
        if (index < 10) expect(response.status).toBe(202)
        else {
          expect(response.status).toBe(429)
          expect(response.body.error).toContain('Daily phone verification code limit')
        }
      }
    } finally {
      vi.setSystemTime(originalTime)
    }
  })

  it('enforces the daily per-IP request cap across short-window resets', async () => {
    const originalTime = Date.now()
    mocks.userId = 'daily-ip-cap-user'
    const app = buildApp()
    try {
      for (let index = 0; index < 31; index += 1) {
        vi.setSystemTime(originalTime + Math.floor(index / 3) * 11 * 60_000)
        const response = await request(app)
          .post('/phone/verify/request')
          .set('x-forwarded-for', '198.51.100.55')
          .send({ phone: `987654${String(index).padStart(4, '0')}` })
        if (index < 30) expect(response.status).toBe(202)
        else {
          expect(response.status).toBe(429)
          expect(response.body.error).toContain('Daily phone verification request limit')
        }
      }
    } finally {
      vi.setSystemTime(originalTime)
    }
  })

  it('locks verification for ten minutes across new challenge requests', async () => {
    mocks.userId = 'lockout-user'
    mocks.countWrongAttempts = true
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const response = await request(buildApp())
        .post('/phone/verify/confirm')
        .send({ phone: '9876543232', code: '654321' })
      expect(response.status).toBe(400)
    }
    const confirmation = await request(buildApp())
      .post('/phone/verify/confirm')
      .send({ phone: '9876543232', code: '654321' })
    expect(confirmation.status).toBe(423)
    expect(confirmation.body.code).toBe('PHONE_VERIFY_LOCKED')

    const resend = await fromIp('198.51.100.13').send({ phone: '9876543232' })
    expect(resend.status).toBe(423)
    expect(mocks.sendTemplateWhatsApp).not.toHaveBeenCalled()
  })

  it('logs masked verification audit events without the full phone number or code', async () => {
    mocks.userId = 'audit-user'
    const auditPhone = '9876543299'
    await fromIp('198.51.100.14').send({ phone: auditPhone })
    await request(buildApp())
      .post('/phone/verify/confirm')
      .send({ phone: auditPhone, code: '654321' })

    const auditCalls = vi.mocked(logger.info).mock.calls.filter(([event]) => event === 'phone_verification.audit')
    expect(auditCalls.length).toBeGreaterThanOrEqual(2)
    const auditText = JSON.stringify(auditCalls)
    expect(auditText).toContain('+91******3299')
    expect(auditText).not.toContain(auditPhone)
    expect(auditText).not.toContain('654321')
    expect(auditText).toContain('198.51.100.14')
  })
})
