import express from 'express'
import request from 'supertest'
import { describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ challengeId: 0 }))

function chain(_table: string, operations: Array<{ name: string; args: unknown[] }> = []): unknown {
  return new Proxy({}, {
    get(_target, property) {
      if (property === 'then') {
        return (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => {
          const hasInsert = operations.some((operation) => operation.name === 'insert')
          const isRecentChallengeLookup = operations.some((operation) => operation.name === 'gte')
          const result = hasInsert
            ? { data: { id: `challenge-${++state.challengeId}` }, error: null }
            : isRecentChallengeLookup
              ? { data: null, error: null }
              : { data: null, error: null }
          return Promise.resolve(result).then(resolve, reject)
        }
      }
      return (...args: unknown[]) => chain(_table, [...operations, { name: String(property), args }])
    },
  })
}

vi.mock('../supabase.js', () => ({
  supabase: {
    from: (table: string) => chain(table),
    rpc: vi.fn(async () => ({
      data: [{
        challenge_id: `challenge-${++state.challengeId}`,
        delivery_channel: 'pending',
        created_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 600_000).toISOString(),
        is_new: true,
      }],
      error: null,
    })),
  },
  authSupabase: { auth: { admin: {} } },
}))
vi.mock('../services/scaling.js', () => ({ limiterStore: () => undefined }))
vi.mock('../services/whatsapp.js', () => ({
  sendTemplateWhatsApp: vi.fn(async () => ({
    queued: true,
    provider: 'combirds-whatsapp',
    requestId: 'message-id',
  })),
}))
vi.mock('../services/sms.js', () => ({
  sendTemplateSms: vi.fn(async () => ({ queued: false })),
}))

import authRouter from './auth.js'

function buildApp() {
  const app = express()
  app.use(express.json())
  app.use(authRouter)
  return app
}

describe('OTP request rate limits', () => {
  it('enforces the per-phone and per-IP limits on the WhatsApp send route', async () => {
    state.challengeId = 0
    const app = buildApp()
    const phone = '9876543210'

    for (let attempt = 0; attempt < 3; attempt++) {
      const response = await request(app).post('/phone/request-otp').send({ phone })
      expect(response.status, JSON.stringify(response.body)).toBe(202)
      expect(response.body.channel).toBe('whatsapp')
    }

    const perPhoneLimit = await request(app).post('/phone/request-otp').send({ phone })
    expect(perPhoneLimit.status).toBe(429)
    expect(perPhoneLimit.body.error).toContain('this number')

    const fourthIpRequest = await request(app).post('/phone/request-otp').send({ phone: '9876543211' })
    const fifthIpRequest = await request(app).post('/phone/request-otp').send({ phone: '9876543212' })
    expect(fourthIpRequest.status).toBe(202)
    expect(fifthIpRequest.status).toBe(429)
    expect(fifthIpRequest.body.error).toContain('Too many OTP requests')
  })
})
