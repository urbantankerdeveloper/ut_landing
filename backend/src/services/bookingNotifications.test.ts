import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getOrCreateTrackingToken: vi.fn(),
  notifyCustomer: vi.fn(),
  notifyUser: vi.fn(),
  sendTemplateWhatsApp: vi.fn(),
  getUserById: vi.fn(),
  claimedBookings: new Set<string>(),
  rows: {} as Record<string, { data: unknown; error: null }>,
}))

vi.mock('../config.js', () => ({
  config: { FRONTEND_ORIGIN: 'https://urban-tanker.example' },
}))
vi.mock('../lib/logger.js', () => ({
  logger: { warn: vi.fn(), error: vi.fn() },
}))
vi.mock('../supabase.js', () => ({
  supabase: {
    from: (table: string) => {
      const builder = {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => mocks.rows[table],
          }),
        }),
        update: () => ({
          eq: () => ({
            is: () => ({
              select: () => ({
                maybeSingle: async () => {
                  if (mocks.claimedBookings.has('booking-1')) return { data: null, error: null }
                  mocks.claimedBookings.add('booking-1')
                  return { data: { id: 'booking-1' }, error: null }
                },
              }),
            }),
          }),
        }),
      }
      return builder
    },
    auth: { admin: { getUserById: mocks.getUserById } },
  },
}))
vi.mock('./customerNotifications.js', () => ({
  notifyCustomer: mocks.notifyCustomer,
}))
vi.mock('./providers.js', () => ({
  notifyUser: mocks.notifyUser,
}))
vi.mock('./whatsapp.js', () => ({
  sendTemplateWhatsApp: mocks.sendTemplateWhatsApp,
}))
vi.mock('./trackingTokens.js', () => ({
  getOrCreateTrackingToken: mocks.getOrCreateTrackingToken,
}))

import {
  notifyCustomerOfAssignment,
  notifyCustomerOfBooking,
} from './bookingNotifications.js'

describe('notifyCustomerOfAssignment', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.claimedBookings.clear()
    mocks.getOrCreateTrackingToken.mockResolvedValue({ token: 'track-token' })
    mocks.rows.profiles = { data: { phone_e164: '+919876543210' }, error: null }
    mocks.rows.vehicles = {
      data: { registration_number: 'TN-01-AB-1234' },
      error: null,
    }
    mocks.rows.drivers = { data: { name: 'Ravi' }, error: null }
    mocks.getUserById.mockResolvedValue({
      data: { user: { email: 'customer@example.com' } },
      error: null,
    })
    mocks.notifyUser.mockResolvedValue({ email: { queued: true } })
    mocks.sendTemplateWhatsApp.mockResolvedValue({ queued: true })
  })

  it('sends the accepted booking tracking link to its booking contact number', async () => {
    await notifyCustomerOfAssignment({
      id: 'booking-1',
      reference: 'UT-100',
      customer_id: 'customer-1',
      customer_phone_e164: '+919123456789',
      vehicle_id: 'vehicle-1',
      driver_id: 'driver-1',
    })

    expect(mocks.sendTemplateWhatsApp).toHaveBeenCalledWith(
      'vendor_acceptance',
      '+919123456789',
      {
        reference: 'UT-100',
        vehicle: 'TN-01-AB-1234',
        driver: 'Ravi',
        trackingUrl: 'https://urban-tanker.example/track/track-token',
      },
    )
  })

  it('uses the verified profile phone when the booking has no separate contact', async () => {
    await notifyCustomerOfAssignment({
      id: 'booking-1',
      reference: 'UT-100',
      customer_id: 'customer-1',
    })

    expect(mocks.sendTemplateWhatsApp).toHaveBeenCalledWith(
      'vendor_acceptance',
      '+919876543210',
      expect.objectContaining({
        trackingUrl: 'https://urban-tanker.example/track/track-token',
      }),
    )
  })

  it('sends a stable tracking link to the booking phone after payment or COD confirmation', async () => {
    await notifyCustomerOfBooking('+919123456789', 'booking-1', 'UT-100')
    await notifyCustomerOfBooking('+919123456789', 'booking-1', 'UT-100')

    expect(mocks.sendTemplateWhatsApp).toHaveBeenCalledTimes(1)
    expect(mocks.sendTemplateWhatsApp).toHaveBeenCalledWith(
      'guest_booking_confirmation',
      '+919123456789',
      {
        reference: 'UT-100',
        trackingUrl: 'https://urban-tanker.example/track/track-token',
      },
    )
  })
})
