import { describe, expect, it } from 'vitest'
import { defaultFeatureFlags, resolveFeatureFlags } from './featureFlags.js'

describe('resolveFeatureFlags', () => {
  it('uses the documented defaults and applies boolean overrides', () => {
    expect(resolveFeatureFlags()).toEqual(defaultFeatureFlags)
    expect(defaultFeatureFlags.admin_approval_required_enabled).toBe(false)
    expect(resolveFeatureFlags('{"duplicate_phone_check_enabled":false}')).toEqual({
      ...defaultFeatureFlags,
      duplicate_phone_check_enabled: false,
    })
    expect(resolveFeatureFlags('{"admin_approval_required_enabled":true}').admin_approval_required_enabled).toBe(true)
  })

  it('keeps online checkout enabled by default when the wallet is disabled', () => {
    const flags = resolveFeatureFlags('{}', false)
    expect(flags.online_payment_enabled).toBe(true)
    expect(flags.wallet_enabled).toBe(false)
  })

  it('lets WALLET_ENABLED override the JSON flag for both clients', () => {
    expect(resolveFeatureFlags('{}', true).wallet_enabled).toBe(true)
    expect(
      resolveFeatureFlags('{"wallet_enabled":true}', false).wallet_enabled,
    ).toBe(false)
  })

  it('rejects malformed, unknown, and non-boolean overrides', () => {
    expect(() => resolveFeatureFlags('{')).toThrow('valid JSON')
    expect(() => resolveFeatureFlags('{"unknown_flag":true}')).toThrow('unknown flag')
    expect(() => resolveFeatureFlags('{"wallet_enabled":"false"}')).toThrow('non-boolean')
  })
})
