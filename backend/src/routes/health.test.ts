import express from 'express'
import request from 'supertest'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../database.js', () => ({ checkDatabaseConnection: vi.fn(async () => true) }))
vi.mock('../services/scaling.js', () => ({ getRedisPair: () => null }))

import { createHealthRouter } from './health.js'

function appWith(checkDatabase: () => Promise<boolean>, redisConfigured = false) {
  const app = express()
  app.use(createHealthRouter({ redisConfigured, checkDatabase }))
  return app
}

describe('health routes', () => {
  it('answers liveness regardless of the database', async () => {
    const response = await request(appWith(async () => false)).get('/health')
    expect(response.status).toBe(200)
    expect(response.body).toEqual({ ok: true, service: 'urban-tanker-api' })
  })

  it('reports ready with 200 when the database check passes', async () => {
    const response = await request(appWith(async () => true)).get('/health/ready')
    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({ ok: true, database: 'ready', redis: 'not_configured' })
    expect(response.headers['cache-control']).toBe('no-store')
  })

  it('returns 503 when the database check returns false', async () => {
    const response = await request(appWith(async () => false)).get('/health/ready')
    expect(response.status).toBe(503)
    expect(response.body).toMatchObject({ ok: false, database: 'unavailable' })
  })

  it('returns 503 instead of hanging or 500 when the database check throws', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const response = await request(appWith(async () => { throw new Error('connect ECONNREFUSED') })).get('/health/ready')
    expect(response.status).toBe(503)
    expect(response.body).toMatchObject({ ok: false, database: 'unavailable' })
    expect(response.headers['cache-control']).toBe('no-store')
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('health.database_check_failed'))
    spy.mockRestore()
  })

  it('reports Redis as unavailable when it is configured but not connected', async () => {
    const response = await request(appWith(async () => true, true)).get('/health/ready')
    expect(response.status).toBe(200)
    expect(response.body.redis).toBe('unavailable')
  })
})
