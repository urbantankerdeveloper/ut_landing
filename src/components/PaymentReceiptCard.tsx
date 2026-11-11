import { useQuery } from '@tanstack/react-query'
import { customerApi, type PaymentReceipt } from '../api/customer'
import { customerQueryKeys } from '../hooks/useCustomerData'
import { bookingContent } from '../content/booking'

const copy = bookingContent.success.receipt

function methodLabel(receipt: PaymentReceipt): string | null {
  if (receipt.method === 'card' && receipt.cardLast4) return copy.card(receipt.cardNetwork ?? '', receipt.cardLast4)
  if (receipt.method === 'upi' && receipt.vpa) return copy.upi(receipt.vpa)
  if (receipt.method === 'netbanking' && receipt.bank) return receipt.bank
  if (receipt.method === 'wallet' && receipt.wallet) return receipt.wallet
  return receipt.method
}

function statusLabel(status: PaymentReceipt['status']): string {
  if (status === 'paid') return copy.statusPaid
  if (status === 'failed') return copy.statusFailed
  if (status === 'refunded') return copy.statusRefunded
  return copy.statusPending
}

export function PaymentReceiptCard({ bookingId }: { bookingId: string }) {
  const receiptQuery = useQuery({
    queryKey: customerQueryKeys.paymentReceipt(bookingId),
    queryFn: () => customerApi.getPaymentReceipt(bookingId),
    retry: false,
  })
  const receipt = receiptQuery.data
  if (!receipt) return null
  const method = methodLabel(receipt)
  return (
    <dl className="detail-grid payment-receipt" aria-label={copy.title}>
      <div><dt>{copy.status}</dt><dd>{statusLabel(receipt.status)}</dd></div>
      <div><dt>{copy.amount}</dt><dd>{`INR ${(receipt.amountPaise / 100).toLocaleString('en-IN')}`}</dd></div>
      {method && <div><dt>{copy.method}</dt><dd>{method}</dd></div>}
      {receipt.capturedAt && <div><dt>{copy.paidAt}</dt><dd>{new Date(receipt.capturedAt).toLocaleString('en-IN')}</dd></div>}
    </dl>
  )
}
