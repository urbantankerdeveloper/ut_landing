import { useState } from 'react'
import { CheckCircle2, Truck, Users } from 'lucide-react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { adminApi } from '../api/admin'
import { adminQueryKeys, useAdminOrders, useAdminVendors } from '../hooks/useAdminData'

export function AdminDispatchLiveView({ onNotice }: { onNotice: (message: string) => void }) {
  const orders = useAdminOrders()
  const vendors = useAdminVendors()
  const queryClient = useQueryClient()
  const assign = useMutation({ mutationFn: ({ id, vendorId }: { id: string; vendorId: string }) => adminApi.assignOrder(id, { vendorId }), onSuccess: () => { queryClient.invalidateQueries({ queryKey: adminQueryKeys.orders }); onNotice('Dispatch assignment saved.') } })
  const [orderId, setOrderId] = useState('')
  const [vendorId, setVendorId] = useState('')
  if (orders.isLoading || vendors.isLoading) return <section className="admin-view-panel"><h2>Loading dispatch data...</h2></section>
  if (orders.isError || vendors.isError) return <section className="admin-view-panel"><h2>Dispatch data is unavailable.</h2><button className="button button-primary" onClick={() => { void orders.refetch(); void vendors.refetch() }}>Retry</button></section>
  const openOrders = (orders.data ?? []).filter((order) => !['delivered', 'cancelled'].includes(order.status))
  return <section className="admin-view-panel"><div className="view-panel-heading"><div><p className="eyebrow">LIVE OPERATIONS</p><h2>Dispatch from current database records.</h2></div><span className="status-tag pending">{openOrders.length} open</span></div><div className="admin-card-grid"><article className="admin-card"><Truck size={18} /><b>{openOrders.length}</b><p>Open deliveries</p></article><article className="admin-card"><Users size={18} /><b>{vendors.data?.length ?? 0}</b><p>Registered vendors</p></article></div><form className="modal-form" onSubmit={(event) => { event.preventDefault(); if (!orderId || !vendorId) return; assign.mutate({ id: orderId, vendorId }) }}><label>Order<select value={orderId} onChange={(event) => setOrderId(event.target.value)} required><option value="" disabled>Select order</option>{openOrders.map((order) => <option key={order.id} value={order.id}>{order.id} · {order.service}</option>)}</select></label><label>Vendor<select value={vendorId} onChange={(event) => setVendorId(event.target.value)} required><option value="" disabled>Select vendor</option>{(vendors.data ?? []).map((vendor) => <option key={vendor.id} value={vendor.id}>{vendor.name} · {vendor.status}</option>)}</select></label><button className="button button-primary button-large" disabled={assign.isPending} type="submit">{assign.isPending ? 'Assigning...' : 'Save assignment'} <CheckCircle2 size={15} /></button></form></section>
}