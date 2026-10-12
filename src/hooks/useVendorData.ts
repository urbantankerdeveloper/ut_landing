import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '../api/client'
import { vendorApi, type VendorOrder, type VendorOrderMutation } from '../api/vendor'
import { demoDataEnabled } from '../constants/demo'
import { enqueueMutation, flushMutationQueue, queuedMutationCount } from '../services/offlineMutationQueue'
import { useRealtimeInvalidation } from './useRealtimeInvalidation'

export const vendorQueryKeys = { dashboard: ['vendor', 'dashboard'], orders: ['vendor', 'orders'], vehicles: ['vendor', 'vehicles'], drivers: ['vendor', 'drivers'], payouts: ['vendor', 'payouts'], services: ['vendor', 'services'] } as const
const liveOptions = { enabled: !demoDataEnabled, staleTime: 30_000, retry: 2 }
export function useVendorDashboard() { return useQuery({ queryKey: vendorQueryKeys.dashboard, queryFn: vendorApi.dashboard, ...liveOptions }) }
export function useVendorOrders() { const query = useQuery({ queryKey: vendorQueryKeys.orders, queryFn: vendorApi.orders, ...liveOptions }); useRealtimeInvalidation(vendorQueryKeys.orders); return query }
export function useVendorVehicles() { return useQuery({ queryKey: vendorQueryKeys.vehicles, queryFn: vendorApi.vehicles, ...liveOptions }) }
export function useVendorDrivers() { return useQuery({ queryKey: vendorQueryKeys.drivers, queryFn: vendorApi.drivers, ...liveOptions }) }
export function useVendorLocation(bookingId: string | null) { const mutation = useMutation({ mutationFn: vendorApi.location }); useEffect(() => { if (!bookingId || demoDataEnabled || !navigator.geolocation) return; const watchId = navigator.geolocation.watchPosition((position) => { mutation.mutate({ bookingId, latitude: position.coords.latitude, longitude: position.coords.longitude, accuracy: position.coords.accuracy }) }, undefined, { enableHighAccuracy: true, maximumAge: 15_000, timeout: 10_000 }); return () => navigator.geolocation.clearWatch(watchId) }, [bookingId, mutation]); return mutation }
export function useVendorOrderMutation() {
  const queryClient = useQueryClient()
  const [queuedCount, setQueuedCount] = useState(() => queuedMutationCount())
  useEffect(() => {
    const flush = async () => { const count = await flushMutationQueue((endpoint, init) => apiFetch(endpoint, init)); if (count) { setQueuedCount(queuedMutationCount()); queryClient.invalidateQueries({ queryKey: vendorQueryKeys.orders }) } }
    window.addEventListener('online', flush)
    void flush()
    return () => window.removeEventListener('online', flush)
  }, [queryClient])
  const mutation = useMutation({ mutationFn: (payload: VendorOrderMutation) => vendorApi.mutateOrder(payload), onMutate: async (payload) => { await queryClient.cancelQueries({ queryKey: vendorQueryKeys.orders }); const previous = queryClient.getQueryData(vendorQueryKeys.orders); queryClient.setQueryData(vendorQueryKeys.orders, (orders: VendorOrder[] | undefined) => orders?.map((order) => order.id === payload.orderId ? { ...order, ...payload } : order)); return { previous } }, onError: (_error, _payload, context) => { queryClient.setQueryData(vendorQueryKeys.orders, context?.previous) }, onSettled: () => queryClient.invalidateQueries({ queryKey: vendorQueryKeys.orders }) })
  function mutate(payload: VendorOrderMutation) {
    if (!navigator.onLine) { enqueueMutation({ endpoint: `/vendor/orders/${payload.orderId}`, init: { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) } }); setQueuedCount(queuedMutationCount()); return }
    mutation.mutate(payload)
  }
  return { ...mutation, mutate, queuedCount }
}
