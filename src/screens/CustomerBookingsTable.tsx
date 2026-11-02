import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ArrowRight, MoreVertical } from 'lucide-react'
import { customerDemoDataEnabled } from '../constants/demo'
import { REPEAT_BOOKING_KEY } from '../constants/bookingDraft'
import { useCustomerBookings } from '../hooks/useCustomerData'
import type { CustomerBooking } from '../api/customer'
import { Modal } from '../components/Modal'
import { customerContent as c } from '../content/customer'

type Props = { onNavigate: (screen: 'booking' | 'bookings' | 'offers' | 'home') => void }
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

  if (!customerDemoDataEnabled && query.isLoading) return <section className="workspace-view-panel customer-operation-panel"><p className="eyebrow">{c.bookingsTable.eyebrow}</p><h2>{c.bookingsTable.loading}</h2></section>
  if (!customerDemoDataEnabled && query.isError) return <section className="workspace-view-panel customer-operation-panel"><p className="eyebrow">{c.bookingsTable.eyebrow}</p><h2>{c.bookingsTable.unavailable}</h2><button className="button button-primary" onClick={() => query.refetch()}>{c.bookingsTable.retry}</button></section>

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
          <thead><tr><th>{c.bookingsTable.headers.booking}</th><th>{c.bookingsTable.headers.service}</th><th>{c.bookingsTable.headers.location}</th><th>{c.bookingsTable.headers.status}</th><th>{c.bookingsTable.headers.amount}</th><th>{c.bookingsTable.headers.action}</th></tr></thead>
          <tbody>{visibleRows.map((booking) => <tr key={booking.id}>
            <td><b>{booking.id}</b></td>
            <td>{booking.service}</td>
            <td>{booking.location}</td>
            <td><span className={`status-tag ${booking.status === 'delivered' ? '' : 'pending'}`}>{booking.status}</span></td>
            <td>{c.common.rupee(booking.amount.toLocaleString('en-IN'))}</td>
            <td className="customer-booking-actions">
              <button
                className="booking-actions-trigger"
                type="button"
                aria-label={c.bookingsTable.actionsLabel(booking.id)}
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
        {!sortedRows.length && <div className="admin-empty-state"><p>{c.bookingsTable.noMatches}</p></div>}
      </div>
      <div className="booking-table-pagination">
        <span>{sortedRows.length ? c.bookingsTable.showing((currentPage - 1) * pageSize + 1, Math.min(currentPage * pageSize, sortedRows.length), sortedRows.length) : c.bookingsTable.noBookings}</span>
        <div>{query.hasNextPage && <button className="button button-quiet" disabled={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>{query.isFetchingNextPage ? c.bookingsTable.loadingMore : c.bookingsTable.loadOlder}</button>}<button className="button button-quiet" disabled={currentPage <= 1} onClick={() => setPage((value) => value - 1)}>{c.bookingsTable.previous}</button><button className="button button-quiet" disabled={currentPage >= pageCount} onClick={() => setPage((value) => value + 1)}>{c.bookingsTable.next}</button></div>
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
        }}>{c.bookingsTable.bookAgain}</button>
        <button type="button" role="menuitem" onClick={() => {
          const booking = rows.find((row) => row.id === openActionsBookingId)
          setOpenActionsBookingId(null)
          if (booking) setSelectedBooking(booking)
        }}>{c.bookingsTable.view}</button>
      </div>,
      document.body,
    )}
    {selectedBooking && <Modal title={c.bookingsTable.modalTitle(selectedBooking.id)} onClose={() => setSelectedBooking(null)}>
      <div className="customer-booking-details">
        <div className="customer-booking-detail-grid">
          <div><span>{c.bookingsTable.detail.status}</span><strong>{selectedBooking.status}</strong></div>
          <div><span>{c.bookingsTable.detail.total}</span><strong>{c.common.rupee(selectedBooking.amount.toLocaleString('en-IN'))}</strong></div>
          <div><span>{c.bookingsTable.detail.deliveryDate}</span><strong>{formatDate(selectedBooking.scheduledAt)}</strong></div>
          <div><span>{c.bookingsTable.detail.paymentMethod}</span><strong>{paymentLabel(selectedBooking.paymentMethod)}</strong></div>
          <div><span>{c.bookingsTable.detail.deliveryLocation}</span><strong>{selectedBooking.location || c.common.notProvided}</strong></div>
          <div><span>{c.bookingsTable.detail.mobileNumber}</span><strong>{selectedBooking.phone || c.common.notProvided}</strong></div>
        </div>
        <section><h3>{c.bookingsTable.serviceDetails}</h3>{selectedBooking.services.length
          ? <ul>{selectedBooking.services.map((service) => <li key={service.serviceId}><strong>{serviceLabel(service.serviceId)}</strong>{service.capacity && <span>{c.bookingsTable.capacitySeparator}{service.capacity}</span>}{service.deliveryDate && <p>{c.bookingsTable.preferredDate(formatDate(service.deliveryDate))}</p>}<p>{service.details || c.bookingsTable.noAdditionalDetails}</p></li>)}</ul>
          : <p>{c.bookingsTable.noServiceDetails}</p>}</section>
        <section><h3>{c.bookingsTable.accessNotes}</h3><p>{selectedBooking.notes || c.bookingsTable.noAccessNotes}</p></section>
      </div>
    </Modal>}
  </>
}
