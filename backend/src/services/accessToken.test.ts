import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { SignJWT, exportJWK, generateKeyPair, createLocalJWKSet, type CryptoKey } from 'jose'

vi.mock('../config.js', () => ({ config: { SUPABASE_URL: 'https://abcdwxyz.supabase.co' } }))

import { setAccessTokenKeySource, verifyAccessToken } from './accessToken.js'

const issuer = 'https://abcdwxyz.supabase.co/auth/v1'
let privateKey: CryptoKey
let otherPrivateKey: CryptoKey

async function sign(claims: Record<string, unknown>, options: { key?: CryptoKey; audience?: string; issuer?: string; expires?: string; subject?: string | null } = {}) {
  let builder = new SignJWT(claims)
    .setProtectedHeader({ alg: 'ES256', kid: 'test-key' })
    .setIssuer(options.issuer ?? issuer)
    .setAudience(options.audience ?? 'authenticated')
    .setIssuedAt()
    .setExpirationTime(options.expires ?? '1h')
  if (options.subject !== null) builder = builder.setSubject(options.subject ?? 'user-1')
  return builder.sign(options.key ?? privateKey)
}

describe('verifyAccessToken', () => {
  beforeAll(async () => {
    const pair = await generateKeyPair('ES256', { extractable: true })
    privateKey = pair.privateKey
    const publicJwk = { ...(await exportJWK(pair.publicKey)), kid: 'test-key', alg: 'ES256', use: 'sig' }
    setAccessTokenKeySource(createLocalJWKSet({ keys: [publicJwk] }))
    otherPrivateKey = (await generateKeyPair('ES256')).privateKey
  })
  afterAll(() => {
    setAccessTokenKeySource(null)
  })

  it('accepts a valid token and returns its claims', async () => {
    const token = await sign({ email: 'a@example.test', session_id: 'session-1' })
    const claims = await verifyAccessToken(token)
    expect(claims.sub).toBe('user-1')
    expect(claims.session_id).toBe('session-1')
    expect(claims.email).toBe('a@example.test')
  })

  it('accepts a recovery session (amr recovery) so the password update flow can still read it', async () => {
    const token = await sign({ amr: [{ method: 'recovery', timestamp: 1 }] })
    expect((await verifyAccessToken(token)).sub).toBe('user-1')
  })

  it('refuses an expired token', async () => {
    const token = await sign({}, { expires: '-1h' })
    await expect(verifyAccessToken(token)).rejects.toThrow()
  })

  it('refuses a token for another audience', async () => {
    const token = await sign({}, { audience: 'service_role' })
    await expect(verifyAccessToken(token)).rejects.toThrow()
  })

  it('refuses a token from another issuer', async () => {
    const token = await sign({}, { issuer: 'https://other.supabase.co/auth/v1' })
    await expect(verifyAccessToken(token)).rejects.toThrow()
  })

  it('refuses a token signed with a key that is not published', async () => {
    const token = await sign({}, { key: otherPrivateKey })
    await expect(verifyAccessToken(token)).rejects.toThrow()
  })

  it('refuses a tampered payload', async () => {
    const token = await sign({ role: 'customer' })
    const [header, , signature] = token.split('.')
    const forged = Buffer.from(JSON.stringify({ sub: 'user-2', iss: issuer, aud: 'authenticated', iat: 1, exp: 9999999999 })).toString('base64url')
    await expect(verifyAccessToken(`${header}.${forged}.${signature}`)).rejects.toThrow()
  })

  it('refuses a token with no subject', async () => {
    const token = await sign({}, { subject: null })
    await expect(verifyAccessToken(token)).rejects.toThrow('no subject')
  })
})
