import { describe, expect, it } from 'vitest'
import { refundAmountInPaise, signaturesMatch } from './paymentSecurity.js'

describe('payment security helpers', () => {
  it('compares signatures without accepting different lengths', () => {
    expect(signaturesMatch('abc', 'abc')).toBe(true)
    expect(signaturesMatch('abc', 'abd')).toBe(false)
    expect(signaturesMatch('abc', 'ab')).toBe(false)
  })

  it('bounds partial refunds to the captured amount', () => {
    expect(refundAmountInPaise(undefined, 185000)).toBe(185000)
    expect(refundAmountInPaise(500, 185000)).toBe(50000)
    expect(() => refundAmountInPaise(2000, 185000)).toThrow()
  })
})
