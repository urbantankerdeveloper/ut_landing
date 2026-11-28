import express from 'express'
import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { config } from '../config.js'

const state = vi.hoisted(() => ({
  bookingsCall: 0,
  calls: [] as Array<{ table: string; operations: Array<{ name: string; args: unknown[] }> }>,
}))

function chain(
  table: string,
  operations: Array<{ name: string; args: unknown[] }> = [],
): unknown {
  return new Proxy({}, {
    get(_target, property) {
      if (property === 'then') {
        return (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
          Promise.resolve(respond(table, operations)).then(resolve, reject)
      }
      if (property === 'maybeSingle' || property === 'single') {
        return () => Promise.resolve(respond(table, operations))
      }
      return (...args: unknown[]) =>
        chain(table, [...operations, { name: String(property), args }])
    },
  })
}

function respond(
  table: string,
  operations: Array<{ name: string; args: unknown[] }>,
) {
  state.calls.push({ table, operations })
  if (table === 'vendors') {
    return { data: { id: 'vendor-1' }, error: null }
  }
  if (table === 'bookings') {
    const isCurrentPeriod = state.bookingsCall++ === 0
    const from = operations.find((operation) => operation.name === 'gte')
      ?.args[1]
    return {
      data: isCurrentPeriod
        ? [{
            service_code: 'water',
            quoted_amount_paise: 12500,
            created_at: from,
          }]
        : [{
            service_code: 'water',
            quoted_amount_paise: 7500,
            created_at: from,
          }],
      error: null,
    }
  }
  if (table === 'service_catalog') {
    return { data: [{ code: 'water', name: 'Water delivery' }], error: null }
  }
  return { data: null, error: null }
}

vi.mock('../supabase.js', () => ({
  supabase: { from: (table: string) => chain(table) },
}))
vi.mock('../middleware/auth.js', () => ({
  requireAuth: (
    request: { headers: Record<string, unknown>; authUser?: unknown; profile?: unknown },
    _response: unknown,
    next: () => void,
  ) => {
    request.authUser = { id: 'vendor-owner' }
    request.profile = {
      id: 'vendor-owner',
      role: String(request.headers['x-test-role'] ?? 'vendor'),
    }
    next()
  },
  requireRole: (role: string) => (
    request: { profile?: { role?: string } },
    response: { status: (code: number) => { json: (body: unknown) => void } },
    next: () => void,
  ) => request.profile?.role === role
    ? next()
    : response.status(403).json({ error: 'Insufficient permissions' }),
}))

import vendorRouter from './vendor.js'

function buildApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/vendor', vendorRouter)
  return app
}

beforeEach(() => {
  state.bookingsCall = 0
  state.calls = []
  config.featureFlags.AUTH_MOUNT_ONCE = false
})

describe('GET /reports/sales', () => {
  it('returns quoted sales data scoped to the signed-in vendor', async () => {
    const response = await request(buildApp())
      .get('/api/vendor/reports/sales?period=day')

    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({
      period: 'day',
      totalPaise: 12500,
      previousTotalPaise: 7500,
      orderCount: 1,
      breakdown: [{
        service: 'Water delivery',
        orders: 1,
        amountPaise: 12500,
      }],
    })
    const bookingQueries = state.calls.filter((call) => call.table === 'bookings')
    expect(bookingQueries).toHaveLength(2)
    for (const call of bookingQueries) {
      expect(call.operations).toContainEqual({
        name: 'eq',
        args: ['vendor_id', 'vendor-1'],
      })
    }
  })

  it('rejects unknown periods before querying vendor data', async () => {
    const response = await request(buildApp())
      .get('/api/vendor/reports/sales?period=year')

    expect(response.status).toBe(400)
    expect(state.calls).toHaveLength(0)
  })

  it('does not expose the vendor report to other roles', async () => {
    const response = await request(buildApp())
      .get('/api/vendor/reports/sales?period=day')
      .set('x-test-role', 'customer')

    expect(response.status).toBe(403)
    expect(state.calls).toHaveLength(0)
  })
})
