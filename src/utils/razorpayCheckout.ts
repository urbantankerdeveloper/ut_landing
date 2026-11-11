export type RazorpayCustomer = { name: string; email?: string; phone?: string }
export type CheckoutOrder = { id: string; amount: number; currency: string; keyId?: string }
export type CheckoutSuccess = { orderId: string; paymentId: string; signature: string }
export type CheckoutErrorKind = 'cancelled' | 'failed' | 'verification'

// `pending` is set for 'verification' so the caller can retry confirming the same payment without paying again.
export class CheckoutError extends Error {
  kind: CheckoutErrorKind
  pending?: CheckoutSuccess
  constructor(kind: CheckoutErrorKind, message?: string, pending?: CheckoutSuccess) {
    super(message ?? kind)
    this.name = 'CheckoutError'
    this.kind = kind
    this.pending = pending
  }
}

type RazorpayInstance = {
  open: () => void
  close: () => void
  on: (event: 'payment.failed', handler: (response: { error?: { description?: string } }) => void) => void
}
type RazorpayConstructor = new (options: Record<string, unknown>) => RazorpayInstance

declare global { interface Window { Razorpay?: RazorpayConstructor } }

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export async function loadRazorpayWidget(): Promise<RazorpayConstructor> {
  if (window.Razorpay) return window.Razorpay
  await new Promise<void>((resolve, reject) => { const script = document.createElement('script'); script.src = 'https://checkout.razorpay.com/v1/checkout.js'; script.onload = () => resolve(); script.onerror = () => reject(new Error('Payment widget could not load.')); document.head.appendChild(script) })
  if (!window.Razorpay) throw new Error('Payment widget is unavailable.')
  return window.Razorpay
}

// Resolves with the ids from the checkout handler. It does not verify the signature; callers do that.
export async function openRazorpayCheckout(order: CheckoutOrder, customer: RazorpayCustomer): Promise<CheckoutSuccess> {
  const Razorpay = await loadRazorpayWidget()
  return new Promise<CheckoutSuccess>((resolve, reject) => {
    let settled = false
    const finish = (callback: () => void) => { if (settled) return; settled = true; callback() }
    const checkout = new Razorpay({
      key: order.keyId ?? import.meta.env.VITE_RAZORPAY_KEY_ID,
      amount: order.amount,
      currency: order.currency,
      name: 'Urban Tanker',
      order_id: order.id,
      prefill: { ...customer, email: EMAIL_PATTERN.test(customer.email ?? '') ? customer.email : undefined },
      handler: (result: { razorpay_payment_id: string; razorpay_signature: string }) => finish(() => resolve({ orderId: order.id, paymentId: result.razorpay_payment_id, signature: result.razorpay_signature })),
      modal: { ondismiss: () => finish(() => reject(new CheckoutError('cancelled'))) },
    })
    checkout.on('payment.failed', (response) => finish(() => { checkout.close(); reject(new CheckoutError('failed', response.error?.description)) }))
    checkout.open()
  })
}
