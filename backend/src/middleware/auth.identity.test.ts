import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair, type CryptoKey } from 'jose'

const cfg = vi.hoisted(() => ({
  SUPABASE_URL: 'https://abcdwxyz.supabase.co',
  AUTH_LOCAL_JWT: false,
  AUTH_CONTEXT_CACHE: false,
  AUDIT_BATCHING: false,
}))
const remote = vi.hoisted(() => ({ getUser: vi.fn(), profileRows: [] as Array<Record<string, unknown>> }))

vi.mock('../config.js', () => ({ config: cfg }))
vi.mock('../supabase.js', () => ({
  supabase: {
    auth: { getUser: remote.getUser },
    from: () => {
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () => ({ data: remote.profileRows[0] ?? null, error: null }),
      }
      return chain
    },
  },
}))

import { resolveIdentity, requireFreshAuth } from './auth.js'
import { setAccessTokenKeySource } from '../services/accessToken.js'
import { clearLocalRevocations, revokeSession } from '../services/sessionRevocation.js'

const issuer = 'https://abcdwxyz.supabase.co/auth/v1'
let privateKey: CryptoKey

async function signed(claims: Record<string, unknown>, audience = 'authenticated') {
  return new SignJWT(claims).setProtectedHeader({ alg: 'ES256', kid: 'test-key' }).setIssuer(issuer).setAudience(audience).setSubject('user-1').setIssuedAt().setExpirationTime('1h').sign(privateKey)
}

// The remote path only reads the payload, so an unsigned token with the same payload is enough there.
function unsigned(claims: Record<string, unknown>) {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url')
  return `${encode({ alg: 'none' })}.${encode({ sub: 'user-1', iat: Math.floor(Date.now() / 1000), ...claims })}.sig`
}

beforeAll(async () => {
  const pair = await generateKeyPair('ES256', { extractable: true })
  privateKey = pair.privateKey
  setAccessTokenKeySource(createLocalJWKSet({ keys: [{ ...(await exportJWK(pair.publicKey)), kid: 'test-key', alg: 'ES256', use: 'sig' }] }))
})

describe('resolveIdentity', () => {
  beforeEach(() => {
    clearLocalRevocations()
    remote.getUser.mockReset()
    remote.getUser.mockResolvedValue({ data: { user: { id: 'user-1', email: 'a@example.test' } }, error: null })
    cfg.AUTH_LOCAL_JWT = false
  })
  afterEach(() => {
    cfg.AUTH_LOCAL_JWT = false
  })

  it('asks Supabase when local verification is off, and keeps the session id from the token', async () => {
    const identity = await resolveIdentity(unsigned({ session_id: 'session-remote' }))
    expect(remote.getUser).toHaveBeenCalledTimes(1)
    expect(identity).toMatchObject({ id: 'user-1', email: 'a@example.test', sessionId: 'session-remote' })
  })

  it('accepts a valid token locally without calling Supabase', async () => {
    cfg.AUTH_LOCAL_JWT = true
    const identity = await resolveIdentity(await signed({ email: 'b@example.test', session_id: 'session-local' }))
    expect(remote.getUser).not.toHaveBeenCalled()
    expect(identity).toMatchObject({ id: 'user-1', email: 'b@example.test', sessionId: 'session-local' })
  })

  it('falls back to Supabase when a token fails local checks, so a bad local check never accepts a token Supabase would refuse', async () => {
    cfg.AUTH_LOCAL_JWT = true
    remote.getUser.mockResolvedValueOnce({ data: { user: null }, error: { message: 'invalid' } })
    const identity = await resolveIdentity(await signed({}, 'service_role'))
    expect(remote.getUser).toHaveBeenCalledTimes(1)
    expect(identity).toBeNull()
  })

  it('refuses a revoked session on the local path without asking Supabase', async () => {
    cfg.AUTH_LOCAL_JWT = true
    await revokeSession('session-logged-out')
    const identity = await resolveIdentity(await signed({ session_id: 'session-logged-out' }))
    expect(identity).toBeNull()
    expect(remote.getUser).not.toHaveBeenCalled()
  })

  it('refuses a revoked session on the remote path too, because Supabase does not know about our logout', async () => {
    await revokeSession('session-logged-out')
    expect(await resolveIdentity(unsigned({ session_id: 'session-logged-out' }))).toBeNull()
  })

  it('returns null when Supabase rejects the token', async () => {
    remote.getUser.mockResolvedValueOnce({ data: { user: null }, error: { message: 'invalid' } })
    expect(await resolveIdentity(unsigned({}))).toBeNull()
  })
})

describe('requireFreshAuth', () => {
  function fakeResponse() {
    const response = { statusCode: 200, body: undefined as unknown, status(code: number) { response.statusCode = code; return response }, json(body: unknown) { response.body = body; return response } }
    return response
  }

  it('lets the request through when Supabase confirms the same user', async () => {
    remote.getUser.mockResolvedValueOnce({ data: { user: { id: 'user-1' } }, error: null })
    const next = vi.fn()
    await requireFreshAuth({ headers: { authorization: 'Bearer t' }, authUser: { id: 'user-1' } } as never, fakeResponse() as never, next)
    expect(next).toHaveBeenCalled()
  })

  it('refuses when Supabase reports a different user than the local identity', async () => {
    remote.getUser.mockResolvedValueOnce({ data: { user: { id: 'user-2' } }, error: null })
    const response = fakeResponse()
    const next = vi.fn()
    await requireFreshAuth({ headers: { authorization: 'Bearer t' }, authUser: { id: 'user-1' } } as never, response as never, next)
    expect(next).not.toHaveBeenCalled()
    expect(response.statusCode).toBe(401)
  })
})
