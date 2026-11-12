import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Check, ClipboardList, MapPin, ShieldCheck, Truck, UserRound } from 'lucide-react'
import { demoDataEnabled } from '../constants/demo'
import { Modal } from '../components/Modal'
import { useVendorDeliveryVerification, useVendorDrivers, useVendorLocation, useVendorOrderMutation, useVendorOrders, useVendorVehicles } from '../hooks/useVendorData'
import { useFileUpload } from '../hooks/useFrontendFeatures'
import { vendorContent as c } from '../content/vendor'
import { useVendorOrderRequestStore } from '../stores/vendorOrderRequestStore'
import { dismissNotice } from '../utils/notify'

type OrderStatus = 'Available' | 'Assigned' | 'Accepted' | 'En route' | 'Arrived' | 'Delivered' | 'Rejected' | 'Unavailable'
type VendorOrder = { id: string; reference?: string; service: string; serviceDetails?: { service: string; capacity?: string; waterType?: string; tankerCount?: string; details?: string; deliveryDate?: string; location?: string }[]; location: string; distance?: number | null; amount: string; status: OrderStatus; statusMessage?: string; vehicle?: string; driver?: string }
type Props = { onNotice: (message: string) => void }
const demoOrders: VendorOrder[] = demoDataEnabled ? [...c.orders.demo.orders] : []
const demoVehicles = [...c.orders.demo.vehicles]
const demoDrivers = [...c.orders.demo.drivers]
const nextStatus: Partial<Record<OrderStatus, OrderStatus>> = { Accepted: 'En route', 'En route': 'Arrived', Arrived: 'Delivered' }

export default function VendorOrderPanel({ onNotice }: Props) {
  const [orders, setOrders] = useState(demoOrders)
  const ordersQuery = useVendorOrders()
  const vehiclesQuery = useVendorVehicles()
  const driversQuery = useVendorDrivers()
  const orderMutation = useVendorOrderMutation()
  const deliveryVerification = useVendorDeliveryVerification()
  const proofUpload = useFileUpload()
  const [radius, setRadius] = useState('25')
  const [selected, setSelected] = useState<VendorOrder | null>(null)
  const [dialog, setDialog] = useState<'assignment' | 'delivery' | null>(null)
  const [deliveryError, setDeliveryError] = useState<string | null>(null)
  const [offline, setOffline] = useState(!navigator.onLine)
  const orderRequest = useVendorOrderRequestStore((state) => state.request)
  const clearOrderRequest = useVendorOrderRequestStore((state) => state.clearRequest)
  const activeTrackingOrderId = orders.find((order) => order.status === 'En route')?.id ?? null
  useVendorLocation(activeTrackingOrderId)
  const filtered = useMemo(() => orders.filter((order) => (typeof order.distance !== 'number' || order.distance <= Number(radius)) && order.status !== 'Rejected'), [orders, radius])
  const vehicleRecords = demoDataEnabled ? demoVehicles : (vehiclesQuery.data ?? []).filter((vehicle) => vehicle.is_active && vehicle.verification === 'approved').map((vehicle) => ({ id: vehicle.id, label: `${vehicle.registration_number} · ${Math.round((vehicle.capacity_litres ?? 0) / 1000)} KL` }))
  const driverRecords = demoDataEnabled ? demoDrivers : (driversQuery.data ?? []).filter((driver) => driver.is_active && driver.verification === 'approved').map((driver) => ({ id: driver.id, label: driver.name }))
  const vehicles = vehicleRecords.map((vehicle) => vehicle.label)
  const drivers = driverRecords.map((driver) => driver.label)
  useEffect(() => {
    if (!ordersQuery.data) return
    const sync = window.setTimeout(() => setOrders(ordersQuery.data as VendorOrder[]), 0)
    return () => window.clearTimeout(sync)
  }, [ordersQuery.data])
  // A new-order toast asks for an action on one order. It waits until the list has loaded, then acts only if the order is still available.
  // The effect must set dialog state once the list arrives, so the set-state rule is disabled for this block only.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!orderRequest || orders.length === 0) return
    clearOrderRequest()
    const order = orders.find((item) => item.id === orderRequest.orderId)
    if (!order || order.status !== 'Available') return
    if (orderRequest.intent === 'reject') reject(order)
    else { setSelected(order); setDialog('assignment') }
    // reject is rebuilt each render, but the effect only acts on a pending request, so it is left out on purpose.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderRequest, orders, clearOrderRequest])
  /* eslint-enable react-hooks/set-state-in-effect */
  function updateOrder(id: string, update: Partial<VendorOrder>) { setOrders((items) => items.map((order) => order.id === id ? { ...order, ...update } : order)) }
  function mutateOrder(order: VendorOrder, update: Partial<VendorOrder>, payload: Parameters<typeof orderMutation.mutate>[0], success: string) { updateOrder(order.id, update); orderMutation.mutate(payload, { onSuccess: () => { dismissNotice(`offer:${order.id}`); onNotice(success) }, onError: () => { updateOrder(order.id, order); onNotice(c.orders.messages.updateFailed(order.id)) } }) }
  function accept(order: VendorOrder) { mutateOrder(order, { status: 'Accepted' }, { orderId: order.id, action: 'accept', status: 'Accepted' }, c.orders.messages.accepted(order.id)) }
  function reject(order: VendorOrder) { const reason = window.prompt(c.orders.messages.rejectReasonPrompt(order.reference ?? order.id))?.trim(); if (!reason) return; mutateOrder(order, { status: 'Rejected' }, { orderId: order.id, action: 'reject', status: 'Rejected', reason }, c.orders.messages.rejected(order.id)) }
  function advance(order: VendorOrder) { const status = nextStatus[order.status]; if (status) mutateOrder(order, { status }, { orderId: order.id, action: 'status', status }, c.orders.messages.marked(order.id, status)) }
  function assign(event: FormEvent<HTMLFormElement>) { event.preventDefault(); if (!selected) return; const values = new FormData(event.currentTarget); const vehicle = String(values.get('vehicle')); const driver = String(values.get('driver')); const vehicleId = vehicleRecords.find((item) => item.label === vehicle)?.id; const driverId = driverRecords.find((item) => item.label === driver)?.id; if (!vehicleId || !driverId || !vehicle || !driver) return; const previous = selected; updateOrder(selected.id, { status: 'Accepted', vehicle, driver }); orderMutation.mutate({ orderId: selected.id, action: 'accept', status: 'Accepted', vehicleId, driverId }, { onSuccess: () => { setDialog(null); dismissNotice(`offer:${selected.id}`); onNotice(c.orders.messages.acceptedAssigned(selected.id)) }, onError: () => { updateOrder(selected.id, previous); onNotice(c.orders.messages.acceptFailed(selected.id)) } }) }
  async function completeDelivery(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selected) return
    const values = new FormData(event.currentTarget)
    const otp = String(values.get('otp') || '').trim()
    const file = values.get('proof')
    const hasPhoto = file instanceof File && file.size > 0
    if (!otp && !hasPhoto) {
      setDeliveryError(c.orders.delivery.inputRequired)
      return
    }

    setDeliveryError(null)
    try {
      const proofPath = hasPhoto
        ? (await proofUpload.upload(file, 'booking', selected.id)).path
        : undefined
      await deliveryVerification.mutateAsync({
        id: selected.id,
        otp: otp || undefined,
        proofPath,
      })
      updateOrder(selected.id, { status: 'Delivered' })
      setDialog(null)
      onNotice(c.orders.messages.deliveryVerified(selected.id))
    } catch (error) {
      setDeliveryError(
        error instanceof Error ? error.message : c.orders.messages.deliveryFailed,
      )
    }
  }
  function toggleOffline() { setOffline((value) => !value); onNotice(!offline ? c.orders.offlineEnabled : c.orders.connectionRestored) }
  if (!demoDataEnabled && (ordersQuery.isLoading || vehiclesQuery.isLoading || driversQuery.isLoading)) return <section className="workspace-view-panel vendor-order-panel" role="status"><p className="eyebrow">{c.orders.eyebrow}</p><h2>{c.orders.loading}</h2></section>
  if (!demoDataEnabled && (ordersQuery.isError || vehiclesQuery.isError || driversQuery.isError)) return <section className="workspace-view-panel vendor-order-panel" role="alert"><p className="eyebrow">{c.orders.eyebrow}</p><h2>{c.orders.unavailable.title}</h2><p>{c.orders.unavailable.body}</p><button className="button button-primary" onClick={() => { void ordersQuery.refetch(); void vehiclesQuery.refetch(); void driversQuery.refetch() }}>{c.common.retry}</button></section>
  return <section className="workspace-view-panel vendor-order-panel">
    <div className="view-panel-heading"><div><p className="eyebrow">{c.orders.eyebrow}</p><h2>{c.orders.heading}</h2></div><div className="vendor-order-tools"><span className={offline ? 'offline-pill' : 'online-pill'}><i /> {offline ? c.orders.offlineDrafts : c.orders.online}</span><button className="button button-quiet" onClick={toggleOffline}>{offline ? c.orders.reconnect : c.orders.saveOfflineDraft}</button></div></div>
    <div className="vendor-order-filter"><label>{c.orders.filter.radiusLabel}<select value={radius} onChange={(event) => setRadius(event.target.value)}>{c.orders.filter.radiusOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label><span>{c.orders.filter.requestsAvailable(filtered.length)}</span></div>
    <div className="vendor-order-list">{filtered.map((order) => <article key={order.id}>
      <span className="vendor-order-icon"><ClipboardList size={18} /></span>
      <div className="vendor-order-copy">
        <b>{order.reference ?? order.id}{c.common.separator}{order.service}</b>
        <p><MapPin size={12} /> {order.location}{c.common.separator}{typeof order.distance === 'number' ? c.orders.distanceAway(order.distance) : c.orders.distanceUnavailable}{c.common.separator}{order.amount}</p>
        {order.serviceDetails?.map((item) => <small key={item.service}>{item.service}{item.capacity ? c.orders.detail.capacity(item.capacity) : ''}{item.waterType ? c.orders.detail.waterType(item.waterType) : ''}{item.tankerCount ? c.orders.detail.tankers(item.tankerCount, item.tankerCount !== '1') : ''}{item.deliveryDate ? c.orders.detail.deliveryDate(item.deliveryDate) : ''}{item.location ? c.orders.detail.location(item.location) : ''}{item.details ? c.orders.detail.details(item.details) : ''}</small>)}
        {order.vehicle && <small><Truck size={12} /> {order.vehicle}{c.common.separator}<UserRound size={12} /> {order.driver}</small>}
        {order.statusMessage && <small className="vendor-order-taken-note">{order.statusMessage}</small>}
      </div>
      <span className={`status-tag ${order.status === 'Available' ? 'pending' : order.status === 'Delivered' ? '' : 'inactive'}`}>{order.status}</span>
      <div className="vendor-order-actions">
        {order.status === 'Available' && <><button className="button button-primary" onClick={() => { setSelected(order); setDialog('assignment') }}>{c.orders.chooseFleetAndAccept}</button><button className="button button-quiet" onClick={() => reject(order)}>{c.orders.decline}</button></>}
        {order.status === 'Assigned' && <button className="button button-primary" onClick={() => accept(order)}>{c.orders.acceptAndNotify}</button>}
        {order.status === 'Accepted' && <button className="button button-primary" onClick={() => advance(order)}>{c.orders.startDelivery}</button>}
        {order.status === 'En route' && <button className="button button-primary" onClick={() => advance(order)}>{c.orders.markArrived}</button>}
        {order.status === 'Arrived' && <button className="button button-primary" onClick={() => { setSelected(order); setDeliveryError(null); setDialog('delivery') }}>{c.orders.verifyDelivery}</button>}
      </div>
    </article>)}{!filtered.length && <div className="admin-empty-state">{c.orders.emptyRadius}</div>}</div>
    {ordersQuery.hasNextPage && <button className="button button-quiet vendor-orders-load-more" disabled={ordersQuery.isFetchingNextPage} onClick={() => void ordersQuery.fetchNextPage()}>{ordersQuery.isFetchingNextPage ? c.orders.loadingOlder : c.orders.loadOlder}</button>}
    {dialog === 'assignment' && selected && <Modal title={c.orders.assignment.title(selected.reference ?? selected.id)} onClose={() => setDialog(null)}><form className="modal-form" onSubmit={assign}><p className="modal-required-note">{c.orders.assignment.note}</p><label>{c.orders.assignment.vehicle}<select name="vehicle" required defaultValue={selected.vehicle || ''}><option value="" disabled>{c.orders.assignment.selectVehicle}</option>{vehicles.map((vehicle) => <option key={vehicle}>{vehicle}</option>)}</select></label><label>{c.orders.assignment.driver}<select name="driver" required defaultValue={selected.driver || ''}><option value="" disabled>{c.orders.assignment.selectDriver}</option>{drivers.map((driver) => <option key={driver}>{driver}</option>)}</select></label><button className="button button-primary button-large" type="submit">{c.orders.assignment.submit} <Check size={15} /></button></form></Modal>}
    {dialog === 'delivery' && selected && <Modal title={c.orders.delivery.title(selected.id)} onClose={() => { setDialog(null); setDeliveryError(null) }}><form className="modal-form" onSubmit={completeDelivery}><p className="modal-required-note">{c.orders.delivery.note}</p><label>{c.orders.delivery.otp}<input name="otp" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} placeholder={c.orders.delivery.otpPlaceholder} /></label><label>{c.orders.delivery.proof}<input name="proof" type="file" accept="image/*" /></label>{deliveryError && <p role="alert">{deliveryError}</p>}<button className="button button-primary button-large" type="submit" disabled={deliveryVerification.isPending}><ShieldCheck size={15} /> {c.orders.delivery.submit}</button></form></Modal>}
  </section>
}
