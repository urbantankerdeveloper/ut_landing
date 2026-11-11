import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CheckoutError, openRazorpayCheckout } from './razorpayCheckout'

type FakeOptions = { handler: (result: { razorpay_payment_id: string; razorpay_signature: string }) => void; modal: { ondismiss: () => void } }

class FakeRazorpay {
  static last: FakeRazorpay
  options: FakeOptions
  failedHandler?: (response: { error?: { description?: string } }) => void
  open = vi.fn()
  close = vi.fn()
  constructor(options: FakeOptions) {
    this.options = options
    FakeRazorpay.last = this
  }
  on(_event: 'payment.failed', handler: (response: { error?: { description?: string } }) => void) {
    this.failedHandler = handler
  }
}

const order = { id: 'order_1', amount: 50000, currency: 'INR', keyId: 'rzp_test_key' }
const customer = { name: 'Asha', email: 'not-an-email', phone: '+919999999999' }

describe('openRazorpayCheckout', () => {
  beforeEach(() => {
    vi.stubGlobal('window', { Razorpay: FakeRazorpay })
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('resolves with the payment ids from the handler and opens the widget', async () => {
    const pending = openRazorpayCheckout(order, customer)
    await vi.waitFor(() => expect(FakeRazorpay.last?.options).toBeDefined())
    FakeRazorpay.last.options.handler({ razorpay_payment_id: 'pay_1', razorpay_signature: 'sig_1' })

    await expect(pending).resolves.toEqual({ orderId: 'order_1', paymentId: 'pay_1', signature: 'sig_1' })
    expect(FakeRazorpay.last.open).toHaveBeenCalledOnce()
  })

  it('rejects as cancelled when the customer dismisses the widget', async () => {
    const pending = openRazorpayCheckout(order, customer)
    await vi.waitFor(() => expect(FakeRazorpay.last?.options).toBeDefined())
    FakeRazorpay.last.options.modal.ondismiss()

    await expect(pending).rejects.toMatchObject({ kind: 'cancelled' })
  })

  it('closes the widget and rejects as failed when Razorpay reports payment.failed', async () => {
    const pending = openRazorpayCheckout(order, customer)
    await vi.waitFor(() => expect(FakeRazorpay.last?.failedHandler).toBeDefined())
    FakeRazorpay.last.failedHandler?.({ error: { description: 'Card declined' } })

    const error = await pending.catch((reason: unknown) => reason)
    expect(error).toBeInstanceOf(CheckoutError)
    expect(error).toMatchObject({ kind: 'failed', message: 'Card declined' })
    expect(FakeRazorpay.last.close).toHaveBeenCalledOnce()
  })
})
