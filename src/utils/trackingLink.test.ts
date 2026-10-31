import { describe, expect, it } from 'vitest'
import { appTrackingLink, isMobileUserAgent } from './trackingLink'

describe('tracking link helpers', () => {
  it('detects phone and tablet browsers', () => {
    expect(isMobileUserAgent('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/126 Mobile Safari/537.36')).toBe(true)
    expect(isMobileUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15')).toBe(true)
  })

  it('treats desktop browsers as non-mobile', () => {
    expect(isMobileUserAgent('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/126 Safari/537.36')).toBe(false)
  })

  it('builds the app deep link for a token', () => {
    expect(appTrackingLink('abc_DEF-123')).toBe('urbantanker://track/abc_DEF-123')
  })
})
