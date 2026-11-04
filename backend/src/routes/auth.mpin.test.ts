import express from 'express'
import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  upsert: vi.fn(),
  deleteEq: vi.fn(),
}))

vi.mock('../supabase.js', () => ({
  supabase: { from: (...args: unknown[]) => mocks.from(...args) },
  authSupabase: {},
}))
vi.mock('../middleware/auth.js', () => ({
  requireAuth: (_request: unknown, _response: unknown, next: () => void) =>
    next(),
}))
vi.mock('express-rate-limit', () => ({
  default: () => (_request: unknown, _response: unknown, next: () => void) =>
    next(),
}))
vi.mock('../services/scaling.js', () => ({ limiterStore: () => undefined }))

import authRouter, { hashMpinForUser } from './auth.js'

function buildApp() {
  const app = express()
  app.use(express.json())
  app.use((request, _response, next) => {
    Object.assign(request, { authUser: { id: 'user-1' } })
    next()
  })
  app.use(authRouter)
  return app
}

beforeEach(() => {
  mocks.from.mockReset().mockReturnValue({
    upsert: mocks.upsert,
    delete: () => ({ eq: mocks.deleteEq }),
  })
  mocks.upsert.mockReset().mockResolvedValue({ error: null })
  mocks.deleteEq.mockReset().mockResolvedValue({ error: null })
})

describe('MPIN credential storage', () => {
  it('creates user-scoped HMAC digests instead of storing a PIN', () => {
    const digest = hashMpinForUser('user-1', '1234')

    expect(digest).toMatch(/^[a-f0-9]{64}$/)
    expect(digest).not.toBe('1234')
    expect(hashMpinForUser('user-2', '1234')).not.toBe(digest)
  })

  it('stores the digest for the authenticated user', async () => {
    const response = await request(buildApp())
      .put('/mpin')
      .send({ pin: '1234' })

    expect(response.status).toBe(204)
    expect(mocks.from).toHaveBeenCalledWith('user_mpin_credentials')
    expect(mocks.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: 'user-1',
        pin_digest: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
      { onConflict: 'user_id' },
    )
    expect(mocks.upsert.mock.calls[0]?.[0]).not.toHaveProperty('pin')
  })

  it('rejects invalid PINs without writing them', async () => {
    const response = await request(buildApp())
      .put('/mpin')
      .send({ pin: '12ab' })

    expect(response.status).toBe(400)
    expect(mocks.upsert).not.toHaveBeenCalled()
  })

  it('removes only the authenticated user credential', async () => {
    const response = await request(buildApp()).delete('/mpin')

    expect(response.status).toBe(204)
    expect(mocks.from).toHaveBeenCalledWith('user_mpin_credentials')
    expect(mocks.deleteEq).toHaveBeenCalledWith('user_id', 'user-1')
  })
})