import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ArrowRight, MoreVertical } from 'lucide-react'
import { customerDemoDataEnabled } from '../constants/demo'
import { REPEAT_BOOKING_KEY } from '../constants/bookingDraft'
import { useCustomerBookings } from '../hooks/useCustomerData'
import type { CustomerBooking } from '../api/customer'
import { Modal } from './WorkspaceInteractive'

type Props = { onNavigate: (screen: 'booking' | 'bookings' | 'offers' | 'home') => void }
const demoRows: CustomerBooking[] = customerDemoDataEnabled ? [
  { id: 'UT-2408', service: 'Water tanker · 9 KL', services: [{ serviceId: 'water_tanker', capacity: '9 KL', details: 'Potable water for the property', deliveryDate: '2026-10-20' }], location: 'ECR, Chennai', status: 'In progress', amount: 1850, scheduledAt: '2026-10-20' },
  { id: 'UT-2394', service: 'Tank & sump cleaning', services: [{ serviceId: 'tank_cleaning', capacity: '2 tanks', details: 'Clean rooftop and sump tanks', deliveryDate: '2026-10-22' }], location: 'Adyar, Chennai', status: 'Delivered', amount: 2400, scheduledAt: '2026-10-22' },
  { id: 'UT-2388', service: 'Sewage tanker', services: [{ serviceId: 'sewage_tanker', capacity: '5,000 litres', details: 'Septic tank collection', deliveryDate: '2026-10-24' }], location: 'Velachery, Chennai', status: 'Scheduled', amount: 3100, scheduledAt: '2026-10-24' },
] : []

function serviceLabel(serviceId: string) {
  return serviceId.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function formatDate(value: string) {
  if (!value) return 'Not provided'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

function paymentLabel(value?: CustomerBooking['paymentMethod']) {
  if (value === 'cod') return 'Cash on delivery'
  if (value === 'gateway') return 'Card or UPI'
  if (value === 'wallet') return 'Urban Tanker wallet'
  return 'Not provided'
}

export function CustomerBookingsTable({ onNavigate }: Props) {
  const query = useCustomerBookings()
  const [filter, setFilter] = useState('all')
  const [sort, setSort] = useState<'recent' | 'status' | 'amount'>('recent')
  const [page, setPage] = useState(1)
  const [selectedBooking, setSelectedBooking] = useState<CustomerBooking | null>(null)
  const [openActionsBookingId, setOpenActionsBookingId] = useState<string | null>(null)
  const [actionMenuPosition, setActionMenuPosition] = useState<{ top: number; left: number } | null>(null)
  const actionTriggerRef = useRef<HTMLButtonElement>(null)
  const actionMenuRef = useRef<HTMLDivElement>(null)
  const rows = useMemo(() => customerDemoDataEnabled ? demoRows : query.data ?? [], [query.data])
  const filteredRows = useMemo(() => rows.filter((booking) => filter === 'all' || booking.status.toLowerCase() === filter), [filter, rows])
  const sortedRows = useMemo(() => [...filteredRows].sort((first, second) => sort === 'status' ? first.status.localeCompare(second.status) : sort === 'amount' ? second.amount - first.amount : second.id.localeCompare(first.id)), [filteredRows, sort])
  const pageSize = 5
  const pageCount = Math.max(1, Math.ceil(sortedRows.length / pageSize))
  const currentPage = Math.min(page, pageCount)
  const visibleRows = sortedRows.slice((currentPage - 1) * pageSize, currentPage * pageSize)

  useLayoutEffect(() => {
    if (!openActionsBookingId) return
    function positionMenu() {
      const trigger = actionTriggerRef.current
      if (!trigger) return
      const rect = trigger.getBoundingClientRect()
      const menuWidth = 160
      const menuHeight = 88
      setActionMenuPosition({
        top: rect.bottom + menuHeight + 8 > window.innerHeight ? Math.max(8, rect.top - menuHeight - 4) : rect.bottom + 4,
        left: Math.max(8, Math.min(rect.right - menuWidth, window.innerWidth - menuWidth - 8)),
      })
    }
    positionMenu()
    window.addEventListener('resize', positionMenu)
    window.addEventListener('scroll', positionMenu, true)
    return () => {
      window.removeEventListener('resize', positionMenu)
      window.removeEventListener('scroll', positionMenu, true)
    }
  }, [openActionsBookingId])

  useEffect(() => {
    if (!openActionsBookingId) return
    function closeOnOutsideClick(event: PointerEvent) {
      if (!(event.target instanceof Node)) return
      if (actionTriggerRef.current?.contains(event.target) || actionMenuRef.current?.contains(event.target)) return
      setOpenActionsBookingId(null)
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpenActionsBookingId(null)
    }
    document.addEventListener('pointerdown', closeOnOutsideClick)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsideClick)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [openActionsBookingId])

  function repeatBooking(booking: CustomerBooking) {
    setOpenActionsBookingId(null)
    sessionStorage.setItem(REPEAT_BOOKING_KEY, JSON.stringify(booking))
    onNavigate('booking')
  }

  if (!customerDemoDataEnabled && query.isLoading) return <section className="workspace-view-panel customer-operation-panel"><p className="eyebrow">MY BOOKINGS</p><h2>Loading your bookings...</h2></section>
  if (!customerDemoDataEnabled && query.isError) return <section className="workspace-view-panel customer-operation-panel"><p className="eyebrow">MY BOOKINGS</p><h2>Bookings are unavailable.</h2><button className="button button-primary" onClick={() => query.refetch()}>Retry</button></section>

  return <>
    <section className="workspace-view-panel customer-operation-panel customer-bookings-table-panel">
      <div className="view-panel-heading">
        <div><p className="eyebrow">MY BOOKINGS</p><h2>Every request, in one clear record.</h2></div>
        <button className="button button-primary" onClick={() => onNavigate('booking')}>Book now <ArrowRight size={14} /></button>
        <div className="booking-table-tools">
          <label>Filter<select value={filter} onChange={(event) => { setFilter(event.target.value); setPage(1) }}><option value="all">All statuses</option><option value="in progress">In progress</option><option value="scheduled">Scheduled</option><option value="delivered">Delivered</option><option value="cancelled">Cancelled</option></select></label>
          <label>Sort<select value={sort} onChange={(event) => setSort(event.target.value as typeof sort)}><option value="recent">Recent</option><option value="status">Status</option><option value="amount">Amount</option></select></label>
        </div>
      </div>
      <div className="customer-booking-table-wrap">
        <table className="customer-booking-table">
          <thead><tr><th>Booking</th><th>Service</th><th>Location</th><th>Status</th><th>Amount</th><th>Action</th></tr></thead>
          <tbody>{visibleRows.map((booking) => <tr key={booking.id}>
            <td><b>{booking.id}</b></td>
            <td>{booking.service}</td>
            <td>{booking.location}</td>
            <td><span className={`status-tag ${booking.status === 'delivered' ? '' : 'pending'}`}>{booking.status}</span></td>
            <td>₹{booking.amount.toLocaleString('en-IN')}</td>
            <td className="customer-booking-actions">
              <button
                className="booking-actions-trigger"
                type="button"
                aria-label={`Actions for booking ${booking.id}`}
                aria-haspopup="menu"
                aria-expanded={openActionsBookingId === booking.id}
                aria-controls={`booking-actions-${booking.id}`}
                onClick={(event) => {
                  const isOpen = openActionsBookingId === booking.id
                  actionTriggerRef.current = isOpen ? null : event.currentTarget
                  setOpenActionsBookingId(isOpen ? null : booking.id)
                }}
              >
                <MoreVertical size={18} aria-hidden="true" />
              </button>
            </td>
          </tr>)}</tbody>
        </table>
        {!sortedRows.length && <div className="admin-empty-state"><p>No bookings match the selected filter.</p></div>}
      </div>
      <div className="booking-table-pagination">
        <span>{sortedRows.length ? `Showing ${(currentPage - 1) * pageSize + 1}-${Math.min(currentPage * pageSize, sortedRows.length)} of ${sortedRows.length} loaded` : 'No bookings to display'}</span>
        <div>{query.hasNextPage && <button className="button button-quiet" disabled={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>{query.isFetchingNextPage ? 'Loading…' : 'Load older'}</button>}<button className="button button-quiet" disabled={currentPage <= 1} onClick={() => setPage((value) => value - 1)}>Previous</button><button className="button button-quiet" disabled={currentPage >= pageCount} onClick={() => setPage((value) => value + 1)}>Next</button></div>
      </div>
    </section>
    {openActionsBookingId && actionMenuPosition && createPortal(
      <div
        className="booking-actions-menu"
        id={`booking-actions-${openActionsBookingId}`}
        role="menu"
        ref={actionMenuRef}
        style={{ top: actionMenuPosition.top, left: actionMenuPosition.left }}
      >
        <button type="button" role="menuitem" onClick={() => {
          const booking = rows.find((row) => row.id === openActionsBookingId)
          if (booking) repeatBooking(booking)
        }}>Book again</button>
        <button type="button" role="menuitem" onClick={() => {
          const booking = rows.find((row) => row.id === openActionsBookingId)
          setOpenActionsBookingId(null)
          if (booking) setSelectedBooking(booking)
        }}>View</button>
      </div>,
      document.body,
    )}
    {selectedBooking && <Modal title={`Booking ${selectedBooking.id}`} onClose={() => setSelectedBooking(null)}>
      <div className="customer-booking-details">
        <div className="customer-booking-detail-grid">
          <div><span>Status</span><strong>{selectedBooking.status}</strong></div>
          <div><span>Total</span><strong>₹{selectedBooking.amount.toLocaleString('en-IN')}</strong></div>
          <div><span>Delivery date</span><strong>{formatDate(selectedBooking.scheduledAt)}</strong></div>
          <div><span>Payment method</span><strong>{paymentLabel(selectedBooking.paymentMethod)}</strong></div>
          <div><span>Delivery location</span><strong>{selectedBooking.location || 'Not provided'}</strong></div>
          <div><span>Mobile number</span><strong>{selectedBooking.phone || 'Not provided'}</strong></div>
        </div>
        <section><h3>Service details</h3>{selectedBooking.services.length
          ? <ul>{selectedBooking.services.map((service) => <li key={service.serviceId}><strong>{serviceLabel(service.serviceId)}</strong>{service.capacity && <span> · {service.capacity}</span>}{service.deliveryDate && <p>Preferred date: {formatDate(service.deliveryDate)}</p>}<p>{service.details || 'No additional details provided.'}</p></li>)}</ul>
          : <p>No service details were recorded for this booking.</p>}</section>
        <section><h3>Delivery access notes</h3><p>{selectedBooking.notes || 'No additional access notes.'}</p></section>
      </div>
    </Modal>}
  </>
}
