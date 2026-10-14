import { useQuery } from '@tanstack/react-query'
import { adminApi } from '../api/admin'
export function useAdminSystemHealth() { return useQuery({ queryKey: ['admin', 'system-health'], queryFn: adminApi.systemHealth, staleTime: 30_000, retry: 1 }) }