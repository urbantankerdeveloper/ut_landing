import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { customerApi } from './customer'
import { useAuthStore } from '../stores/authStore'

function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

describe('customerApi payment calls', () => {
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
})
