import { useMemo, useState } from 'react'
import { ArrowRight } from 'lucide-react'
import { customerDemoDataEnabled } from '../constants/demo'
import { REPEAT_BOOKING_KEY } from '../constants/bookingDraft'
import { useCustomerBookings, useCustomerCancel, useCustomerDeliveryOtp } from '../hooks/useCustomerData'
import { useRazorpayPayment } from '../hooks/useFrontendFeatures'
import { customerApi, type CustomerBooking } from '../api/customer'
import { useAuthStore } from '../stores/authStore'
import { CheckoutError, type CheckoutSuccess } from '../utils/razorpayCheckout'
import { Modal } from '../components/Modal'
import { customerContent as c } from '../content/customer'
import { useFeatureFlags } from '../hooks/useFeatureFlags'
import { isMultiServiceOrdersEnabled } from '../constants/multiServiceOrders'

type Props = { onNavigate: (screen: 'booking' | 'bookings' | 'offers' | 'home') => void }
// Statuses before the driver collects cash. Matches the backend codSwitchStatuses.
const payOnlineStatuses = ['pending_vendor', 'vendor_assigned', 'accepted']
const customerCancellableStatuses = ['pending_vendor', 'vendor_assigned']
const orderProgressStatuses = ['pending_vendor', 'vendor_assigned', 'accepted', 'en_route', 'arrived', 'delivered']
type PayState = { kind: 'idle' } | { kind: 'working' } | { kind: 'paid' } | { kind: 'verify'; pending: CheckoutSuccess } | { kind: 'error'; message: string }
const demoRows: CustomerBooking[] = customerDemoDataEnabled ? [
  { id: 'UT-2408', service: c.bookingsTable.demo.waterTanker, services: [{ serviceId: 'water_tanker', capacity: c.bookingsTable.demo.tankerCapacity, details: c.bookingsTable.demo.potableWater, deliveryDate: '2026-10-20' }], location: c.bookingsTable.demo.ecr, status: c.bookingsTable.demo.inProgress, amount: 1850, scheduledAt: '2026-10-20' },
  { id: 'UT-2394', service: c.bookingsTable.demo.tankAndSump, services: [{ serviceId: 'tank_cleaning', capacity: c.bookingsTable.demo.twoTanks, details: c.bookingsTable.demo.cleanTanks, deliveryDate: '2026-10-22' }], location: c.bookingsTable.demo.adyar, status: c.bookingsTable.demo.delivered, amount: 2400, scheduledAt: '2026-10-22' },
  { id: 'UT-2388', service: c.bookingsTable.demo.sewageTanker, services: [{ serviceId: 'sewage_tanker', capacity: c.bookingsTable.demo.sewageCapacity, details: c.bookingsTable.demo.septicCollection, deliveryDate: '2026-10-24' }], location: c.bookingsTable.demo.velachery, status: c.bookingsTable.demo.scheduled, amount: 3100, scheduledAt: '2026-10-24' },
] : []

function serviceLabel(serviceId: string) {
  return serviceId.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function formatDate(value: string) {
  if (!value) return c.common.notProvided
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

function paymentLabel(value?: CustomerBooking['paymentMethod']) {
  if (value === 'cod') return c.bookingsTable.paymentMethods.cod
  if (value === 'gateway') return c.bookingsTable.paymentMethods.gateway
  if (value === 'wallet') return c.bookingsTable.paymentMethods.wallet
  return c.common.notProvided
}

function progressStatus(status: string) {
  if (status === 'partially_accepted') return 'accepted'
  if (status === 'in_progress') return 'en_route'
  if (status === 'partially_completed' || status === 'completed') return 'delivered'
  return status
}

export function CustomerBookingsTable({ onNavigate }: Props) {
  const query = useCustomerBookings()
  const featureFlags = useFeatureFlags()
  const multiServiceOrdersEnabled = isMultiServiceOrdersEnabled(featureFlags.data?.multi_service_orders_enabled)
  const cancellation = useCustomerCancel()
  const deliveryOtp = useCustomerDeliveryOtp()
  const [filter, setFilter] = useState('all')
  const [sort, setSort] = useState<'recent' | 'status' | 'amount'>('recent')
  const [page, setPage] = useState(1)
  const [selectedBookingId, setSelectedBookingId] = useState<string | null>(null)
  const rows = useMemo(() => customerDemoDataEnabled ? demoRows : query.data ?? [], [query.data])
  const filteredRows = useMemo(() => rows.filter((booking) => filter === 'all' || booking.status.toLowerCase() === filter), [filter, rows])
  const sortedRows = useMemo(() => [...filteredRows].sort((first, second) => sort === 'status' ? first.status.localeCompare(second.status) : sort === 'amount' ? second.amount - first.amount : second.id.localeCompare(first.id)), [filteredRows, sort])
  const pageSize = 5
  const pageCount = Math.max(1, Math.ceil(sortedRows.length / pageSize))
  const currentPage = Math.min(page, pageCount)
  const visibleRows = sortedRows.slice((currentPage - 1) * pageSize, currentPage * pageSize)
  const razorpay = useRazorpayPayment()
  const user = useAuthStore((state) => state.user)
  const [payState, setPayState] = useState<PayState>({ kind: 'idle' })
  const [cancelError, setCancelError] = useState<string | null>(null)
  const [deliveryOtpResult, setDeliveryOtpResult] = useState<{ bookingId: string; otp: string; expiresAt: string; smsSent: boolean } | null>(null)
  const [deliveryOtpError, setDeliveryOtpError] = useState<string | null>(null)
  // Derived from the rows so the modal reflects refetched data (e.g. a switched payment method) without reopening.
  const selectedBooking = selectedBookingId ? rows.find((row) => row.id === selectedBookingId) ?? null : null
  const selectedTasks = selectedBooking
    ? selectedBooking.orderGroupId
      ? rows.filter((row) => row.orderGroupId === selectedBooking.orderGroupId)
      : [selectedBooking]
    : []

  function closeBookingModal() {
    setSelectedBookingId(null)
    setPayState({ kind: 'idle' })
    setCancelError(null)
    setDeliveryOtpResult(null)
    setDeliveryOtpError(null)
    deliveryOtp.reset()
  }

  function requestSelectedDeliveryOtp() {
    if (!selectedBooking || selectedBooking.status.toLowerCase() !== 'arrived' || deliveryOtp.isPending) return
    const bookingId = selectedBooking.id
    setDeliveryOtpResult(null)
    setDeliveryOtpError(null)
    deliveryOtp.mutate(bookingId, {
      onSuccess: (result) => setDeliveryOtpResult({ bookingId, ...result }),
      onError: () => setDeliveryOtpError(c.bookingsTable.deliveryOtp.failed),
    })
  }

  function cancelSelectedBooking() {
    if (!selectedBooking || !customerCancellableStatuses.includes(selectedBooking.status.toLowerCase()) || cancellation.isPending) return
    if (!window.confirm(c.bookingsTable.cancelConfirm)) return
    setCancelError(null)
    cancellation.mutate(selectedBooking.id, {
      onSuccess: () => setCancelError(null),
      onError: () => setCancelError(c.bookingsTable.cancelFailed),
    })
  }

  async function payOnlineNow(booking: CustomerBooking) {
    if (featureFlags.data?.online_payment_enabled !== true) {
      setPayState({ kind: 'error', message: c.bookingsTable.payOnline.unavailable })
      return
    }
    setPayState({ kind: 'working' })
    try {
      await customerApi.switchBookingToOnline(booking.id)
    } catch {
      setPayState({ kind: 'error', message: c.bookingsTable.payOnline.switchFailed })
      return
    }
    try {
      const normalizedPhone = booking.phone?.replace(/\D/g, '').slice(-10)
      await razorpay.pay(booking.amount, { bookingId: booking.id }, {
        name: user?.name ?? 'Urban Tanker customer',
        email: user?.username,
        phone: normalizedPhone && normalizedPhone.length === 10 ? `+91${normalizedPhone}` : undefined,
      })
      setPayState({ kind: 'paid' })
    } catch (paymentError) {
      if (paymentError instanceof CheckoutError && paymentError.kind === 'verification' && paymentError.pending) {
        setPayState({ kind: 'verify', pending: paymentError.pending })
        void query.refetch()
        return
      }
      // Cancelled or failed: move the booking back to cash on delivery so the driver still expects cash.
      let reverted = true
      try { await customerApi.switchBookingToCashOnDelivery(booking.id) } catch { reverted = false }
      const message = !reverted
        ? c.bookingsTable.payOnline.revertFailed
        : paymentError instanceof CheckoutError && paymentError.kind === 'cancelled'
          ? c.bookingsTable.payOnline.cancelled
          : c.bookingsTable.payOnline.failed
      setPayState({ kind: 'error', message })
    }
    void query.refetch()
  }

  async function retryPaymentVerification(pending: CheckoutSuccess) {
    setPayState({ kind: 'working' })
    try {
      await razorpay.verifyPending(pending)
      setPayState({ kind: 'paid' })
      void query.refetch()
    } catch (verifyError) {
      if (verifyError instanceof CheckoutError && verifyError.pending) setPayState({ kind: 'verify', pending: verifyError.pending })
      else setPayState({ kind: 'error', message: c.bookingsTable.payOnline.verifyFailed })
    }
  }

  function repeatBooking(booking: CustomerBooking) {
    sessionStorage.setItem(REPEAT_BOOKING_KEY, JSON.stringify(booking))
    onNavigate('booking')
  }

  if (!customerDemoDataEnabled && query.isLoading) return <section className="workspace-view-panel customer-operation-panel" role="status"><p className="eyebrow">{c.bookingsTable.eyebrow}</p><h2>{c.bookingsTable.loading}</h2></section>
  if (!customerDemoDataEnabled && query.isError) return <section className="workspace-view-panel customer-operation-panel" role="alert"><p className="eyebrow">{c.bookingsTable.eyebrow}</p><h2>{c.bookingsTable.unavailable}</h2><button className="button button-primary" onClick={() => query.refetch()}>{c.bookingsTable.retry}</button></section>

  return <>
    <section className="workspace-view-panel customer-operation-panel customer-bookings-table-panel">
      <div className="view-panel-heading">
        <div><p className="eyebrow">{c.bookingsTable.eyebrow}</p><h2>{c.bookingsTable.title}</h2></div>
        <button className="button button-primary" onClick={() => onNavigate('booking')}>{c.bookingsTable.bookNow} <ArrowRight size={14} /></button>
        <div className="booking-table-tools">
          <label>{c.bookingsTable.filterLabel}<select value={filter} onChange={(event) => { setFilter(event.target.value); setPage(1) }}>{c.bookingsTable.filterOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
          <label>{c.bookingsTable.sortLabel}<select value={sort} onChange={(event) => setSort(event.target.value as typeof sort)}>{c.bookingsTable.sortOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
        </div>
      </div>
      <div className="customer-booking-table-wrap">
        <table className="customer-booking-table">
          <thead><tr><th scope="col">{c.bookingsTable.headers.booking}</th><th scope="col">{c.bookingsTable.headers.service}</th><th scope="col">{c.bookingsTable.headers.location}</th><th scope="col">{c.bookingsTable.headers.status}</th><th scope="col">{c.bookingsTable.headers.amount}</th></tr></thead>
          <tbody>{visibleRows.map((booking) => <tr key={booking.id}>
            <td><button className="customer-booking-id" type="button" onClick={() => { setPayState({ kind: 'idle' }); setCancelError(null); setDeliveryOtpResult(null); setDeliveryOtpError(null); deliveryOtp.reset(); setSelectedBookingId(booking.id) }}>{booking.reference ?? 'Booking reference unavailable'}</button>{booking.orderGroupSize && booking.orderGroupSize > 1 && <small className="customer-booking-group-label">{booking.orderGroupReference} · {booking.orderGroupSize} tasks in this order</small>}</td>
            <td>{booking.service}</td>
            <td>{booking.location}</td>
            <td><span className={`status-tag ${['delivered', 'completed', 'partially_completed'].includes(booking.status.toLowerCase()) ? '' : 'pending'}`}>{booking.status}</span>{featureFlags.data?.order_tracking_board_enabled && <div className="customer-order-progress" aria-label={`Order progress: ${booking.status}`}><progress max={orderProgressStatuses.length - 1} value={Math.max(0, orderProgressStatuses.indexOf(progressStatus(booking.status.toLowerCase())))} /><small>{booking.status.toLowerCase() === 'cancelled' ? 'Cancelled' : `${Math.max(1, orderProgressStatuses.indexOf(progressStatus(booking.status.toLowerCase())) + 1)} of ${orderProgressStatuses.length} stages`}</small></div>}</td>
            <td>{c.common.rupee(booking.amount.toLocaleString('en-IN'))}</td>
          </tr>)}</tbody>
        </table>
        {!sortedRows.length && <div className="admin-empty-state"><p>{c.bookingsTable.noMatches}</p></div>}
      </div>
      <div className="booking-table-pagination">
        <span>{sortedRows.length ? c.bookingsTable.showing((currentPage - 1) * pageSize + 1, Math.min(currentPage * pageSize, sortedRows.length), sortedRows.length) : c.bookingsTable.noBookings}</span>
        <div>{query.hasNextPage && <button className="button button-quiet" disabled={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>{query.isFetchingNextPage ? c.bookingsTable.loadingMore : c.bookingsTable.loadOlder}</button>}<button className="button button-quiet" disabled={currentPage <= 1} onClick={() => setPage((value) => value - 1)}>{c.bookingsTable.previous}</button><button className="button button-quiet" disabled={currentPage >= pageCount} onClick={() => setPage((value) => value + 1)}>{c.bookingsTable.next}</button></div>
      </div>
    </section>
    {selectedBooking && <Modal title={c.bookingsTable.modalTitle(selectedBooking.reference ?? 'Booking reference unavailable')} onClose={closeBookingModal}>
      <div className="customer-booking-details">
        {selectedBooking.orderGroupSize && selectedBooking.orderGroupSize > 1 && <section>
          <h3>{selectedBooking.orderGroupReference} · {selectedBooking.orderGroupSize} tasks in this order</h3>
          <ul>{selectedTasks.map((task) => <li key={task.id}>
            <strong>{task.reference ?? 'Booking reference unavailable'}</strong>
            <span>{task.service} · {task.status} · {c.common.rupee(task.amount.toLocaleString('en-IN'))}</span>
          </li>)}</ul>
        </section>}
        <div className="customer-booking-detail-grid">
          <div><span>{c.bookingsTable.detail.status}</span><strong>{selectedBooking.status}</strong></div>
          <div><span>{c.bookingsTable.detail.total}</span><strong>{c.common.rupee(selectedBooking.amount.toLocaleString('en-IN'))}</strong></div>
          <div><span>{c.bookingsTable.detail.deliveryDate}</span><strong>{formatDate(selectedBooking.scheduledAt)}</strong></div>
          <div><span>{c.bookingsTable.detail.paymentMethod}</span><strong>{paymentLabel(selectedBooking.paymentMethod)}</strong></div>
          <div><span>{c.bookingsTable.detail.deliveryLocation}</span><strong>{selectedBooking.location || c.common.notProvided}</strong></div>
          <div><span>{c.bookingsTable.detail.mobileNumber}</span><strong>{selectedBooking.phone || c.common.notProvided}</strong></div>
        </div>
        {!customerDemoDataEnabled && selectedBooking.status.toLowerCase() === 'arrived' && <section className="customer-booking-delivery-otp" aria-live="polite">
          <h3>{c.bookingsTable.deliveryOtp.title}</h3>
          {deliveryOtpResult?.bookingId === selectedBooking.id
            ? <><strong className="customer-booking-delivery-otp-code">{deliveryOtpResult.otp}</strong><p>{deliveryOtpResult.smsSent ? c.bookingsTable.deliveryOtp.expires(new Date(deliveryOtpResult.expiresAt).toLocaleTimeString()) : c.bookingsTable.deliveryOtp.smsNotSent(new Date(deliveryOtpResult.expiresAt).toLocaleTimeString())}</p></>
            : <button className="button button-primary" type="button" disabled={deliveryOtp.isPending} onClick={requestSelectedDeliveryOtp}>{deliveryOtp.isPending ? c.bookingsTable.deliveryOtp.requesting : c.bookingsTable.deliveryOtp.request}</button>}
          {deliveryOtpError && <p role="alert">{deliveryOtpError}</p>}
        </section>}
        {!customerDemoDataEnabled && (payState.kind !== 'idle' || (featureFlags.data?.online_payment_enabled === true && payOnlineStatuses.includes(selectedBooking.status) && selectedBooking.paymentMethod === 'cod')) && <section className="customer-booking-pay-online">
          {payState.kind === 'idle' && <>
            <p>{c.bookingsTable.payOnline.hint}</p>
            <button className="button button-primary" type="button" onClick={() => void payOnlineNow(selectedBooking)}>{c.bookingsTable.payOnline.action}</button>
          </>}
          {payState.kind === 'working' && <p role="status">{c.bookingsTable.payOnline.working}</p>}
          {payState.kind === 'paid' && <p role="status">{c.bookingsTable.payOnline.paid}</p>}
          {payState.kind === 'verify' && <>
            <p role="alert">{c.bookingsTable.payOnline.verifyFailed}</p>
            <button className="button button-primary" type="button" onClick={() => void retryPaymentVerification(payState.pending)}>{c.bookingsTable.payOnline.retryConfirmation}</button>
          </>}
          {payState.kind === 'error' && <p role="alert">{payState.message}</p>}
        </section>}
        {multiServiceOrdersEnabled && selectedBooking.orderItems?.length
          ? <section><h3>Services in this order</h3><ul>{selectedBooking.orderItems.map((item) => <li key={item.id}>
            <strong>{item.serviceName}</strong><span> · {item.status.replace(/_/g, ' ')}</span>
            <p>{item.details.capacity || item.details.quantity || item.details.details || c.bookingsTable.noAdditionalDetails}</p>
            {item.amountPaise > 0 && <p>{c.common.rupee((item.amountPaise / 100).toLocaleString('en-IN'))}</p>}
            {(item.scheduledAt || item.location) && <small>{item.location ?? selectedBooking.location}{item.scheduledAt ? ` · ${formatDate(item.scheduledAt)}` : ''}</small>}
          </li>)}</ul></section>
          : <section><h3>{c.bookingsTable.serviceDetails}</h3>{selectedBooking.services.length
            ? <ul>{selectedBooking.services.map((service) => <li key={service.serviceId}><strong>{serviceLabel(service.serviceId)}</strong>{service.capacity && <span>{c.bookingsTable.capacitySeparator}{service.capacity}</span>}{service.deliveryDate && <p>{c.bookingsTable.preferredDate(formatDate(service.deliveryDate))}</p>}<p>{service.details || c.bookingsTable.noAdditionalDetails}</p></li>)}</ul>
            : <p>{c.bookingsTable.noServiceDetails}</p>}</section>}
        {multiServiceOrdersEnabled && selectedBooking.fulfilments?.length ? <section>
          <h3>Fulfilments</h3>
          <ul>{selectedBooking.fulfilments.map((fulfilment) => <li key={fulfilment.id}>
            <strong>{fulfilment.status.replace(/_/g, ' ')}</strong>
            {fulfilment.vendorName && <span> · {fulfilment.vendorName}</span>}
            <p>{fulfilment.itemIds.length} service{fulfilment.itemIds.length === 1 ? '' : 's'} · {fulfilment.location ?? selectedBooking.location}</p>
            {fulfilment.scheduledAt && <small>{formatDate(fulfilment.scheduledAt)}</small>}
          </li>)}</ul>
        </section> : null}
        <section><h3>{c.bookingsTable.accessNotes}</h3><p>{selectedBooking.notes || c.bookingsTable.noAccessNotes}</p></section>
          {cancelError && <p className="booking-cancel-error" role="alert">{cancelError}</p>}
          {(selectedBooking.status.toLowerCase() === 'delivered' || (!customerDemoDataEnabled && customerCancellableStatuses.includes(selectedBooking.status.toLowerCase()))) && <div className="action-row">
            {!customerDemoDataEnabled && customerCancellableStatuses.includes(selectedBooking.status.toLowerCase()) && <button className="button button-danger" type="button" disabled={cancellation.isPending} onClick={cancelSelectedBooking}>{cancellation.isPending ? c.bookingsTable.cancelling : c.bookingsTable.cancelBooking}</button>}
            {selectedBooking.status.toLowerCase() === 'delivered' && <button className="button button-primary" type="button" onClick={() => repeatBooking(selectedBooking)}>{c.bookingsTable.bookAgain} <ArrowRight size={14} /></button>}
          </div>}
      </div>
    </Modal>}
  </>
}
