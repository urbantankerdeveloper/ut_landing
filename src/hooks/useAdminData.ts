import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { adminApi, type AdminReportRequest } from '../api/admin'
import { demoDataEnabled } from '../constants/demo'
import { useRealtimeInvalidation } from './useRealtimeInvalidation'

export const adminQueryKeys = { orders: ['admin', 'orders'], vendors: ['admin', 'vendors'], customers: ['admin', 'customers'], vehicles: ['admin', 'vehicles'], drivers: ['admin', 'drivers'], services: ['admin', 'services'], payments: ['admin', 'payments'], payouts: ['admin', 'payouts'], complaints: ['admin', 'complaints'], alerts: ['admin', 'alerts'], notifications: ['admin', 'notifications'], coupons: ['admin', 'coupons'], auditLogs: ['admin', 'audit-logs'], flags: ['admin', 'feature-flags'] } as const
const liveOptions = { enabled: !demoDataEnabled, staleTime: 30_000, retry: 2 }
export function useAdminOrders() { const query = useQuery({ queryKey: adminQueryKeys.orders, queryFn: adminApi.orders, ...liveOptions }); useRealtimeInvalidation(adminQueryKeys.orders); return query }
export const useAdminBookings = useAdminOrders
export function useAdminVendors() { return useQuery({ queryKey: adminQueryKeys.vendors, queryFn: adminApi.vendors, ...liveOptions }) }
export function useAdminCustomers() { return useQuery({ queryKey: adminQueryKeys.customers, queryFn: adminApi.customers, ...liveOptions }) }
export function useAdminVehicles() { return useQuery({ queryKey: adminQueryKeys.vehicles, queryFn: adminApi.vehicles, ...liveOptions }) }
export function useAdminDrivers() { return useQuery({ queryKey: adminQueryKeys.drivers, queryFn: adminApi.drivers, ...liveOptions }) }
export function useAdminServices() { return useQuery({ queryKey: adminQueryKeys.services, queryFn: adminApi.services, ...liveOptions }) }
export function useAdminSubscriptions() { return useQuery({ queryKey: ['admin', 'subscriptions'], queryFn: adminApi.subscriptions, ...liveOptions }) }
export function useAdminContracts() { return useQuery({ queryKey: ['admin', 'contracts'], queryFn: adminApi.contracts, ...liveOptions }) }
export function useAdminEnquiries() { return useQuery({ queryKey: ['admin', 'enquiries'], queryFn: adminApi.enquiries, ...liveOptions }) }
export function useAdminPayments() { const query = useQuery({ queryKey: adminQueryKeys.payments, queryFn: adminApi.payments, ...liveOptions }); useRealtimeInvalidation(adminQueryKeys.payments); return query }
export function useAdminPayouts() { const query = useQuery({ queryKey: adminQueryKeys.payouts, queryFn: adminApi.payouts, ...liveOptions }); useRealtimeInvalidation(adminQueryKeys.payouts); return query }
export function useAdminComplaints() { const query = useQuery({ queryKey: adminQueryKeys.complaints, queryFn: adminApi.complaints, ...liveOptions }); useRealtimeInvalidation(adminQueryKeys.complaints); return query }
export function useAdminAlerts() { const query = useQuery({ queryKey: adminQueryKeys.alerts, queryFn: adminApi.alerts, ...liveOptions }); useRealtimeInvalidation(adminQueryKeys.alerts); return query }
export function useAdminNotifications() { const query = useQuery({ queryKey: adminQueryKeys.notifications, queryFn: adminApi.notifications, ...liveOptions }); useRealtimeInvalidation(adminQueryKeys.notifications); return query }
export function useMarkAdminNotificationRead() { const queryClient = useQueryClient(); return useMutation({ mutationFn: adminApi.markNotificationRead, onSuccess: () => queryClient.invalidateQueries({ queryKey: adminQueryKeys.notifications }) }) }
export function useAdminCoupons() { return useQuery({ queryKey: adminQueryKeys.coupons, queryFn: adminApi.coupons, ...liveOptions }) }
export function useAdminAuditLogs() { return useQuery({ queryKey: adminQueryKeys.auditLogs, queryFn: adminApi.auditLogs, ...liveOptions }) }
export function useAdminFeatureFlags() { return useQuery({ queryKey: adminQueryKeys.flags, queryFn: adminApi.featureFlags, ...liveOptions }) }
export function useGenerateAdminReport() { return useMutation({ mutationFn: (payload: AdminReportRequest) => adminApi.report(payload) }) }
export function useAdminOrderMutations() { const queryClient = useQueryClient(); const updateStatus = useMutation({ mutationFn: ({ id, status }: { id: string; status: string }) => adminApi.updateOrderStatus(id, status), onSuccess: () => queryClient.invalidateQueries({ queryKey: adminQueryKeys.orders }) }); const cancel = useMutation({ mutationFn: ({ id, reason }: { id: string; reason: string }) => adminApi.cancelOrder(id, reason), onSuccess: () => queryClient.invalidateQueries({ queryKey: adminQueryKeys.orders }) }); return { updateStatus, cancel } }
export function useAdminCouponMutations() { const queryClient = useQueryClient(); const save = useMutation({ mutationFn: ({ payload, id }: { payload: Parameters<typeof adminApi.saveCoupon>[0]; id?: string }) => adminApi.saveCoupon(payload, id), onSuccess: () => queryClient.invalidateQueries({ queryKey: adminQueryKeys.coupons }) }); const remove = useMutation({ mutationFn: (id: string) => adminApi.deleteCoupon(id), onSuccess: () => queryClient.invalidateQueries({ queryKey: adminQueryKeys.coupons }) }); return { save, remove } }
