import { describe, expect, it } from 'vitest'
import { getServiceFallback } from './serviceFallback'

describe('service artwork fallback', () => {
  it('prefers a photo', () => expect(getServiceFallback(true)).toBe('photo'))
  it('falls back to SVG', () => expect(getServiceFallback(false, true)).toBe('svg'))
  it('falls back to gradient', () => expect(getServiceFallback(false, false)).toBe('gradient'))
})
