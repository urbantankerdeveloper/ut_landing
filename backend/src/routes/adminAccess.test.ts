import express from 'express'
import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  respond: vi.fn<(table: string, ops: Array<{ name: string; args: unknown[] }>) => unknown>(),
  createUser: vi.fn(),
  deleteUser: vi.fn(),
  getUserById: vi.fn(),
  generateLink: vi.fn(),
  isEmailConfigured: vi.fn(() => true),
  sendEmail: vi.fn(),
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
  supabase: { from: (table: string) => chain(table) },
  authSupabase: {
    auth: {
      admin: {
        createUser: (...args: unknown[]) => mocks.createUser(...args),
        deleteUser: (...args: unknown[]) => mocks.deleteUser(...args),
        getUserById: (...args: unknown[]) => mocks.getUserById(...args),
        generateLink: (...args: unknown[]) => mocks.generateLink(...args),
      },
    },
  },
}))
vi.mock('express-rate-limit', () => ({
  default: () => (_request: unknown, _response: unknown, next: () => void) => next(),
}))
vi.mock('../services/scaling.js', () => ({ limiterStore: () => undefined }))
vi.mock('../middleware/auth.js', () => ({
  requireAuth: (request: object, _response: unknown, next: () => void) => {
    Object.assign(request, {
      authUser: { id: 'reviewing-admin' },
      profile: { id: 'reviewing-admin', role: 'admin' },
    })
    next()
  },
  requireRole: () => (_request: unknown, _response: unknown, next: () => void) => next(),
}))
vi.mock('../services/providers.js', () => ({
  isEmailConfigured: () => mocks.isEmailConfigured(),
  sendEmail: (...args: unknown[]) => mocks.sendEmail(...args),
}))
vi.mock('../services/signupEmail.js', () => ({
  adminAccessGrantedEmail: (name: string, link: string) => ({
    subject: `approved ${name}`,
    html: `<a href="${link}">Set password</a>`,
  }),
}))

import { config } from '../config.js'
import adminAccessRouter from './adminAccess.js'

const requestId = '11111111-1111-4111-8111-111111111111'
const phoneChallengeId = '22222222-2222-4222-8222-222222222222'
const requestBody = {
  name: 'Jordan Smith',
  email: 'jordan@example.com',
  phone: '9876543210',
  reason: 'I need access to manage regional operations.',
  phoneChallengeId,
}

function buildApp() {
  return express().use(express.json()).use(adminAccessRouter)
}

beforeEach(() => {
  config.featureFlags.admin_approval_required_enabled = false
  mocks.respond.mockReset()
  mocks.respond.mockImplementation((table, ops) => {
    const last = ops[ops.length - 1]?.name
    if (table === 'guest_otp_challenges' && last === 'maybeSingle') {
      return { data: { id: phoneChallengeId }, error: null }
    }
    return { data: null, error: null }
  })
  mocks.createUser.mockReset()
  mocks.createUser.mockResolvedValue({
    data: { user: { id: 'new-admin-id', email: 'jordan@example.com' } },
    error: null,
  })
  mocks.deleteUser.mockReset()
  mocks.deleteUser.mockResolvedValue({ error: null })
  mocks.getUserById.mockReset()
  mocks.getUserById.mockImplementation(async (id: string) => ({
    data: { user: { id, email: `${id}@example.com` } },
    error: null,
  }))
  mocks.generateLink.mockReset()
  mocks.generateLink.mockResolvedValue({
    data: { properties: { action_link: 'https://example.test/recovery-link' } },
    error: null,
  })
  mocks.isEmailConfigured.mockReturnValue(true)
  mocks.sendEmail.mockReset()
  mocks.sendEmail.mockResolvedValue({ queued: true })
})

describe('admin access request endpoints', () => {
  it('keeps the public endpoints disabled by default', async () => {
    const response = await request(buildApp()).post('/requests').send(requestBody)
    expect(response.status).toBe(404)
  })

  it('requires a verified guest phone challenge before accepting a request', async () => {
    config.featureFlags.admin_approval_required_enabled = true
    mocks.respond.mockImplementation((table, ops) => {
      if (table === 'guest_otp_challenges' && ops[ops.length - 1]?.name === 'maybeSingle') {
        return { data: null, error: null }
      }
      return { data: null, error: null }
    })

    const response = await request(buildApp()).post('/requests').send(requestBody)

    expect(response.status).toBe(400)
    expect(response.body.error).toContain('Verify your phone')
    expect(mocks.respond).not.toHaveBeenCalledWith(
      'admin_access_requests',
      expect.anything(),
    )
  })

  it('returns the same generic response for first and duplicate submissions', async () => {
    config.featureFlags.admin_approval_required_enabled = true
    const submit = () => request(buildApp()).post('/requests').send(requestBody)
    const first = await submit()
    mocks.respond.mockImplementation((table, ops) => {
      const last = ops[ops.length - 1]?.name
      if (table === 'guest_otp_challenges' && last === 'maybeSingle') {
        return { data: { id: phoneChallengeId }, error: null }
      }
      if (table === 'admin_access_requests') {
        return { data: null, error: { code: '23505', message: 'unique conflict' } }
      }
      return { data: null, error: null }
    })
    const duplicate = await submit()

    expect(first.status).toBe(202)
    expect(duplicate.status).toBe(202)
    expect(duplicate.body).toEqual(first.body)
    expect(first.body).toEqual({
      accepted: true,
      message: 'Your request has been received and will be reviewed.',
    })
    expect(JSON.stringify(duplicate.body)).not.toContain(requestBody.email)
    expect(JSON.stringify(duplicate.body)).not.toContain(requestBody.phone)
  })

  it('provisions an approved admin and sends a password setup link', async () => {
    config.featureFlags.admin_approval_required_enabled = true
    mocks.respond.mockImplementation((table, ops) => {
      if (table === 'admin_access_requests' && ops.some((op) => op.name === 'select')) {
        return {
          data: {
            id: requestId,
            name: requestBody.name,
            email: requestBody.email,
            phone_e164: '+919876543210',
            reason: requestBody.reason,
          },
          error: null,
        }
      }
      return { data: null, error: null }
    })

    const response = await request(buildApp())
      .patch(`/requests/${requestId}`)
      .send({ decision: 'approved' })

    expect(response.status).toBe(200)
    expect(response.body).toEqual({ id: requestId, status: 'approved' })
    expect(mocks.createUser).toHaveBeenCalledWith(expect.objectContaining({
      email: requestBody.email,
      email_confirm: true,
      app_metadata: { role: 'admin' },
    }))
    expect(mocks.respond).toHaveBeenCalledWith('profiles', expect.arrayContaining([
      expect.objectContaining({
        name: 'upsert',
        args: [expect.objectContaining({
          role: 'admin',
          approval_status: 'approved',
          admin_approval_status: 'approved',
        })],
      }),
    ]))
    expect(mocks.sendEmail).toHaveBeenCalledWith(
      requestBody.email,
      expect.any(String),
      expect.stringContaining('recovery-link'),
    )
  })

  it('marks a rejected request instead of deleting it', async () => {
    config.featureFlags.admin_approval_required_enabled = true
    mocks.respond.mockImplementation((table, ops) => {
      if (table === 'admin_access_requests' && ops[ops.length - 1]?.name === 'maybeSingle') {
        return {
          data: {
            id: requestId,
            name: requestBody.name,
            email: requestBody.email,
            phone_e164: '+919876543210',
            reason: requestBody.reason,
          },
          error: null,
        }
      }
      return { data: null, error: null }
    })

    const response = await request(buildApp())
      .patch(`/requests/${requestId}`)
      .send({ decision: 'rejected' })

    expect(response.status).toBe(200)
    expect(response.body).toEqual({ id: requestId, status: 'rejected' })
    const calls = mocks.respond.mock.calls
    expect(calls.some(([table, ops]) =>
      table === 'admin_access_requests' &&
      ops.some((op) => op.name === 'update' && (op.args[0] as { status?: string }).status === 'rejected'),
    )).toBe(true)
    expect(calls.some(([, ops]) => ops.some((op) => op.name === 'delete'))).toBe(false)
  })

  it('lists every admin and every request with status and active state', async () => {
    mocks.respond.mockImplementation((table, ops) => {
      if (table === 'profiles' && ops.some((op) => op.name === 'select')) {
        return {
          data: [{
            id: 'existing-admin',
            full_name: 'Existing Admin',
            phone_e164: '+919876543210',
            admin_approval_status: 'approved',
            approval_status: 'approved',
            is_active: false,
            created_at: '2026-01-01T00:00:00.000Z',
          }],
          error: null,
        }
      }
      if (table === 'admin_access_requests') {
        return {
          data: [
            {
              id: requestId,
              name: requestBody.name,
              email: requestBody.email,
              phone_e164: '+919876543210',
              reason: requestBody.reason,
              status: 'pending',
              requested_at: '2026-02-01T00:00:00.000Z',
              reviewed_by: null,
              reviewed_at: null,
              provisioned_user_id: null,
            },
          ],
          error: null,
        }
      }
      return { data: null, error: null }
    })

    const response = await request(buildApp()).get('/admins')

    expect(response.status).toBe(200)
    expect(response.body).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: requestId, kind: 'request', status: 'pending', is_active: null }),
      expect.objectContaining({ id: 'existing-admin', kind: 'admin', status: 'approved', is_active: false }),
    ]))
  })

  it('changes active state only for approved admin accounts', async () => {
    config.featureFlags.admin_approval_required_enabled = false
    mocks.respond.mockImplementation((table, ops) => {
      const update = ops.find((op) => op.name === 'update')
      if (table === 'profiles' && update) {
        return { data: { id: 'existing-admin', is_active: false }, error: null }
      }
      return { data: null, error: null }
    })

    const response = await request(buildApp())
      .patch('/admins/11111111-1111-4111-8111-111111111111/status')
      .send({ isActive: false })

    expect(response.status).toBe(200)
    expect(response.body).toEqual({ id: 'existing-admin', is_active: false })
    expect(mocks.respond).toHaveBeenCalledWith('profiles', expect.arrayContaining([
      expect.objectContaining({
        name: 'eq',
        args: ['admin_approval_status', 'approved'],
      }),
    ]))
    expect(mocks.respond.mock.calls.some(([, ops]) => ops.some((op) => op.name === 'delete'))).toBe(false)
  })
})
