import { describe, expect, it } from 'vitest'
import { resolveWriteMessage } from './writeMessages'
import { feedbackContent } from './feedback'

describe('resolveWriteMessage', () => {
  it('names the action for a route with an id', () => {
    expect(resolveWriteMessage('DELETE', '/admin/vendors/abc-123')).toEqual({ message: 'Vendor deleted.', silent: false })
  })

  it('ignores the query string when matching', () => {
    expect(resolveWriteMessage('PATCH', '/customer/profile?source=web').message).toBe('Profile updated.')
  })

  it('matches on method as well as path', () => {
    expect(resolveWriteMessage('PATCH', '/customer/addresses/9').message).toBe(feedbackContent.success.saved)
    expect(resolveWriteMessage('DELETE', '/customer/addresses/9').message).toBe('Address deleted.')
  })

  it('stays silent for background calls such as location pings', () => {
    expect(resolveWriteMessage('POST', '/vendor/location').silent).toBe(true)
    expect(resolveWriteMessage('POST', '/customer/orders/quote').silent).toBe(true)
  })

  it('falls back to the generic saved text for unlisted routes', () => {
    expect(resolveWriteMessage('POST', '/unknown/route')).toEqual({ message: feedbackContent.success.saved, silent: false })
  })
})
