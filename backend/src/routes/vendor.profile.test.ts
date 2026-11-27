import express from 'express'
import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { config } from '../config.js'

const state = vi.hoisted(() => ({
  operations: [] as Array<{ name: string; args: unknown[] }>,
}))

function chain(operations: Array<{ name: string; args: unknown[] }> = []): unknown {
  return new Proxy({}, {
    get(_target, property) {
      if (property === 'maybeSingle') {
        return async () => ({
          data: {
            id: 'vendor-1',
            business_name: 'North Tankers',
            service_zone: 'North district',
            latitude: 12.9,
            longitude: 77.5,
            verification: 'pending',
            is_online: false,
          },
          error: null,
        })
      }
      if (property === 'then') {
        return (resolve: (value: unknown) => unknown) =>
          Promise.resolve({ data: null, error: null }).then(resolve)
      }
      return (...args: unknown[]) => {
        state.operations.push({ name: String(property), args })
        return chain([...operations, { name: String(property), args }])
      }
    },
  })
}

vi.mock('../supabase.js', () => ({
  supabase: { from: () => chain() },
}))
vi.mock('../middleware/auth.js', () => ({
  requireAuth: (
    request: { authUser?: unknown; profile?: unknown },
    _response: unknown,
    next: () => void,
  ) => {
    request.authUser = { id: 'vendor-owner' }
    request.profile = { id: 'vendor-owner', role: 'vendor' }
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

import vendorExtendedRouter from './vendorExtended.js'

function buildApp() {
  const app = express()
  app.use('/api/vendor', vendorExtendedRouter)
  return app
}

beforeEach(() => {
  state.operations = []
  config.featureFlags.AUTH_MOUNT_ONCE = false
})

describe('GET /profile', () => {
  it('returns verification and online state for the authenticated vendor', async () => {
    const response = await request(buildApp()).get('/api/vendor/profile')

    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({
      id: 'vendor-1',
      business_name: 'North Tankers',
      verification: 'pending',
      is_online: false,
    })
    expect(state.operations).toEqual([
      { name: 'select', args: ['id,business_name,service_zone,latitude,longitude,verification,is_online'] },
      { name: 'eq', args: ['owner_profile_id', 'vendor-owner'] },
    ])
  })
})
