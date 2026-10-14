import { describe, expect, it } from 'vitest'
import { isBookingTransitionAllowed } from './bookingLifecycle.js'

describe('booking lifecycle transitions', () => {
  it('allows customer cancellation before delivery', () => {
    expect(isBookingTransitionAllowed('pending_vendor', 'cancelled')).toBe(true)
    expect(isBookingTransitionAllowed('accepted', 'cancelled')).toBe(true)
  })

  it('prevents terminal and backwards transitions', () => {
    expect(isBookingTransitionAllowed('delivered', 'cancelled')).toBe(false)
    expect(isBookingTransitionAllowed('arrived', 'accepted')).toBe(false)
  })
})
