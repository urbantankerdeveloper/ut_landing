import { describe, expect, it } from 'vitest'
import { loggablePath } from './observability.js'

describe('loggablePath', () => {
  it('replaces the tracking token in logged paths', () => {
    expect(loggablePath('/api/public/tracking/abcDEF123_-abcDEF123_-abcDEF123_-abcDEF123_-')).toBe('/api/public/tracking/:token')
  })

  it('leaves other paths unchanged', () => {
    expect(loggablePath('/api/customer/bookings/123')).toBe('/api/customer/bookings/123')
  })
})
