import { useState } from 'react'
import { CheckCircle2, Truck, Users } from 'lucide-react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { adminApi } from '../api/admin'
import { adminQueryKeys, useAdminDrivers, useAdminOrders, useAdminVehicles, useAdminVendors } from '../hooks/useAdminData'
import { adminOperationsContent as c } from '../content/admin-operations'

export function AdminDispatchLiveView({ onNotice }: { onNotice: (message: string) => void }) {
  const orders = useAdminOrders()
  const vendors = useAdminVendors()
  const vehicles = useAdminVehicles()
  const drivers = useAdminDrivers()
  const queryClient = useQueryClient()
  const assign = useMutation({
    mutationFn: ({ id, vendorId, vehicleId, driverId }: { id: string; vendorId: string; vehicleId?: string; driverId?: string }) => adminApi.assignOrder(id, { vendorId, vehicleId, driverId }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: adminQueryKeys.orders }); onNotice(c.dispatch.notices.saved) },
    onError: () => onNotice(c.dispatch.notices.saveFailed),
  })
  const [orderId, setOrderId] = useState('')
  const [vendorId, setVendorId] = useState('')
  const [vehicleId, setVehicleId] = useState('')
  const [driverId, setDriverId] = useState('')
  if (orders.isLoading || vendors.isLoading || vehicles.isLoading || drivers.isLoading) return <section className="admin-view-panel" role="status"><h2>{c.dispatch.loading}</h2></section>
  if (orders.isError || vendors.isError || vehicles.isError || drivers.isError) return <section className="admin-view-panel" role="alert"><h2>{c.dispatch.unavailable}</h2><button className="button button-primary" onClick={() => { void orders.refetch(); void vendors.refetch(); void vehicles.refetch(); void drivers.refetch() }}>{c.common.retry}</button></section>
  const openOrders = (orders.data ?? []).filter((order) => !['delivered', 'cancelled'].includes(order.status))
  return <section className="admin-view-panel"><div className="view-panel-heading"><div><p className="eyebrow">{c.dispatch.eyebrow}</p><h2>{c.dispatch.title}</h2></div><span className="status-tag pending">{c.dispatch.open(openOrders.length)}</span></div><div className="admin-card-grid"><article className="admin-card"><Truck size={18} /><b>{openOrders.length}</b><p>{c.dispatch.openDeliveries}</p></article><article className="admin-card"><Users size={18} /><b>{vendors.data?.length ?? 0}</b><p>{c.dispatch.registeredVendors}</p></article></div><form className="modal-form" onSubmit={(event) => { event.preventDefault(); if (!orderId || !vendorId) return; assign.mutate({ id: orderId, vendorId, vehicleId: vehicleId || undefined, driverId: driverId || undefined }) }}><label>{c.dispatch.order}<select value={orderId} onChange={(event) => setOrderId(event.target.value)} required><option value="" disabled>{c.dispatch.selectOrder}</option>{openOrders.map((order) => <option key={order.id} value={order.id}>{order.id}{c.common.separator}{order.service}</option>)}</select></label><label>{c.dispatch.vendor}<select value={vendorId} onChange={(event) => setVendorId(event.target.value)} required><option value="" disabled>{c.dispatch.selectVendor}</option>{(vendors.data ?? []).map((vendor) => <option key={vendor.id} value={vendor.id}>{vendor.name}{c.common.separator}{vendor.status}</option>)}</select></label><label>{c.dispatch.vehicle}<select value={vehicleId} onChange={(event) => setVehicleId(event.target.value)}><option value="">{c.dispatch.keepVehicle}</option>{(vehicles.data ?? []).map((vehicle) => <option key={vehicle.id} value={vehicle.id}>{vehicle.name ?? vehicle.id}{c.common.separator}{vehicle.status ?? c.dispatch.availableStatus}</option>)}</select></label><label>{c.dispatch.driver}<select value={driverId} onChange={(event) => setDriverId(event.target.value)}><option value="">{c.dispatch.keepDriver}</option>{(drivers.data ?? []).map((driver) => <option key={driver.id} value={driver.id}>{driver.name ?? driver.id}{c.common.separator}{driver.status ?? c.dispatch.availableStatus}</option>)}</select></label><button className="button button-primary button-large" disabled={assign.isPending} type="submit">{assign.isPending ? c.dispatch.assigning : c.dispatch.save} <CheckCircle2 size={15} /></button></form>{!openOrders.length && <div className="admin-empty-state">{c.dispatch.noOpenOrders}</div>}</section>
}
