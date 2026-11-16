import express from 'express'
import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  respond: vi.fn<(table: string, ops: Array<{ name: string; args: unknown[] }>) => unknown>(),
  createSignedUrl: vi.fn(),
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
    storage: {
      from: () => ({ createSignedUrl: (...args: unknown[]) => mocks.createSignedUrl(...args) }),
    },
  },
  authSupabase: { auth: { admin: {} } },
}))
vi.mock('../middleware/auth.js', () => ({
  requireAuth: (_request: object, _response: unknown, next: () => void) => next(),
  requireRole: () => (_request: object, _response: unknown, next: () => void) => next(),
}))

import adminRouter from './admin.js'

const APPLICATION_ID = '44444444-4444-4444-8444-444444444444'

function buildApp() {
  const app = express()
  app.use(express.json())
  app.use(adminRouter)
  return app
}

beforeEach(() => {
  mocks.createSignedUrl.mockReset()
  mocks.createSignedUrl.mockResolvedValue({
    data: { signedUrl: 'https://storage.example/download' },
    error: null,
  })
  mocks.respond.mockReset()
  mocks.respond.mockImplementation((table) => {
    if (table === 'partner_applications') return { data: { id: APPLICATION_ID }, error: null }
    if (table === 'documents') {
      return {
        data: [{
          id: 'document-1',
          document_type: 'application/pdf',
          object_key: 'partner-applications/batch/33333333-3333-4333-8333-333333333333-vehicle-registration.pdf',
        }],
        error: null,
      }
    }
    return { data: null, error: null }
  })
})

describe('GET /partner-applications/:id/documents', () => {
  it('returns short-lived download URLs for the application documents', async () => {
    const response = await request(buildApp()).get(`/partner-applications/${APPLICATION_ID}/documents`)
    expect(response.status).toBe(200)
    expect(response.body).toEqual([{
      id: 'document-1',
      name: 'vehicle-registration.pdf',
      documentType: 'application/pdf',
      downloadUrl: 'https://storage.example/download',
      expiresInSeconds: 300,
    }])
    expect(mocks.createSignedUrl).toHaveBeenCalledWith(
      'partner-applications/batch/33333333-3333-4333-8333-333333333333-vehicle-registration.pdf',
      300,
    )
  })

  it('rejects invalid application identifiers', async () => {
    const response = await request(buildApp()).get('/partner-applications/not-a-uuid/documents')
    expect(response.status).toBe(400)
    expect(mocks.respond).not.toHaveBeenCalled()
  })
})
