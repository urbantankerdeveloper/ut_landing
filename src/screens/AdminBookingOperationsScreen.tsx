import { useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, ChevronDown, RefreshCw } from 'lucide-react'
import { adminApi, type AdminOrder } from '../api/admin'
import { adminQueryKeys, useAdminBookings, useAdminOrderMutations, useAdminDrivers, useAdminVehicles, useAdminVendors } from '../hooks/useAdminData'
import { Modal } from '../components/Modal'
import { adminOperationsContent as c } from '../content/admin-operations'

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

const statusOptions = ['pending_vendor', 'vendor_assigned', 'accepted', 'en_route', 'arrived', 'delivered'] as const

function formatDate(value?: string) {
  if (!value) return c.common.notProvided
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

function formatStatus(value: string) {
  return value.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function serviceLabel(value?: string) {
  return value ? value.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()) : c.bookings.serviceFallback
}

function paymentLabel(value?: string) {
  if (value === 'cod') return c.bookings.paymentMethods.cod
  if (value === 'gateway') return c.bookings.paymentMethods.gateway
  if (value === 'wallet') return c.bookings.paymentMethods.wallet
  return value || c.common.notProvided
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

  const filteredRows = useMemo(() => ((query.data ?? []) as BookingRow[]).filter((booking) => filter === 'all' || booking.status === filter), [filter, query.data])
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
      if (!assigningBooking || !vendorId) throw new Error(c.bookings.errors.selectVendor)
      return adminApi.assignOrder(assigningBooking.id, { vendorId, vehicleId: vehicleId || undefined, driverId: driverId || undefined })
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: adminQueryKeys.orders })
      setAssigningBooking(null)
      setVendorId('')
      setVehicleId('')
      setDriverId('')
      onNotice(c.bookings.notices.assigned)
    },
    onError: (error) => onNotice(error instanceof Error ? error.message : c.bookings.notices.assignFailed),
  })

  if (query.isLoading) return <section className="admin-view-panel" role="status"><h2>{c.bookings.loading}</h2></section>
  if (query.isError) return <section className="admin-view-panel"><h2>{c.bookings.unavailable}</h2><p role="alert">{query.error instanceof Error ? query.error.message : c.common.apiRequestFailed}</p><button className="button button-primary" onClick={() => query.refetch()}>{c.common.retry}</button></section>

  function cancel() {
    if (!selected || reason.trim().length < 2) return
    mutations.cancel.mutate({ id: selected, reason }, {
      onSuccess: () => { setSelected(null); setReason(''); onNotice(c.bookings.notices.cancelled) },
      onError: () => onNotice(c.bookings.notices.cancelFailed),
    })
  }

  return <>
    <section className="admin-view-panel customer-bookings-table-panel">
      <div className="view-panel-heading admin-bookings-heading">
        <div><p className="eyebrow">{c.bookings.eyebrow}</p><h2>{c.bookings.title}</h2></div>
        <button className="button button-quiet" onClick={() => query.refetch()} disabled={query.isFetching}><RefreshCw size={14} /> {c.common.refresh}</button>
        <div className="booking-table-tools">
          <label>{c.bookings.filter}<select value={filter} onChange={(event) => { setFilter(event.target.value); setPage(1) }}><option value="all">{c.bookings.allStatuses}</option>{statusOptions.map((value) => <option value={value} key={value}>{c.bookings.statusLabels[value]}</option>)}<option value="cancelled">{c.bookings.statusLabels.cancelled}</option></select></label>
          <label>{c.bookings.sort}<select value={sort} onChange={(event) => setSort(event.target.value as typeof sort)}><option value="recent">{c.bookings.sortOptions.recent}</option><option value="status">{c.bookings.sortOptions.status}</option><option value="amount">{c.bookings.sortOptions.amount}</option></select></label>
        </div>
      </div>
      <div className="customer-booking-table-wrap">
        <table className="customer-booking-table admin-booking-table">
          <thead><tr><th scope="col">{c.bookings.tableHeaders.booking}</th><th scope="col">{c.bookings.tableHeaders.service}</th><th scope="col">{c.bookings.tableHeaders.location}</th><th scope="col">{c.bookings.tableHeaders.status}</th><th scope="col">{c.bookings.tableHeaders.amount}</th></tr></thead>
          <tbody>{visibleRows.map((booking) => {
            const id = booking.reference || booking.id
            const amount = booking.quoted_amount_paise !== undefined ? booking.quoted_amount_paise / 100 : booking.amount
            const service = booking.service || serviceLabel(booking.service_code)
            const location = booking.address_text || booking.location || c.common.notProvided
            return <tr key={booking.id}>
              <td><button className="admin-booking-id" type="button" onClick={() => setSelectedBooking(booking)}>{id}</button></td>
              <td>{service}</td>
              <td className="admin-booking-location">{location}</td>
              <td><label className="admin-booking-status-control"><select className={`status-tag admin-booking-status ${booking.status === 'delivered' ? '' : booking.status === 'cancelled' ? 'inactive' : 'pending'}`} aria-label={c.bookings.rows.actionsFor(id)} value={booking.status} onChange={(event) => { if (event.target.value === '__assign__') { setAssigningBooking(booking); setVendorId(''); setVehicleId(''); setDriverId('') } else if (event.target.value === '__cancel__') { setSelected(booking.id); setReason('') } }} disabled={(assignOrder.isPending && assigningBooking?.id === booking.id) || (mutations.cancel.isPending && selected === booking.id) || booking.status === 'cancelled' || booking.status === 'delivered'}><option value={booking.status}>{formatStatus(booking.status)}</option>{booking.status === 'pending_vendor' && <option value="__assign__">{c.bookings.rows.assignVendor}</option>}<option value="__cancel__">{c.bookings.rows.cancelOrder}</option></select><ChevronDown size={12} aria-hidden="true" /></label></td>
              <td>₹{(amount ?? 0).toLocaleString('en-IN')}</td>
            </tr>
          })}</tbody>
        </table>
        {!sortedRows.length && <div className="admin-empty-state"><p>{c.bookings.rows.noMatch}</p></div>}
      </div>
      <div className="booking-table-pagination">
        <span>{sortedRows.length ? c.bookings.rows.showing((currentPage - 1) * pageSize + 1, Math.min(currentPage * pageSize, sortedRows.length), sortedRows.length) : c.bookings.rows.noneToDisplay}</span>
        <div><button className="button button-quiet" disabled={currentPage <= 1} onClick={() => setPage((value) => value - 1)}>{c.bookings.rows.previous}</button><button className="button button-quiet" disabled={currentPage >= pageCount} onClick={() => setPage((value) => value + 1)}>{c.bookings.rows.next}</button></div>
      </div>
    </section>
    {assigningBooking && <Modal title={c.bookings.assign.modalTitle(assigningBooking.reference || assigningBooking.id)} onClose={() => setAssigningBooking(null)}>
      {vendorsQuery.isLoading || vehiclesQuery.isLoading || driversQuery.isLoading
        ? <p>{c.bookings.assign.loadingOptions}</p>
        : vendorsQuery.isError || vehiclesQuery.isError || driversQuery.isError
          ? <div className="modal-form"><p role="alert">{c.bookings.assign.optionsError}</p><button className="button button-quiet" type="button" onClick={() => { void vendorsQuery.refetch(); void vehiclesQuery.refetch(); void driversQuery.refetch() }}>{c.common.retry}</button></div>
          : <form className="modal-form" onSubmit={(event) => { event.preventDefault(); assignOrder.mutate() }}>
            <label>{c.bookings.assign.vendor}<select required value={vendorId} onChange={(event) => { setVendorId(event.target.value); setVehicleId(''); setDriverId('') }}><option value="" disabled>{c.bookings.assign.selectVendor}</option>{vendors.filter((vendor) => vendor.verification === 'approved').map((vendor) => <option key={vendor.id} value={vendor.id}>{vendor.business_name ?? vendor.name ?? vendor.id}</option>)}</select></label>
            <label>{c.bookings.assign.fleetVehicle}<select required value={vehicleId} onChange={(event) => setVehicleId(event.target.value)} disabled={!vendorId}><option value="" disabled>{c.bookings.assign.selectVehicle}</option>{availableVehicles.map((vehicle) => <option key={vehicle.id} value={vehicle.id}>{vehicle.registration_number ?? vehicle.id}{vehicle.capacity_litres ? c.bookings.assign.vehicleOption(vehicle.capacity_litres.toLocaleString('en-IN')) : ''}</option>)}</select></label>
            <label>{c.bookings.assign.driver}<select required value={driverId} onChange={(event) => setDriverId(event.target.value)} disabled={!vendorId}><option value="" disabled>{c.bookings.assign.selectDriver}</option>{availableDrivers.map((driver) => <option key={driver.id} value={driver.id}>{driver.name ?? driver.id}{driver.mobile_e164 ? c.bookings.assign.driverOption(driver.mobile_e164) : ''}</option>)}</select></label>
            <div className="admin-cancel-dialog"><p>{c.bookings.assign.hint}</p><div><button className="button button-quiet" type="button" onClick={() => setAssigningBooking(null)}>{c.bookings.assign.keepUnassigned}</button><button className="button button-primary" type="submit" disabled={!vendorId || !vehicleId || !driverId || assignOrder.isPending}>{assignOrder.isPending ? c.bookings.assign.assigning : c.bookings.assign.confirm}</button></div></div>
          </form>}
    </Modal>}
    {selectedBooking && <Modal title={c.bookings.details.modalTitle(selectedBooking.reference || selectedBooking.id)} onClose={() => setSelectedBooking(null)}>
      <div className="customer-booking-details">
        <div className="customer-booking-detail-grid">
          <div><span>{c.bookings.details.status}</span><strong>{formatStatus(selectedBooking.status)}</strong></div>
          <div><span>{c.bookings.details.total}</span><strong>₹{((selectedBooking.quoted_amount_paise ?? selectedBooking.amount * 100) / 100).toLocaleString('en-IN')}</strong></div>
          <div><span>{c.bookings.details.bookingId}</span><strong>{selectedBooking.id}</strong></div>
          <div><span>{c.bookings.details.preferredDelivery}</span><strong>{formatDate(selectedBooking.scheduled_for)}</strong></div>
          <div><span>{c.bookings.details.paymentMethod}</span><strong>{paymentLabel(selectedBooking.payment_method)}</strong></div>
          <div><span>{c.bookings.details.customerPhone}</span><strong>{selectedBooking.customer_phone_e164 || c.common.notProvided}</strong></div>
          <div><span>{c.bookings.details.customerId}</span><strong>{selectedBooking.customer_id || c.common.notProvided}</strong></div>
          <div><span>{c.bookings.details.vendorId}</span><strong>{selectedBooking.vendor_id || c.common.notAssigned}</strong></div>
          <div><span>{c.bookings.details.vehicleId}</span><strong>{selectedBooking.vehicle_id || c.common.notAssigned}</strong></div>
          <div><span>{c.bookings.details.capacity}</span><strong>{selectedBooking.capacity_litres ? c.bookings.details.capacityValue(selectedBooking.capacity_litres.toLocaleString('en-IN')) : c.common.notProvided}</strong></div>
          <div><span>{c.bookings.details.created}</span><strong>{formatDate(selectedBooking.created_at)}</strong></div>
          <div><span>{c.bookings.details.lastUpdated}</span><strong>{formatDate(selectedBooking.updated_at)}</strong></div>
          <div><span>{c.bookings.details.latitude}</span><strong>{selectedBooking.latitude ?? c.common.notProvided}</strong></div>
          <div><span>{c.bookings.details.longitude}</span><strong>{selectedBooking.longitude ?? c.common.notProvided}</strong></div>
          <div><span>{c.bookings.details.deliveryLocation}</span><strong>{selectedBooking.address_text || selectedBooking.location || c.common.notProvided}</strong></div>
        </div>
        {selectedBooking.cancellation_reason && <section><h3>{c.bookings.details.cancellationReason}</h3><p>{selectedBooking.cancellation_reason}</p></section>}
        <section><h3>{c.bookings.details.serviceDetails}</h3>{selectedBooking.service_details?.length
          ? <ul>{selectedBooking.service_details.map((service, index) => <li key={`${service.serviceId ?? 'service'}-${index}`}>
            <strong>{serviceLabel(service.serviceId || selectedBooking.service_code)}</strong>
            {service.capacity && <span>{c.common.separator}{service.capacity}</span>}
            {service.waterType && <p>{c.bookings.details.waterType(service.waterType)}</p>}
            {service.tankerCount && <p>{c.bookings.details.tankerCount(service.tankerCount)}</p>}
            {service.deliveryDate && <p>{c.bookings.details.preferredDate(formatDate(service.deliveryDate))}</p>}
            {service.location && <p>{c.bookings.details.serviceLocation(service.location)}</p>}
            {service.latitude !== undefined && service.longitude !== undefined && <p>{c.bookings.details.coordinates(service.latitude, service.longitude)}</p>}
            <p>{service.details || c.bookings.details.noAdditionalServiceDetails}</p>
          </li>)}</ul>
          : <p>{c.bookings.details.noServiceDetails}</p>}</section>
        <section><h3>{c.bookings.details.deliveryAccessNotes}</h3><p>{selectedBooking.access_notes || c.bookings.details.noAccessNotes}</p></section>
      </div>
    </Modal>}
    {selected && <Modal title={c.bookings.cancel.modalTitle(selected)} onClose={() => { setSelected(null); setReason('') }}>
      <div className="modal-form admin-cancel-dialog">
        <p>{c.bookings.cancel.confirmText}</p>
        <label>{c.bookings.cancel.reasonLabel}<textarea value={reason} onChange={(event) => setReason(event.target.value)} rows={3} placeholder={c.bookings.cancel.reasonPlaceholder} /></label>
        <div><button className="button button-quiet" onClick={() => { setSelected(null); setReason('') }}>{c.bookings.cancel.keepBooking}</button><button className="button button-primary" disabled={mutations.cancel.isPending || reason.trim().length < 2} onClick={cancel}><CheckCircle2 size={14} /> {c.bookings.cancel.confirm}</button></div>
      </div>
    </Modal>}
  </>
}
