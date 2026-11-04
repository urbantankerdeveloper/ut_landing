import { describe, expect, it } from 'vitest'
import { corsOriginProblem, isAllowedCorsOrigin } from './corsOrigins.js'

describe('isAllowedCorsOrigin', () => {
  const allowed = ['https://urbantanker.in']

  it('allows listed origins and requests without an Origin header', () => {
    expect(isAllowedCorsOrigin('https://urbantanker.in', allowed, 'production')).toBe(true)
    expect(isAllowedCorsOrigin(undefined, allowed, 'production')).toBe(true)
  })

  it('rejects unlisted origins', () => {
    expect(isAllowedCorsOrigin('https://evil.example', allowed, 'production')).toBe(false)
  })

  it('allows localhost on any port only outside production', () => {
    expect(isAllowedCorsOrigin('http://localhost:5173', allowed, 'development')).toBe(true)
    expect(isAllowedCorsOrigin('http://localhost:50767', allowed, 'development')).toBe(true)
    expect(isAllowedCorsOrigin('http://localhost:5173', allowed, 'production')).toBe(false)
  })
})

describe('corsOriginProblem', () => {
  it('accepts https origins in production', () => {
    expect(corsOriginProblem(['https://urbantanker.in', 'https://www.urbantanker.in'], 'production')).toBeNull()
  })

  it('rejects http, paths and invalid entries in production', () => {
    expect(corsOriginProblem(['http://urbantanker.in'], 'production')).toContain('https')
    expect(corsOriginProblem(['https://urbantanker.in/app'], 'production')).toContain('https')
    expect(corsOriginProblem(['not a url'], 'production')).toContain('not a valid URL')
  })

  it('does not check development origins', () => {
    expect(corsOriginProblem(['http://localhost:5173'], 'development')).toBeNull()
  })
})
