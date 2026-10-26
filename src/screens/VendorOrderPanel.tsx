import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Check, ClipboardList, MapPin, ShieldCheck, Truck, UserRound } from 'lucide-react'
import { demoDataEnabled } from '../constants/demo'
import { Modal } from './WorkspaceInteractive'
import { useVendorDeliveryVerification, useVendorDrivers, useVendorLocation, useVendorOrderMutation, useVendorOrders, useVendorVehicles } from '../hooks/useVendorData'
import { useFileUpload } from '../hooks/useFrontendFeatures'

type OrderStatus = 'Available' | 'Assigned' | 'Accepted' | 'En route' | 'Arrived' | 'Delivered' | 'Rejected'
type VendorOrder = { id: string; reference?: string; service: string; serviceDetails?: { service: string; capacity?: string; waterType?: string; tankerCount?: string; details?: string; deliveryDate?: string; location?: string }[]; location: string; distance?: number; amount: string; status: OrderStatus; vehicle?: string; driver?: string }
type Props = { onNotice: (message: string) => void }
const demoOrders: VendorOrder[] = demoDataEnabled ? [{ id: 'UT-2412', service: 'Water tanker · 12 KL', location: 'OMR, Chennai', distance: 5.2, amount: '₹2,250', status: 'Available' }, { id: 'UT-2411', service: 'Sewage tanker · 9 KL', location: 'Guindy, Chennai', distance: 11.4, amount: '₹2,900', status: 'Accepted', vehicle: 'TN 38 AB 4120', driver: 'Arun Kumar' }, { id: 'UT-2409', service: 'Water tanker · 6 KL', location: 'Sholinganallur, Chennai', distance: 18.7, amount: '₹1,500', status: 'En route', vehicle: 'TN 09 CD 1811', driver: 'Meena S' }] : []
const demoVehicles = [{ id: 'demo-vehicle-1', label: 'TN 38 AB 4120 · 12 KL' }, { id: 'demo-vehicle-2', label: 'TN 09 CD 1811 · 9 KL' }]
const demoDrivers = [{ id: 'demo-driver-1', label: 'Arun Kumar' }, { id: 'demo-driver-2', label: 'Meena S' }]
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
  const [offline, setOffline] = useState(!navigator.onLine)
  const activeTrackingOrderId = orders.find((order) => order.status === 'En route')?.id ?? null
  useVendorLocation(activeTrackingOrderId)
  const filtered = useMemo(() => orders.filter((order) => (order.distance === undefined || order.distance <= Number(radius)) && order.status !== 'Rejected'), [orders, radius])
  const vehicleRecords = demoDataEnabled ? demoVehicles : (vehiclesQuery.data ?? []).filter((vehicle) => vehicle.is_active && vehicle.verification === 'approved').map((vehicle) => ({ id: vehicle.id, label: `${vehicle.registration_number} · ${Math.round((vehicle.capacity_litres ?? 0) / 1000)} KL` }))
  const driverRecords = demoDataEnabled ? demoDrivers : (driversQuery.data ?? []).filter((driver) => driver.is_active && driver.verification === 'approved').map((driver) => ({ id: driver.id, label: driver.name }))
  const vehicles = vehicleRecords.map((vehicle) => vehicle.label)
  const drivers = driverRecords.map((driver) => driver.label)
  useEffect(() => {
    if (!ordersQuery.data) return
    const sync = window.setTimeout(() => setOrders(ordersQuery.data as VendorOrder[]), 0)
    return () => window.clearTimeout(sync)
  }, [ordersQuery.data])
  function updateOrder(id: string, update: Partial<VendorOrder>) { setOrders((items) => items.map((order) => order.id === id ? { ...order, ...update } : order)) }
  function mutateOrder(order: VendorOrder, update: Partial<VendorOrder>, payload: Parameters<typeof orderMutation.mutate>[0], success: string) { updateOrder(order.id, update); orderMutation.mutate(payload, { onSuccess: () => onNotice(success), onError: () => { updateOrder(order.id, order); onNotice(`${order.id} could not be updated.`) } }) }
  function accept(order: VendorOrder) { mutateOrder(order, { status: 'Accepted' }, { orderId: order.id, action: 'accept', status: 'Accepted' }, `${order.id} accepted.`) }
  function reject(order: VendorOrder) { const reason = window.prompt(`Reason for rejecting ${order.reference ?? order.id}`)?.trim(); if (!reason) return; mutateOrder(order, { status: 'Rejected' }, { orderId: order.id, action: 'reject', status: 'Rejected', reason }, `${order.id} rejected.`) }
  function advance(order: VendorOrder) { const status = nextStatus[order.status]; if (status) mutateOrder(order, { status }, { orderId: order.id, action: 'status', status }, `${order.id} marked ${status}.`) }
  function assign(event: FormEvent<HTMLFormElement>) { event.preventDefault(); if (!selected) return; const values = new FormData(event.currentTarget); const vehicle = String(values.get('vehicle')); const driver = String(values.get('driver')); const vehicleId = vehicleRecords.find((item) => item.label === vehicle)?.id; const driverId = driverRecords.find((item) => item.label === driver)?.id; if (!vehicleId || !driverId || !vehicle || !driver) return; const previous = selected; updateOrder(selected.id, { status: 'Assigned', vehicle, driver }); orderMutation.mutate({ orderId: selected.id, action: 'assign', vehicleId, driverId }, { onSuccess: () => { setDialog(null); onNotice(`${selected.id} assigned to vehicle and driver.`) }, onError: () => { updateOrder(selected.id, previous); onNotice(`${selected.id} assignment could not be saved.`) } }) }
  async function completeDelivery(event: FormEvent<HTMLFormElement>) { event.preventDefault(); if (!selected) return; const values = new FormData(event.currentTarget); const otp = String(values.get('otp') || ''); const file = values.get('proof'); if (!otp || !(file instanceof File) || !file.size) return; try { const signed = await proofUpload.upload(file, 'booking', selected.id); await deliveryVerification.mutateAsync({ id: selected.id, otp, proofPath: signed.path }); updateOrder(selected.id, { status: 'Delivered' }); setDialog(null); onNotice(`${selected.id} delivery verified and completed.`) } catch { onNotice('Delivery verification or proof upload failed.') } }
  function toggleOffline() { setOffline((value) => !value); onNotice(!offline ? 'Offline draft mode enabled. Changes will sync when connected.' : 'Connection restored. Drafts are syncing.') }
  if (!demoDataEnabled && (ordersQuery.isLoading || vehiclesQuery.isLoading || driversQuery.isLoading)) return <section className="workspace-view-panel vendor-order-panel"><p className="eyebrow">ORDER INBOX</p><h2>Loading nearby orders…</h2></section>
  if (!demoDataEnabled && (ordersQuery.isError || vehiclesQuery.isError || driversQuery.isError)) return <section className="workspace-view-panel vendor-order-panel"><p className="eyebrow">ORDER INBOX</p><h2>Orders are unavailable.</h2><p>We could not load the Vendor order queue.</p><button className="button button-primary" onClick={() => { void ordersQuery.refetch(); void vehiclesQuery.refetch(); void driversQuery.refetch() }}>Retry</button></section>
  return <section className="workspace-view-panel vendor-order-panel">
    <div className="view-panel-heading"><div><p className="eyebrow">ORDER INBOX</p><h2>Nearby delivery requests.</h2></div><div className="vendor-order-tools"><span className={offline ? 'offline-pill' : 'online-pill'}><i /> {offline ? 'Offline drafts' : 'Online'}</span><button className="button button-quiet" onClick={toggleOffline}>{offline ? 'Reconnect' : 'Save offline draft'}</button></div></div>
    <div className="vendor-order-filter"><label>Search radius<select value={radius} onChange={(event) => setRadius(event.target.value)}><option value="10">Within 10 km</option><option value="25">Within 25 km</option><option value="50">Within 50 km</option></select></label><span>{filtered.length} requests available</span></div>
    <div className="vendor-order-list">{filtered.map((order) => <article key={order.id}>
      <span className="vendor-order-icon"><ClipboardList size={18} /></span>
      <div className="vendor-order-copy">
        <b>{order.reference ?? order.id} · {order.service}</b>
        <p><MapPin size={12} /> {order.location} · {order.distance === undefined ? 'Distance unavailable' : `${order.distance} km away`} · {order.amount}</p>
        {order.serviceDetails?.map((item) => <small key={item.service}>{item.service}{item.capacity ? ` · ${item.capacity}` : ''}{item.waterType ? ` · ${item.waterType}` : ''}{item.tankerCount ? ` · ${item.tankerCount} tanker${item.tankerCount === '1' ? '' : 's'}` : ''}{item.deliveryDate ? ` · ${item.deliveryDate}` : ''}{item.location ? ` · ${item.location}` : ''}{item.details ? ` — ${item.details}` : ''}</small>)}
        {order.vehicle && <small><Truck size={12} /> {order.vehicle} · <UserRound size={12} /> {order.driver}</small>}
      </div>
      <span className={`status-tag ${order.status === 'Available' ? 'pending' : order.status === 'Delivered' ? '' : 'inactive'}`}>{order.status}</span>
      <div className="vendor-order-actions">
        {order.status === 'Available' && <><button className="button button-primary" onClick={() => { setSelected(order); setDialog('assignment') }}>Assign fleet</button><button className="button button-quiet" onClick={() => reject(order)}>Reject</button></>}
        {order.status === 'Assigned' && <button className="button button-primary" onClick={() => accept(order)}>Accept and notify customer</button>}
        {order.status === 'Accepted' && <button className="button button-primary" onClick={() => advance(order)}>Start delivery</button>}
        {order.status === 'En route' && <button className="button button-primary" onClick={() => advance(order)}>Mark arrived</button>}
        {order.status === 'Arrived' && <button className="button button-primary" onClick={() => { setSelected(order); setDialog('delivery') }}>Verify delivery</button>}
      </div>
    </article>)}{!filtered.length && <div className="admin-empty-state">No nearby orders are available for this radius.</div>}</div>
    {dialog === 'assignment' && selected && <Modal title={`Assign ${selected.id}`} onClose={() => setDialog(null)}><form className="modal-form" onSubmit={assign}><label>Vehicle<select name="vehicle" required defaultValue={selected.vehicle || ''}><option value="" disabled>Select vehicle</option>{vehicles.map((vehicle) => <option key={vehicle}>{vehicle}</option>)}</select></label><label>Driver<select name="driver" required defaultValue={selected.driver || ''}><option value="" disabled>Select driver</option>{drivers.map((driver) => <option key={driver}>{driver}</option>)}</select></label><button className="button button-primary button-large" type="submit">Save assignment <Check size={15} /></button></form></Modal>}
    {dialog === 'delivery' && selected && <Modal title={`Verify ${selected.id}`} onClose={() => setDialog(null)}><form className="modal-form" onSubmit={completeDelivery}><p className="modal-required-note">Confirm the customer OTP and attach delivery proof.</p><label>Delivery OTP<input name="otp" required inputMode="numeric" pattern="[0-9]{4,6}" maxLength={6} placeholder="Enter OTP" /></label><label>Delivery proof<input name="proof" required type="file" accept="image/*" /></label><button className="button button-primary button-large" type="submit"><ShieldCheck size={15} /> Verify and complete</button></form></Modal>}
  </section>
}
