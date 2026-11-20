import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { customerApi } from './customer'
import { useAuthStore } from '../stores/authStore'

function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

describe('customerApi requests', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.stubGlobal('window', globalThis)
    vi.stubGlobal('sessionStorage', { getItem: vi.fn(), setItem: vi.fn(), removeItem: vi.fn() })
    useAuthStore.setState({ user: null, accessToken: 'token' })
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('treats an already-processed verify (409) as verified', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: 'This payment has already been processed.' }, 409)))

    await expect(customerApi.verifyPayment({ orderId: 'order_1', paymentId: 'pay_1', signature: 'sig' })).resolves.toEqual({ verified: true, orderId: 'order_1' })
  })

  it('still fails verify on an amount mismatch (409)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: 'Payment amount does not match this booking. Contact support.' }, 409)))

    await expect(customerApi.verifyPayment({ orderId: 'order_1', paymentId: 'pay_1', signature: 'sig' })).rejects.toThrow('Payment amount does not match this booking. Contact support.')
  })

  it('returns null for a receipt when the booking has no payment row', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: 'Payment not found.' }, 404)))

    await expect(customerApi.getPaymentReceipt('booking_1')).resolves.toBeNull()
  })

  it('posts the COD-to-online switch and surfaces a rejection once cash is collected', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ error: 'Online payment is no longer available for this booking.' }, 409))
    vi.stubGlobal('fetch', fetchMock)

    await expect(customerApi.switchBookingToOnline('booking_1')).rejects.toThrow('Online payment is no longer available for this booking.')
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/customer/orders/booking_1/payment-method/online')
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: 'POST' })
  })

  it('returns the delivery OTP for the requested booking', async () => {
    const expiresAt = '2026-11-12T06:00:00.000Z'
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ otp: '483921', expiresAt, smsSent: false }, 201))
    vi.stubGlobal('fetch', fetchMock)

    await expect(customerApi.requestDeliveryOtp('booking_1')).resolves.toEqual({
      otp: '483921',
      expiresAt,
      smsSent: false,
    })
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/customer/orders/booking_1/delivery-otp')
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: 'POST' })
  })

  it('normalizes parent orders with item and fulfilment detail', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
      rows: [{
        id: 'order-1',
        reference: 'UT-ORDER-1',
        status: 'partially_accepted',
        total_paise: 8500,
        items: [{
          id: 'item-1',
          service_type_id: 'water_tanker',
          service_type: { name: 'Water delivery' },
          status: 'accepted',
          price_paise: 5000,
          service_details: { serviceId: 'water_tanker', capacity: '5 KL' },
        }],
        fulfilments: [{
          id: 'fulfilment-1',
          status: 'accepted',
          item_ids: ['item-1'],
          amount_paise: 5000,
          vendor_name: 'Vendor One',
        }],
      }],
      nextOffset: null,
    }, 200)))

    await expect(customerApi.bookings()).resolves.toMatchObject({
      rows: [{
        id: 'order-1',
        amount: 85,
        status: 'partially_accepted',
        orderItems: [{
          id: 'item-1',
          serviceName: 'Water delivery',
          status: 'accepted',
          amountPaise: 5000,
        }],
        fulfilments: [{
          id: 'fulfilment-1',
          vendorName: 'Vendor One',
          itemIds: ['item-1'],
        }],
      }],
      nextOffset: null,
    })
  })

  it('submits structured service enquiries and reports the admin notification result', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      id: 'enquiry-1',
      subject: 'Borewell services enquiry',
      status: 'new',
      createdAt: '2026-11-18T03:00:00.000Z',
      notificationStatus: 'created',
    }, 201))
    vi.stubGlobal('fetch', fetchMock)
    const payload = {
      customerName: 'Ananya Rao',
      mobile: '9876543210',
      location: '12 Lake View Road, Chennai',
      requiredDate: '2026-12-01',
      serviceCategory: 'borewell' as const,
      details: { proposedDepthMetres: 45, siteRequirements: 'Clear access for the drilling rig.' },
    }

    await expect(customerApi.createServiceEnquiry(payload)).resolves.toMatchObject({
      id: 'enquiry-1',
      notificationStatus: 'created',
    })
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/service-enquiries')
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: 'POST' })
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual(payload)
  })
})
