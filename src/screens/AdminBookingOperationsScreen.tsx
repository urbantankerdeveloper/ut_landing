import { useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, ChevronDown, RefreshCw } from 'lucide-react'
import { adminApi, type AdminOrder } from '../api/admin'
import { adminQueryKeys, useAdminBookings, useAdminOrderMutations, useAdminDrivers, useAdminVehicles, useAdminVendors } from '../hooks/useAdminData'
import { Modal } from './WorkspaceInteractive'

type BookingServiceDetail = {
  serviceId?: string
  capacity?: string
  waterType?: string
  tankerCount?: string
  details?: string
  deliveryDate?: string
  location?: string
  latitude?: number
  longitude?: number
}

type BookingRow = AdminOrder & {
  reference?: string
  service_code?: string
  customer_id?: string
  customer_phone_e164?: string
  vendor_id?: string
  vehicle_id?: string
  capacity_litres?: number
  scheduled_for?: string
  address_text?: string
  latitude?: number
  longitude?: number
  access_notes?: string
  cancellation_reason?: string | null
  service_details?: BookingServiceDetail[]
  quoted_amount_paise?: number
  payment_method?: string
  created_at?: string
  updated_at?: string
}

const statusOptions = [
  ['pending_vendor', 'Pending vendor'],
  ['vendor_assigned', 'Vendor assigned'],
  ['accepted', 'Accepted'],
  ['en_route', 'En route'],
  ['arrived', 'Arrived'],
  ['delivered', 'Delivered'],
] as const

function formatDate(value?: string) {
  if (!value) return 'Not provided'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

function formatStatus(value: string) {
  return value.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function serviceLabel(value?: string) {
  return value ? value.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()) : 'Service'
}

function paymentLabel(value?: string) {
  if (value === 'cod') return 'Cash on delivery'
  if (value === 'gateway') return 'Card or UPI'
  if (value === 'wallet') return 'Urban Tanker wallet'
  return value || 'Not provided'
}

export function AdminBookingOperationsScreen({ onNotice }: { onNotice: (message: string) => void }) {
  const query = useAdminBookings()
  const mutations = useAdminOrderMutations()
  const vendorsQuery = useAdminVendors()
  const vehiclesQuery = useAdminVehicles()
  const driversQuery = useAdminDrivers()
  const queryClient = useQueryClient()
  const [selected, setSelected] = useState<string | null>(null)
  const [selectedBooking, setSelectedBooking] = useState<BookingRow | null>(null)
  const [assigningBooking, setAssigningBooking] = useState<BookingRow | null>(null)
  const [vendorId, setVendorId] = useState('')
  const [vehicleId, setVehicleId] = useState('')
  const [driverId, setDriverId] = useState('')
  const [reason, setReason] = useState('')
  const [filter, setFilter] = useState('all')
  const [sort, setSort] = useState<'recent' | 'status' | 'amount'>('recent')
  const [page, setPage] = useState(1)

  const rows = (query.data ?? []) as BookingRow[]
  const filteredRows = useMemo(() => rows.filter((booking) => filter === 'all' || booking.status === filter), [filter, rows])
  const sortedRows = useMemo(() => [...filteredRows].sort((first, second) => {
    if (sort === 'status') return first.status.localeCompare(second.status)
    if (sort === 'amount') return (second.quoted_amount_paise ?? second.amount * 100) - (first.quoted_amount_paise ?? first.amount * 100)
    return (second.created_at ?? second.scheduled_for ?? '').localeCompare(first.created_at ?? first.scheduled_for ?? '')
  }), [filteredRows, sort])
  const pageSize = 10
  const pageCount = Math.max(1, Math.ceil(sortedRows.length / pageSize))
  const currentPage = Math.min(page, pageCount)
  const visibleRows = sortedRows.slice((currentPage - 1) * pageSize, currentPage * pageSize)
  const vendors = (vendorsQuery.data ?? []) as Array<{ id: string; business_name?: string; name?: string; verification?: string }>
  const vehicles = (vehiclesQuery.data ?? []) as Array<{ id: string; vendor_id?: string; registration_number?: string; capacity_litres?: number; is_active?: boolean; verification?: string }>
  const drivers = (driversQuery.data ?? []) as Array<{ id: string; vendor_id?: string; name?: string; mobile_e164?: string; is_active?: boolean; verification?: string }>
  const availableVehicles = vehicles.filter((vehicle) => vehicle.vendor_id === vendorId && vehicle.is_active && vehicle.verification === 'approved')
  const availableDrivers = drivers.filter((driver) => driver.vendor_id === vendorId && driver.is_active && driver.verification === 'approved')
  const assignOrder = useMutation({
    mutationFn: () => {
      if (!assigningBooking || !vendorId) throw new Error('Select a vendor to assign the booking.')
      return adminApi.assignOrder(assigningBooking.id, { vendorId, vehicleId: vehicleId || undefined, driverId: driverId || undefined })
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: adminQueryKeys.orders })
      setAssigningBooking(null)
      setVendorId('')
      setVehicleId('')
      setDriverId('')
      onNotice('Vendor assignment saved.')
    },
    onError: (error) => onNotice(error instanceof Error ? error.message : 'Vendor assignment could not be saved.'),
  })

  if (query.isLoading) return <section className="admin-view-panel"><h2>Loading bookings...</h2></section>
  if (query.isError) return <section className="admin-view-panel"><h2>Bookings are unavailable.</h2><button className="button button-primary" onClick={() => query.refetch()}>Retry</button></section>

  function cancel() {
    if (!selected || reason.trim().length < 2) return
    mutations.cancel.mutate({ id: selected, reason }, {
      onSuccess: () => { setSelected(null); setReason(''); onNotice('Booking cancelled and audited.') },
      onError: () => onNotice('Booking could not be cancelled.'),
    })
  }

  return <>
    <section className="admin-view-panel customer-bookings-table-panel">
      <div className="view-panel-heading admin-bookings-heading">
        <div><p className="eyebrow">BOOKINGS</p><h2>Live booking operations.</h2></div>
        <button className="button button-quiet" onClick={() => query.refetch()} disabled={query.isFetching}><RefreshCw size={14} /> Refresh</button>
        <div className="booking-table-tools">
          <label>Filter<select value={filter} onChange={(event) => { setFilter(event.target.value); setPage(1) }}><option value="all">All statuses</option>{statusOptions.map(([value, label]) => <option value={value} key={value}>{label}</option>)}<option value="cancelled">Cancelled</option></select></label>
          <label>Sort<select value={sort} onChange={(event) => setSort(event.target.value as typeof sort)}><option value="recent">Recent</option><option value="status">Status</option><option value="amount">Amount</option></select></label>
        </div>
      </div>
      <div className="customer-booking-table-wrap">
        <table className="customer-booking-table admin-booking-table">
          <thead><tr><th>Booking</th><th>Service</th><th>Location</th><th>Status</th><th>Amount</th></tr></thead>
          <tbody>{visibleRows.map((booking) => {
            const id = booking.reference || booking.id
            const amount = booking.quoted_amount_paise !== undefined ? booking.quoted_amount_paise / 100 : booking.amount
            const service = booking.service || serviceLabel(booking.service_code)
            const location = booking.address_text || booking.location || 'Not provided'
            return <tr key={booking.id}>
              <td><button className="admin-booking-id" type="button" onClick={() => setSelectedBooking(booking)}>{id}</button></td>
              <td>{service}</td>
              <td className="admin-booking-location">{location}</td>
              <td><label className="admin-booking-status-control"><select className={`status-tag admin-booking-status ${booking.status === 'delivered' ? '' : booking.status === 'cancelled' ? 'inactive' : 'pending'}`} aria-label={`Booking actions for ${id}`} value={booking.status} onChange={(event) => { if (event.target.value === '__assign__') { setAssigningBooking(booking); setVendorId(''); setVehicleId(''); setDriverId('') } else if (event.target.value === '__cancel__') { setSelected(booking.id); setReason('') } }} disabled={assignOrder.isPending || mutations.cancel.isPending || booking.status === 'cancelled' || booking.status === 'delivered'}><option value={booking.status}>{formatStatus(booking.status)}</option>{booking.status === 'pending_vendor' && <option value="__assign__">Assign vendor…</option>}<option value="__cancel__">Cancel order…</option></select><ChevronDown size={12} aria-hidden="true" /></label></td>
              <td>₹{(amount ?? 0).toLocaleString('en-IN')}</td>
            </tr>
          })}</tbody>
        </table>
        {!sortedRows.length && <div className="admin-empty-state"><p>No bookings match the selected filter.</p></div>}
      </div>
      <div className="booking-table-pagination">
        <span>{sortedRows.length ? `Showing ${(currentPage - 1) * pageSize + 1}-${Math.min(currentPage * pageSize, sortedRows.length)} of ${sortedRows.length}` : 'No bookings to display'}</span>
        <div><button className="button button-quiet" disabled={currentPage <= 1} onClick={() => setPage((value) => value - 1)}>Previous</button><button className="button button-quiet" disabled={currentPage >= pageCount} onClick={() => setPage((value) => value + 1)}>Next</button></div>
      </div>
    </section>
    {assigningBooking && <Modal title={`Assign booking ${assigningBooking.reference || assigningBooking.id}`} onClose={() => setAssigningBooking(null)}>
      {vendorsQuery.isLoading || vehiclesQuery.isLoading || driversQuery.isLoading
        ? <p>Loading vendor and fleet options...</p>
        : vendorsQuery.isError || vehiclesQuery.isError || driversQuery.isError
          ? <div className="modal-form"><p role="alert">Vendor or fleet options could not be loaded.</p><button className="button button-quiet" type="button" onClick={() => { void vendorsQuery.refetch(); void vehiclesQuery.refetch(); void driversQuery.refetch() }}>Retry</button></div>
          : <form className="modal-form" onSubmit={(event) => { event.preventDefault(); assignOrder.mutate() }}>
            <label>Vendor<select required value={vendorId} onChange={(event) => { setVendorId(event.target.value); setVehicleId(''); setDriverId('') }}><option value="" disabled>Select vendor</option>{vendors.filter((vendor) => vendor.verification === 'approved').map((vendor) => <option key={vendor.id} value={vendor.id}>{vendor.business_name ?? vendor.name ?? vendor.id}</option>)}</select></label>
            <label>Fleet vehicle<select required value={vehicleId} onChange={(event) => setVehicleId(event.target.value)} disabled={!vendorId}><option value="" disabled>Select vehicle</option>{availableVehicles.map((vehicle) => <option key={vehicle.id} value={vehicle.id}>{vehicle.registration_number ?? vehicle.id}{vehicle.capacity_litres ? ` · ${vehicle.capacity_litres.toLocaleString('en-IN')} litres` : ''}</option>)}</select></label>
            <label>Driver<select required value={driverId} onChange={(event) => setDriverId(event.target.value)} disabled={!vendorId}><option value="" disabled>Select driver</option>{availableDrivers.map((driver) => <option key={driver.id} value={driver.id}>{driver.name ?? driver.id}{driver.mobile_e164 ? ` · ${driver.mobile_e164}` : ''}</option>)}</select></label>
            <div className="admin-cancel-dialog"><p>Choose an approved, active vehicle and driver for the selected vendor.</p><div><button className="button button-quiet" type="button" onClick={() => setAssigningBooking(null)}>Keep unassigned</button><button className="button button-primary" type="submit" disabled={!vendorId || !vehicleId || !driverId || assignOrder.isPending}>{assignOrder.isPending ? 'Assigning…' : 'Confirm assignment'}</button></div></div>
          </form>}
    </Modal>}
    {selectedBooking && <Modal title={`Booking ${selectedBooking.reference || selectedBooking.id}`} onClose={() => setSelectedBooking(null)}>
      <div className="customer-booking-details">
        <div className="customer-booking-detail-grid">
          <div><span>Status</span><strong>{formatStatus(selectedBooking.status)}</strong></div>
          <div><span>Total</span><strong>₹{((selectedBooking.quoted_amount_paise ?? selectedBooking.amount * 100) / 100).toLocaleString('en-IN')}</strong></div>
          <div><span>Booking ID</span><strong>{selectedBooking.id}</strong></div>
          <div><span>Preferred delivery</span><strong>{formatDate(selectedBooking.scheduled_for)}</strong></div>
          <div><span>Payment method</span><strong>{paymentLabel(selectedBooking.payment_method)}</strong></div>
          <div><span>Customer phone</span><strong>{selectedBooking.customer_phone_e164 || 'Not provided'}</strong></div>
          <div><span>Customer ID</span><strong>{selectedBooking.customer_id || 'Not provided'}</strong></div>
          <div><span>Vendor ID</span><strong>{selectedBooking.vendor_id || 'Not assigned'}</strong></div>
          <div><span>Vehicle ID</span><strong>{selectedBooking.vehicle_id || 'Not assigned'}</strong></div>
          <div><span>Capacity</span><strong>{selectedBooking.capacity_litres ? `${selectedBooking.capacity_litres.toLocaleString('en-IN')} litres` : 'Not provided'}</strong></div>
          <div><span>Created</span><strong>{formatDate(selectedBooking.created_at)}</strong></div>
          <div><span>Last updated</span><strong>{formatDate(selectedBooking.updated_at)}</strong></div>
          <div><span>Latitude</span><strong>{selectedBooking.latitude ?? 'Not provided'}</strong></div>
          <div><span>Longitude</span><strong>{selectedBooking.longitude ?? 'Not provided'}</strong></div>
          <div><span>Delivery location</span><strong>{selectedBooking.address_text || selectedBooking.location || 'Not provided'}</strong></div>
        </div>
        {selectedBooking.cancellation_reason && <section><h3>Cancellation reason</h3><p>{selectedBooking.cancellation_reason}</p></section>}
        <section><h3>Service details</h3>{selectedBooking.service_details?.length
          ? <ul>{selectedBooking.service_details.map((service, index) => <li key={`${service.serviceId ?? 'service'}-${index}`}>
            <strong>{serviceLabel(service.serviceId || selectedBooking.service_code)}</strong>
            {service.capacity && <span> · {service.capacity}</span>}
            {service.waterType && <p>Water type: {service.waterType}</p>}
            {service.tankerCount && <p>Number of tankers: {service.tankerCount}</p>}
            {service.deliveryDate && <p>Preferred date: {formatDate(service.deliveryDate)}</p>}
            {service.location && <p>Service location: {service.location}</p>}
            {service.latitude !== undefined && service.longitude !== undefined && <p>Coordinates: {service.latitude}, {service.longitude}</p>}
            <p>{service.details || 'No additional service details.'}</p>
          </li>)}</ul>
          : <p>No service details were recorded for this booking.</p>}</section>
        <section><h3>Delivery access notes</h3><p>{selectedBooking.access_notes || 'No additional access notes.'}</p></section>
      </div>
    </Modal>}
    {selected && <Modal title={`Cancel booking ${selected}`} onClose={() => { setSelected(null); setReason('') }}>
      <div className="modal-form admin-cancel-dialog">
        <p>Are you sure you want to cancel this booking? It will remain in the records with a cancelled status.</p>
        <label>Cancellation reason<textarea value={reason} onChange={(event) => setReason(event.target.value)} rows={3} placeholder="Required cancellation reason" /></label>
        <div><button className="button button-quiet" onClick={() => { setSelected(null); setReason('') }}>Keep booking</button><button className="button button-primary" disabled={mutations.cancel.isPending || reason.trim().length < 2} onClick={cancel}><CheckCircle2 size={14} /> Confirm cancellation</button></div>
      </div>
    </Modal>}
  </>
}
