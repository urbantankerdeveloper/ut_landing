import { describe, expect, it } from 'vitest'
import { realtimeContent } from '../content/realtime'
import { getRealtimeNotice, unreadNotificationIdsSince } from './realtimeNotifications'

describe('getRealtimeNotice', () => {
  const acceptedBooking = {
    type: 'booking.updated',
    payload: { bookingId: 'booking-123', status: 'accepted' },
  }

  it('tells a customer when a vendor accepts, using the same key for the generic and specific events', () => {
    const generic = getRealtimeNotice('customer', acceptedBooking)
    const specific = getRealtimeNotice('customer', { type: 'booking.vendor_accepted', payload: { bookingId: 'booking-123', vendorId: 'v1', reference: 'R1' } })
    expect(generic?.message).toBe(realtimeContent.customer.accepted)
    expect(specific).toEqual(generic)
  })

  it('marks delivery as a success notice', () => {
    expect(getRealtimeNotice('customer', { type: 'booking.delivered', payload: { bookingId: 'booking-123' } })).toMatchObject({
      message: realtimeContent.customer.delivered,
      tone: 'success',
    })
  })

  it('flags a new vendor order as a new-order alert with its booking and reference', () => {
    expect(getRealtimeNotice('vendor', { type: 'vendor.order.created', payload: { bookingId: 'booking-9', reference: 'UT-9' } })).toEqual({
      key: 'offer:booking-9',
      message: realtimeContent.vendor.newOrder('UT-9'),
      tone: 'info',
      newOrder: true,
      offer: { bookingId: 'booking-9', reference: 'UT-9' },
    })
  })

  it('prefers the server message when another vendor takes an order, and closes that order\'s offer', () => {
    expect(getRealtimeNotice('vendor', { type: 'vendor.order.taken', payload: { bookingId: 'booking-9', reference: 'UT-9', message: 'Taken elsewhere' } })).toMatchObject({
      message: 'Taken elsewhere',
      closesKey: 'offer:booking-9',
    })
  })

  it('does not send notices to other roles or for unrelated or incomplete events', () => {
    expect(getRealtimeNotice('admin', acceptedBooking)).toBeNull()
    expect(getRealtimeNotice('vendor', acceptedBooking)).toBeNull()
    expect(getRealtimeNotice('customer', { type: 'notification.created', payload: { bookingId: 'booking-123' } })).toBeNull()
    expect(getRealtimeNotice('customer', { type: 'booking.updated', payload: { status: 'accepted' } })).toBeNull()
    expect(getRealtimeNotice('customer', { type: 'booking.updated', payload: { bookingId: 'booking-123', status: 'unknown_status' } })).toBeNull()
  })
})

describe('unreadNotificationIdsSince', () => {
  const since = Date.parse('2030-01-01T10:00:00Z')

  it('keeps only unread rows created after the connection dropped', () => {
    const rows = [
      { id: 'missed', created_at: '2030-01-01T10:05:00Z', read_at: null },
      { id: 'already-read', created_at: '2030-01-01T10:05:00Z', read_at: '2030-01-01T10:06:00Z' },
      { id: 'before-drop', created_at: '2030-01-01T09:59:00Z', read_at: null },
    ]
    expect(unreadNotificationIdsSince(rows, since)).toEqual(['missed'])
  })

  it('ignores rows with an unparseable timestamp', () => {
    expect(unreadNotificationIdsSince([{ id: 'bad', created_at: 'not-a-date', read_at: null }], since)).toEqual([])
  })
})
