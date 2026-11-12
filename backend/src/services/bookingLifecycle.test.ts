import { describe, expect, it } from 'vitest'
import { canCustomerCancelBooking, isBookingTransitionAllowed } from './bookingLifecycle.js'

describe('booking lifecycle transitions', () => {
  it('allows lifecycle cancellation from active states', () => {
    expect(isBookingTransitionAllowed('pending_vendor', 'cancelled')).toBe(true)
    expect(isBookingTransitionAllowed('accepted', 'cancelled')).toBe(true)
  })

  it('allows customer cancellation only before the vendor accepts', () => {
    expect(canCustomerCancelBooking('pending_vendor')).toBe(true)
    expect(canCustomerCancelBooking('vendor_assigned')).toBe(true)
    expect(canCustomerCancelBooking('accepted')).toBe(false)
    expect(canCustomerCancelBooking('en_route')).toBe(false)
  })

  it('prevents terminal and backwards transitions', () => {
    expect(isBookingTransitionAllowed('delivered', 'cancelled')).toBe(false)
    expect(isBookingTransitionAllowed('arrived', 'accepted')).toBe(false)
  })
})
