import { describe, expect, it } from 'vitest'
import { customerContent } from '../content/customer'
import { getRealtimeToastMessage } from './realtimeNotifications'

describe('getRealtimeToastMessage', () => {
  const acceptedBooking = {
    type: 'booking.updated',
    payload: { bookingId: 'booking-123', status: 'accepted' },
  }

  it('notifies a customer when a vendor accepts a booking', () => {
    expect(getRealtimeToastMessage('customer', acceptedBooking)).toBe(
      customerContent.bookings.acceptedRealtimeUpdate,
    )
  })

  it('does not show customer acceptance messages to other roles', () => {
    expect(getRealtimeToastMessage('vendor', acceptedBooking)).toBeNull()
    expect(getRealtimeToastMessage('admin', acceptedBooking)).toBeNull()
  })

  it('ignores other events and incomplete booking updates', () => {
    expect(getRealtimeToastMessage('customer', { ...acceptedBooking, type: 'notification.created' })).toBeNull()
    expect(getRealtimeToastMessage('customer', { type: 'booking.updated', payload: { status: 'accepted' } })).toBeNull()
    expect(getRealtimeToastMessage('customer', { type: 'booking.updated', payload: { bookingId: 'booking-123', status: 'en_route' } })).toBeNull()
  })
})
