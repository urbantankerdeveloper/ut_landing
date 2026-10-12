import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { adminApi, type AdminReportRequest } from '../api/admin'
import { demoDataEnabled } from '../constants/demo'
import { useRealtimeInvalidation } from './useRealtimeInvalidation'

export const adminQueryKeys = { orders: ['admin', 'orders'], vendors: ['admin', 'vendors'], coupons: ['admin', 'coupons'], auditLogs: ['admin', 'audit-logs'], flags: ['admin', 'feature-flags'] } as const
const liveOptions = { enabled: !demoDataEnabled, staleTime: 30_000, retry: 2 }
export function useAdminOrders() { const query = useQuery({ queryKey: adminQueryKeys.orders, queryFn: adminApi.orders, ...liveOptions }); useRealtimeInvalidation(adminQueryKeys.orders); return query }
export function useAdminVendors() { return useQuery({ queryKey: adminQueryKeys.vendors, queryFn: adminApi.vendors, ...liveOptions }) }
export function useAdminCoupons() { return useQuery({ queryKey: adminQueryKeys.coupons, queryFn: adminApi.coupons, ...liveOptions }) }
export function useAdminAuditLogs() { return useQuery({ queryKey: adminQueryKeys.auditLogs, queryFn: adminApi.auditLogs, ...liveOptions }) }
export function useAdminFeatureFlags() { return useQuery({ queryKey: adminQueryKeys.flags, queryFn: adminApi.featureFlags, ...liveOptions }) }
export function useGenerateAdminReport() { return useMutation({ mutationFn: (payload: AdminReportRequest) => adminApi.report(payload) }) }
export function useAdminCouponMutations() { const queryClient = useQueryClient(); const save = useMutation({ mutationFn: ({ payload, id }: { payload: Parameters<typeof adminApi.saveCoupon>[0]; id?: string }) => adminApi.saveCoupon(payload, id), onSuccess: () => queryClient.invalidateQueries({ queryKey: adminQueryKeys.coupons }) }); const remove = useMutation({ mutationFn: (id: string) => adminApi.deleteCoupon(id), onSuccess: () => queryClient.invalidateQueries({ queryKey: adminQueryKeys.coupons }) }); return { save, remove } }
