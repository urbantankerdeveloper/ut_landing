import { describe, expect, it } from 'vitest'
import { escapeIlike, hasRecoveryClaim, passwordWithinBcryptLimit, refreshTokenForClient } from './auth.js'

function jwtWith(payload: unknown) {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url')
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode(payload)}.signature-placeholder`
}

describe('escapeIlike', () => {
  it('escapes LIKE wildcards and the escape character so a username matches literally', () => {
    expect(escapeIlike('a_b%c')).toBe('a\\_b\\%c')
    expect(escapeIlike('back\\slash')).toBe('back\\\\slash')
    expect(escapeIlike('plain.name')).toBe('plain.name')
  })
})

describe('passwordWithinBcryptLimit', () => {
  it('caps signup passwords at 72 bytes, not characters', () => {
    expect(passwordWithinBcryptLimit('a'.repeat(72))).toBe(true)
    expect(passwordWithinBcryptLimit('a'.repeat(73))).toBe(false)
    expect(passwordWithinBcryptLimit('é'.repeat(37))).toBe(false)
  })
})

describe('refreshTokenForClient', () => {
  it('returns the refresh token in the body only for the exact mobile platform header', () => {
    expect(refreshTokenForClient('mobile', 'rt')).toEqual({ refreshToken: 'rt' })
    expect(refreshTokenForClient('web', 'rt')).toEqual({})
    expect(refreshTokenForClient('Mobile', 'rt')).toEqual({})
    expect(refreshTokenForClient(undefined, 'rt')).toEqual({})
  })
})

describe('hasRecoveryClaim', () => {
  it('accepts a recovery amr entry', () => {
    expect(hasRecoveryClaim(jwtWith({ amr: [{ method: 'recovery', timestamp: 1 }] }))).toBe(true)
    expect(hasRecoveryClaim(jwtWith({ amr: ['recovery'] }))).toBe(true)
  })
  it('rejects password sessions, missing claims and malformed tokens', () => {
    expect(hasRecoveryClaim(jwtWith({ amr: [{ method: 'password', timestamp: 1 }] }))).toBe(false)
    expect(hasRecoveryClaim(jwtWith({ sub: 'user' }))).toBe(false)
    expect(hasRecoveryClaim('not-a-jwt')).toBe(false)
    expect(hasRecoveryClaim(`h.${Buffer.from('not json').toString('base64url')}.s`)).toBe(false)
  })
})
