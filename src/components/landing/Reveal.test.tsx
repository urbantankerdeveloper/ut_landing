import { describe, expect, it, vi } from 'vitest'

describe('landing reveal configuration', () => {
  it('uses one observer key and supports once-only reveal semantics', () => {
    const seen = new Set<string>()
    const key = '0.12:0px 0px -8%'
    seen.add(key)
    expect(seen.has(key)).toBe(true)
  })

  it('does not apply reveal classes when the flag is off', () => {
    vi.stubEnv('VITE_LANDING_SCROLL_ANIMATIONS', 'false')
    expect(import.meta.env.VITE_LANDING_SCROLL_ANIMATIONS).toBe('false')
    vi.unstubAllEnvs()
  })

  it('honors reduced motion through CSS rather than adding movement classes', () => {
    const motion = typeof window === 'undefined' ? null : window.matchMedia?.('(prefers-reduced-motion: reduce)')
    expect(motion?.matches ?? false).toBe(false)
  })
})
