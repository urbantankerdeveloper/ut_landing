import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getOrCreateTrackingToken: vi.fn(),
  notifyCustomer: vi.fn(),
  sendTemplateEmail: vi.fn(),
  sendTemplateWhatsApp: vi.fn(),
  getUserById: vi.fn(),
  groupLeadId: 'booking-1' as string | null,
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
      let selectedFields = ''
      let isUpdate = false
      let updateId = ''
      let updateField = ''
      const builder = {
        select: (fields: string) => {
          selectedFields = fields
          return builder
        },
        eq: (field: string, value: string) => {
          if (isUpdate && field === 'id') updateId = value
          return builder
        },
        order: () => builder,
        limit: () => builder,
        is: () => builder,
        update: (payload: Record<string, unknown>) => {
          isUpdate = true
          updateField = Object.keys(payload)[0] ?? ''
          return builder
        },
        maybeSingle: async () => {
          if (isUpdate) {
            const claimKey = `${updateField}:${updateId}`
            if (mocks.claimedBookings.has(claimKey)) return { data: null, error: null }
            mocks.claimedBookings.add(claimKey)
            return { data: { id: updateId }, error: null }
          }
          if (table === 'bookings' && selectedFields === 'id') {
            return mocks.groupLeadId ? { data: { id: mocks.groupLeadId }, error: null } : { data: null, error: null }
          }
          return mocks.rows[table]
        },
      }
      return builder
    },
    auth: { admin: { getUserById: mocks.getUserById } },
  },
}))
vi.mock('./customerNotifications.js', () => ({
  notifyCustomer: mocks.notifyCustomer,
}))
vi.mock('./emailTemplates.js', () => ({
  bookingStatusEmailTemplates: {
    pending_vendor: 'booking_pending_vendor',
    vendor_assigned: 'booking_vendor_assigned',
    accepted: 'booking_accepted',
    en_route: 'booking_en_route',
    arrived: 'booking_arrived',
    cancelled: 'booking_cancelled',
    payment_online: 'booking_payment_online',
    payment_cod: 'booking_payment_cod',
    rescheduled: 'booking_rescheduled',
    delivered: 'booking_delivered',
  },
  sendTemplateEmail: mocks.sendTemplateEmail,
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
  notifyCustomerOfBookingStatus,
  notifyCustomerOfBookingWhatsApp,
} from './bookingNotifications.js'

describe('notifyCustomerOfAssignment', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.claimedBookings.clear()
    mocks.groupLeadId = 'booking-1'
    mocks.getOrCreateTrackingToken.mockResolvedValue({ token: 'track-token' })
    mocks.rows.profiles = { data: { phone_e164: '+919876543210' }, error: null }
    mocks.rows.bookings = {
      data: {
        id: 'booking-1',
        reference: 'UT-100',
        customer_id: 'customer-1',
        customer_email: null,
        customer_phone_e164: '+919123456789',
      },
      error: null,
    }
    mocks.rows.vehicles = {
      data: { registration_number: 'TN-01-AB-1234' },
      error: null,
    }
    mocks.rows.drivers = { data: { name: 'Ravi' }, error: null }
    mocks.getUserById.mockResolvedValue({
      data: { user: { email: 'customer@example.com' } },
      error: null,
    })
    mocks.sendTemplateEmail.mockResolvedValue({ queued: true })
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
    expect(mocks.sendTemplateEmail).toHaveBeenCalledWith(
      'vendor_acceptance',
      'customer@example.com',
      expect.objectContaining({
        reference: 'UT-100',
        vehicle: 'TN-01-AB-1234',
        driver: 'Ravi',
        trackingUrl: 'https://urban-tanker.example/track/track-token',
      }),
    )
  })

  it('uses the verified profile phone when the booking has no separate contact', async () => {
    mocks.rows.bookings = {
      data: { id: 'booking-1', reference: 'UT-100', customer_id: 'customer-1', customer_phone_e164: null },
      error: null,
    }

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
    expect(mocks.sendTemplateEmail).toHaveBeenCalledWith(
      'guest_booking_confirmation',
      'customer@example.com',
      {
        reference: 'UT-100',
        trackingUrl: 'https://urban-tanker.example/track/track-token',
      },
    )
  })

  it('claims and sends one group confirmation using the group reference and lead tracking link', async () => {
    mocks.rows.bookings = {
      data: {
        id: 'booking-2',
        reference: 'UT-GROUP-02',
        customer_id: 'customer-1',
        customer_phone_e164: '+919123456789',
        order_group_id: 'group-1',
        order_group_reference: 'UT-GROUP',
      },
      error: null,
    }

    await notifyCustomerOfBooking('+919123456789', 'booking-2', 'UT-GROUP-02')

    expect(mocks.getOrCreateTrackingToken).toHaveBeenCalledWith('booking-1')
    expect(mocks.sendTemplateWhatsApp).toHaveBeenCalledWith(
      'guest_booking_confirmation',
      '+919123456789',
      {
        reference: 'UT-GROUP',
        trackingUrl: 'https://urban-tanker.example/track/track-token',
      },
    )
  })

  it('uses the registered profile phone when the booking has no contact phone', async () => {
    mocks.rows.bookings = {
      data: { id: 'booking-1', customer_id: 'customer-1', customer_phone_e164: null },
      error: null,
    }

    await notifyCustomerOfBooking(null, 'booking-1', 'UT-100')

    expect(mocks.sendTemplateWhatsApp).toHaveBeenCalledWith(
      'guest_booking_confirmation',
      '+919876543210',
      expect.objectContaining({ reference: 'UT-100' }),
    )
  })

  it.each([
    ['pending_vendor', 'booking_pending_vendor'],
    ['vendor_assigned', 'booking_vendor_assigned'],
    ['accepted', 'booking_accepted'],
    ['en_route', 'booking_en_route'],
    ['arrived', 'booking_arrived'],
    ['cancelled', 'booking_cancelled'],
    ['payment_online', 'booking_payment_online'],
    ['payment_cod', 'booking_payment_cod'],
    ['rescheduled', 'booking_rescheduled'],
    ['delivered', 'booking_delivered'],
  ] as const)('uses the %s email for that booking status', async (event, template) => {
    await notifyCustomerOfBookingStatus('booking-1', event)

    expect(mocks.sendTemplateEmail).toHaveBeenCalledWith(
      template,
      'customer@example.com',
      expect.objectContaining({ reference: 'UT-100' }),
    )
  })

  it('sends status updates to the booking phone with its stable tracking link', async () => {
    await notifyCustomerOfBookingStatus('booking-1', 'en_route')

    expect(mocks.sendTemplateWhatsApp).toHaveBeenCalledWith(
      'booking_status_update',
      '+919123456789',
      {
        reference: 'UT-100',
        status: 'Tanker on the way',
        detail: 'Your tanker is on the way to the delivery location.',
        trackingUrl: 'https://urban-tanker.example/track/track-token',
      },
    )
    expect(mocks.sendTemplateEmail).toHaveBeenCalledWith(
      'booking_en_route',
      'customer@example.com',
      {
        reference: 'UT-100',
        status: 'Tanker on the way',
        detail: 'Your tanker is on the way to the delivery location.',
        trackingUrl: 'https://urban-tanker.example/track/track-token',
      },
    )
  })

  it('uses one group lead reference and tracking link for every grouped booking event', async () => {
    mocks.groupLeadId = 'booking-1'
    mocks.rows.bookings = {
      data: {
        id: 'booking-2',
        reference: 'UT-GROUP-02',
        customer_id: 'customer-1',
        customer_phone_e164: '+919123456789',
        order_group_id: 'group-1',
        order_group_reference: 'UT-GROUP',
      },
      error: null,
    }

    await notifyCustomerOfBookingStatus('booking-2', 'en_route')

    expect(mocks.getOrCreateTrackingToken).toHaveBeenCalledWith('booking-1')
    expect(mocks.sendTemplateWhatsApp).toHaveBeenCalledWith(
      'booking_status_update',
      '+919123456789',
      expect.objectContaining({
        reference: 'UT-GROUP',
        trackingUrl: 'https://urban-tanker.example/track/track-token',
      }),
    )
  })

  it('uses the group lead tracking link when a grouped booking is accepted', async () => {
    mocks.rows.bookings = {
      data: {
        id: 'booking-2',
        reference: 'UT-GROUP-02',
        customer_id: 'customer-1',
        customer_phone_e164: '+919123456789',
        order_group_id: 'group-1',
        order_group_reference: 'UT-GROUP',
      },
      error: null,
    }

    await notifyCustomerOfAssignment({
      id: 'booking-2',
      reference: 'UT-GROUP-02',
      customer_id: 'customer-1',
      customer_phone_e164: '+919123456789',
    })

    expect(mocks.getOrCreateTrackingToken).toHaveBeenCalledWith('booking-1')
    expect(mocks.sendTemplateWhatsApp).toHaveBeenCalledWith(
      'vendor_acceptance',
      '+919123456789',
      expect.objectContaining({
        reference: 'UT-GROUP',
        trackingUrl: 'https://urban-tanker.example/track/track-token',
      }),
    )
  })

  it('sends delivery confirmation over email as well as WhatsApp', async () => {
    await notifyCustomerOfBookingWhatsApp('booking-1', 'delivery_confirmation', {})

    expect(mocks.sendTemplateWhatsApp).toHaveBeenCalledWith(
      'delivery_confirmation',
      '+919123456789',
      { reference: 'UT-100' },
    )
    expect(mocks.sendTemplateEmail).toHaveBeenCalledWith(
      'delivery_confirmation',
      'customer@example.com',
      { reference: 'UT-100' },
    )
  })

  it('does not email a guest account placeholder address', async () => {
    mocks.getUserById.mockResolvedValue({
      data: { user: { email: 'guest_123@guest.urbantanker.local', app_metadata: { booking_email: 'previous@example.com' } } },
      error: null,
    })
    mocks.rows.bookings = {
      data: { id: 'booking-1', customer_id: 'customer-1', customer_email: null, customer_phone_e164: '+919123456789' },
      error: null,
    }

    await notifyCustomerOfBookingStatus('booking-1', 'en_route')

    expect(mocks.sendTemplateEmail).not.toHaveBeenCalled()
    expect(mocks.sendTemplateWhatsApp).toHaveBeenCalledTimes(1)
  })

  it('uses the optional email stored on a guest booking instead of the placeholder account address', async () => {
    mocks.rows.bookings = {
      data: {
        id: 'booking-1',
        reference: 'UT-100',
        customer_id: 'customer-1',
        customer_email: 'guest@example.com',
        customer_phone_e164: '+919123456789',
      },
      error: null,
    }
    mocks.getUserById.mockResolvedValue({
      data: {
        user: {
          email: 'guest_123@guest.urbantanker.local',
          app_metadata: { role: 'customer', booking_email: 'previous@example.com' },
        },
      },
      error: null,
    })

    await notifyCustomerOfBookingStatus('booking-1', 'en_route')

    expect(mocks.sendTemplateEmail).toHaveBeenCalledWith(
      'booking_en_route',
      'guest@example.com',
      expect.objectContaining({
        trackingUrl: 'https://urban-tanker.example/track/track-token',
      }),
    )
  })

  it('uses the registered account email even if a booking contains another email', async () => {
    mocks.rows.bookings = {
      data: {
        id: 'booking-1',
        reference: 'UT-100',
        customer_id: 'customer-1',
        customer_email: 'other@example.com',
        customer_phone_e164: '+919123456789',
      },
      error: null,
    }

    await notifyCustomerOfBookingStatus('booking-1', 'en_route')

    expect(mocks.sendTemplateEmail).toHaveBeenCalledWith(
      'booking_en_route',
      'customer@example.com',
      expect.any(Object),
    )
  })

  it('sends booking-specific event templates to the booking contact', async () => {
    await notifyCustomerOfBookingWhatsApp('booking-1', 'delivery_confirmation', {})

    expect(mocks.sendTemplateWhatsApp).toHaveBeenCalledWith(
      'delivery_confirmation',
      '+919123456789',
      { reference: 'UT-100' },
    )
  })
})
