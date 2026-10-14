import { useState } from 'react'
import { CheckCircle2, Truck, Users } from 'lucide-react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { adminApi } from '../api/admin'
import { adminQueryKeys, useAdminDrivers, useAdminOrders, useAdminVehicles, useAdminVendors } from '../hooks/useAdminData'

export function AdminDispatchLiveView({ onNotice }: { onNotice: (message: string) => void }) {
  const orders = useAdminOrders()
  const vendors = useAdminVendors()
  const vehicles = useAdminVehicles()
  const drivers = useAdminDrivers()
  const queryClient = useQueryClient()
  const assign = useMutation({
    mutationFn: ({ id, vendorId, vehicleId, driverId }: { id: string; vendorId: string; vehicleId?: string; driverId?: string }) => adminApi.assignOrder(id, { vendorId, vehicleId, driverId }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: adminQueryKeys.orders }); onNotice('Dispatch assignment saved.') },
    onError: () => onNotice('Dispatch assignment could not be saved.'),
  })
  const [orderId, setOrderId] = useState('')
  const [vendorId, setVendorId] = useState('')
  const [vehicleId, setVehicleId] = useState('')
  const [driverId, setDriverId] = useState('')
  if (orders.isLoading || vendors.isLoading || vehicles.isLoading || drivers.isLoading) return <section className="admin-view-panel"><h2>Loading dispatch data...</h2></section>
  if (orders.isError || vendors.isError || vehicles.isError || drivers.isError) return <section className="admin-view-panel"><h2>Dispatch data is unavailable.</h2><button className="button button-primary" onClick={() => { void orders.refetch(); void vendors.refetch(); void vehicles.refetch(); void drivers.refetch() }}>Retry</button></section>
  const openOrders = (orders.data ?? []).filter((order) => !['delivered', 'cancelled'].includes(order.status))
  return <section className="admin-view-panel"><div className="view-panel-heading"><div><p className="eyebrow">LIVE OPERATIONS</p><h2>Dispatch from current database records.</h2></div><span className="status-tag pending">{openOrders.length} open</span></div><div className="admin-card-grid"><article className="admin-card"><Truck size={18} /><b>{openOrders.length}</b><p>Open deliveries</p></article><article className="admin-card"><Users size={18} /><b>{vendors.data?.length ?? 0}</b><p>Registered vendors</p></article></div><form className="modal-form" onSubmit={(event) => { event.preventDefault(); if (!orderId || !vendorId) return; assign.mutate({ id: orderId, vendorId, vehicleId: vehicleId || undefined, driverId: driverId || undefined }) }}><label>Order<select value={orderId} onChange={(event) => setOrderId(event.target.value)} required><option value="" disabled>Select order</option>{openOrders.map((order) => <option key={order.id} value={order.id}>{order.id} · {order.service}</option>)}</select></label><label>Vendor<select value={vendorId} onChange={(event) => setVendorId(event.target.value)} required><option value="" disabled>Select vendor</option>{(vendors.data ?? []).map((vendor) => <option key={vendor.id} value={vendor.id}>{vendor.name} · {vendor.status}</option>)}</select></label><label>Vehicle<select value={vehicleId} onChange={(event) => setVehicleId(event.target.value)}><option value="">Keep current vehicle</option>{(vehicles.data ?? []).map((vehicle) => <option key={vehicle.id} value={vehicle.id}>{vehicle.name ?? vehicle.id} · {vehicle.status ?? 'available'}</option>)}</select></label><label>Driver<select value={driverId} onChange={(event) => setDriverId(event.target.value)}><option value="">Keep current driver</option>{(drivers.data ?? []).map((driver) => <option key={driver.id} value={driver.id}>{driver.name ?? driver.id} · {driver.status ?? 'available'}</option>)}</select></label><button className="button button-primary button-large" disabled={assign.isPending} type="submit">{assign.isPending ? 'Assigning...' : 'Save assignment'} <CheckCircle2 size={15} /></button></form>{!openOrders.length && <div className="admin-empty-state">No open orders need dispatch.</div>}</section>
}