import { describe, expect, it } from 'vitest'
import { defaultFeatureFlags, resolveFeatureFlags } from './featureFlags.js'

describe('resolveFeatureFlags', () => {
  it('uses the documented defaults and applies boolean overrides', () => {
    expect(resolveFeatureFlags()).toEqual(defaultFeatureFlags)
    expect(resolveFeatureFlags('{"duplicate_phone_check_enabled":false}')).toEqual({
      ...defaultFeatureFlags,
      duplicate_phone_check_enabled: false,
    })
  })

  it('rejects malformed, unknown, and non-boolean overrides', () => {
    expect(() => resolveFeatureFlags('{')).toThrow('valid JSON')
    expect(() => resolveFeatureFlags('{"unknown_flag":true}')).toThrow('unknown flag')
    expect(() => resolveFeatureFlags('{"wallet_enabled":"false"}')).toThrow('non-boolean')
  })
})
