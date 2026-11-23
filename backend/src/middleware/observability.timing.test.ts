import express from 'express'
import request from 'supertest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { requestObservability } from './observability.js'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('requestObservability timing', () => {
  it('logs failed response details while redacting sensitive values', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const app = express()
    app.use(requestObservability(0))
    app.get('/failure', (_request, response) => response.status(502).json({
      error: 'Delivery failed for alex@example.com, code 123456, phone +14155552671',
      code: 'DELIVERY_FAILED',
    }))

    await request(app).get('/failure')

    const event = error.mock.calls
      .map(([line]) => JSON.parse(String(line)))
      .find(({ event: name }) => name === 'http.request')
    expect(event).toMatchObject({
      event: 'http.request',
      status: 502,
      errorCode: 'DELIVERY_FAILED',
      error: 'Delivery failed for [redacted-email], code [redacted-code], phone [redacted-number]',
    })
    expect(JSON.stringify(event)).not.toContain('alex@example.com')
    expect(JSON.stringify(event)).not.toContain('123456')
    expect(JSON.stringify(event)).not.toContain('+14155552671')
  })

  it('sends a Server-Timing total on every response', async () => {
    const app = express()
    app.use(requestObservability(0))
    app.get('/ping', (_request, response) => response.json({ ok: true }))
    const response = await request(app).get('/ping')
    expect(response.headers['server-timing']).toMatch(/^total;dur=\d+(\.\d+)?$/)
  })

  it('logs a slow_request event above the threshold, with the route template and no tracking token', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const app = express()
    app.use(requestObservability(1))
    app.get('/slow', (_request, response) => setTimeout(() => response.json({ ok: true }), 15))
    await request(app).get('/slow')
    const event = JSON.parse(String(warn.mock.calls[0]?.[0]))
    expect(event).toMatchObject({ event: 'slow_request', method: 'GET', path: '/slow', status: 200, thresholdMs: 1 })
    expect(event.durationMs).toBeGreaterThanOrEqual(1)
  })

  it('does not log slow requests when the threshold is 0', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const app = express()
    app.use(requestObservability(0))
    app.get('/slow', (_request, response) => setTimeout(() => response.json({ ok: true }), 5))
    await request(app).get('/slow')
    expect(warn).not.toHaveBeenCalled()
  })
})
