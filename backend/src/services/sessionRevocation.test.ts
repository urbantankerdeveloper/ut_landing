import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./scaling.js', () => ({ getRedisPair: () => null }))

import { clearLocalRevocations, isTokenRevoked, revokeSession, revokeUserTokens } from './sessionRevocation.js'

describe('session revocation', () => {
  beforeEach(() => {
    clearLocalRevocations()
  })

  it('refuses only the revoked session', async () => {
    await revokeSession('session-a')
    expect(await isTokenRevoked({ sub: 'user-1', iat: 1, session_id: 'session-a' })).toBe(true)
    expect(await isTokenRevoked({ sub: 'user-1', iat: 1, session_id: 'session-b' })).toBe(false)
  })

  it('refuses tokens issued before a user cutoff and allows newer ones', async () => {
    await revokeUserTokens('user-1', 1_000)
    expect(await isTokenRevoked({ sub: 'user-1', iat: 999 })).toBe(true)
    expect(await isTokenRevoked({ sub: 'user-1', iat: 1_000 })).toBe(false)
    expect(await isTokenRevoked({ sub: 'user-2', iat: 1 })).toBe(false)
  })
})
