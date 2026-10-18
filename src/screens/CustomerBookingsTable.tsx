import { useMemo, useState } from 'react'
import { ArrowRight } from 'lucide-react'
import { customerDemoDataEnabled } from '../constants/demo'
import { useCustomerBookings } from '../hooks/useCustomerData'

type BookingRow = { id: string; service: string; location: string; status: string; amount: string }
type Props = { onNavigate: (screen: 'booking' | 'bookings' | 'offers' | 'home') => void; onOpen: (id: string) => void }
const demoRows: BookingRow[] = customerDemoDataEnabled ? [{ id: 'UT-2408', service: 'Water tanker · 9 KL', location: 'ECR, Chennai', status: 'In progress', amount: '₹1,850' }, { id: 'UT-2394', service: 'Tank & sump cleaning', location: 'Adyar, Chennai', status: 'Delivered', amount: '₹2,400' }, { id: 'UT-2388', service: 'Sewage tanker', location: 'Velachery, Chennai', status: 'Scheduled', amount: '₹3,100' }] : []

export function CustomerBookingsTable({ onNavigate, onOpen }: Props) {
  const query = useCustomerBookings()
  const [filter, setFilter] = useState('all')
  const [sort, setSort] = useState<'recent' | 'status' | 'amount'>('recent')
  const [page, setPage] = useState(1)
  const rows = customerDemoDataEnabled ? demoRows : (query.data ?? []).map((booking) => ({ id: booking.id, service: booking.service, location: booking.location, status: booking.status, amount: `₹${booking.amount}` }))
  const filteredRows = useMemo(() => rows.filter((booking) => filter === 'all' || booking.status.toLowerCase() === filter), [filter, rows])
  const sortedRows = useMemo(() => [...filteredRows].sort((first, second) => sort === 'status' ? first.status.localeCompare(second.status) : sort === 'amount' ? Number(second.amount.replace(/[^0-9.]/g, '')) - Number(first.amount.replace(/[^0-9.]/g, '')) : second.id.localeCompare(first.id)), [filteredRows, sort])
  const pageSize = 5
  const pageCount = Math.max(1, Math.ceil(sortedRows.length / pageSize))
  const currentPage = Math.min(page, pageCount)
  const visibleRows = sortedRows.slice((currentPage - 1) * pageSize, currentPage * pageSize)
  if (!customerDemoDataEnabled && query.isLoading) return <section className="workspace-view-panel customer-operation-panel"><p className="eyebrow">MY BOOKINGS</p><h2>Loading your bookings...</h2></section>
  if (!customerDemoDataEnabled && query.isError) return <section className="workspace-view-panel customer-operation-panel"><p className="eyebrow">MY BOOKINGS</p><h2>Bookings are unavailable.</h2><button className="button button-primary" onClick={() => query.refetch()}>Retry</button></section>
  return <section className="workspace-view-panel customer-operation-panel customer-bookings-table-panel"><div className="view-panel-heading"><div><p className="eyebrow">MY BOOKINGS</p><h2>Every request, in one clear record.</h2></div><div className="booking-table-tools"><label>Filter<select value={filter} onChange={(event) => { setFilter(event.target.value); setPage(1) }}><option value="all">All statuses</option><option value="in progress">In progress</option><option value="scheduled">Scheduled</option><option value="delivered">Delivered</option><option value="cancelled">Cancelled</option></select></label><label>Sort<select value={sort} onChange={(event) => setSort(event.target.value as typeof sort)}><option value="recent">Recent</option><option value="status">Status</option><option value="amount">Amount</option></select></label></div></div><div className="customer-booking-table-wrap"><table className="customer-booking-table"><thead><tr><th>Booking</th><th>Service</th><th>Location</th><th>Status</th><th>Amount</th><th>Action</th></tr></thead><tbody>{visibleRows.map((booking) => <tr key={booking.id}><td><b>{booking.id}</b></td><td>{booking.service}</td><td>{booking.location}</td><td><span className={`status-tag ${booking.status === 'Delivered' ? '' : 'pending'}`}>{booking.status}</span></td><td>{booking.amount}</td><td><button className="text-button" onClick={() => onNavigate('booking')}>Book again <ArrowRight size={14} /></button><button className="text-button" onClick={() => onOpen(booking.id)}>View <ArrowRight size={14} /></button></td></tr>)}</tbody></table>{!sortedRows.length && <div className="admin-empty-state"><p>No bookings match the selected filter.</p></div>}</div><div className="booking-table-pagination"><span>{sortedRows.length ? `Showing ${(currentPage - 1) * pageSize + 1}-${Math.min(currentPage * pageSize, sortedRows.length)} of ${sortedRows.length}` : 'No bookings to display'}</span><div><button className="button button-quiet" disabled={currentPage <= 1} onClick={() => setPage((value) => value - 1)}>Previous</button><button className="button button-quiet" disabled={currentPage >= pageCount} onClick={() => setPage((value) => value + 1)}>Next</button></div></div></section>
}
