import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Server } from 'socket.io'

const socket = vi.hoisted(() => {
  const emit = vi.fn()
  const to = vi.fn(() => ({ emit }))
  return { emit, to }
})

vi.mock('../supabase.js', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: async () => ({ data: [], error: null }),
      }),
    }),
  },
}))

import { emitBookingLifecycleEvent, emitRealtime, setRealtimeServer } from './realtime.js'

describe('booking realtime updates', () => {
  beforeEach(() => {
    socket.to.mockClear()
    socket.emit.mockClear()
    socket.to.mockImplementation(() => ({ emit: socket.emit }))
    setRealtimeServer(socket as unknown as Server)
  })

  it('sends booking updates to the customer, booking, and admin rooms', () => {
    const payload = { bookingId: 'booking-1', status: 'accepted' }

    emitRealtime('booking.updated', payload, 'customer-1')

    expect(socket.to).toHaveBeenCalledWith(['booking:booking-1', 'admins', 'customer:customer-1'])
    expect(socket.emit).toHaveBeenCalledWith('booking.updated', payload)
  })

  it('keeps customer rooms out of untargeted booking updates', () => {
    const payload = { bookingId: 'booking-1', status: 'accepted' }

    emitRealtime('booking.updated', payload)

    expect(socket.to).toHaveBeenCalledWith(['booking:booking-1', 'admins'])
  })

  it('routes lifecycle events to the same rooms as booking updates, not a global broadcast', () => {
    const payload = { bookingId: 'booking-1', vendorId: 'vendor-1', reference: 'UT-1' }

    emitBookingLifecycleEvent('booking.vendor_accepted', payload, 'customer-1')

    expect(socket.to).toHaveBeenCalledWith(['booking:booking-1', 'admins', 'customer:customer-1'])
    expect(socket.emit).toHaveBeenCalledWith('booking.vendor_accepted', payload)
  })
})
