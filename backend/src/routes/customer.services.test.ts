import express from 'express'
import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  serviceTypes: [{ code: 'new_service', min_quantity: '2', max_quantity: '12', quantity_unit: 'loads', active: true }],
  calls: [] as string[],
}))

function chain(table: string, operations: Array<{ name: string; args: unknown[] }> = []): unknown {
  return new Proxy({}, {
    get(_target, prop) {
      if (prop === 'then') {
        return (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
          Promise.resolve().then(() => {
            mocks.calls.push(table)
            if (table === 'service_catalog') return { data: [{ code: 'new_service', name: 'New service', is_active: true }], error: null }
            if (table === 'service_types') return { data: mocks.serviceTypes, error: null }
            return { data: [], error: null }
          }).then(resolve, reject)
      }
      return (...args: unknown[]) => chain(table, [...operations, { name: String(prop), args }])
    },
  })
}

vi.mock('../supabase.js', () => ({ supabase: { from: (table: string) => chain(table) } }))
vi.mock('../services/catalogCache.js', () => ({ cachedCatalog: (_key: string, loader: () => Promise<unknown>) => loader() }))
vi.mock('../services/scaling.js', () => ({ limiterStore: () => undefined }))

import { config } from '../config.js'
import customerRouter from './customer.js'

function buildApp() {
  const app = express()
  app.use(customerRouter)
  return app
}

beforeEach(() => {
  mocks.calls = []
  config.MULTI_SERVICE_ORDERS_ENABLED = false
})

describe('customer service catalog compatibility', () => {
  it('keeps the existing catalog shape when multi-service orders are disabled', async () => {
    const response = await request(buildApp()).get('/services')
    expect(response.status).toBe(200)
    expect(response.body[0]).not.toHaveProperty('min_quantity')
    expect(response.body[0]).not.toHaveProperty('unit')
    expect(mocks.calls).toEqual(['service_catalog'])
  })

  it('exposes service quantity bounds and unit for dynamic forms when enabled', async () => {
    config.MULTI_SERVICE_ORDERS_ENABLED = true
    const response = await request(buildApp()).get('/services')
    expect(response.status).toBe(200)
    expect(response.body[0]).toMatchObject({ min_quantity: 2, max_quantity: 12, unit: 'loads' })
    expect(mocks.calls).toEqual(['service_catalog', 'service_types'])
  })
})
