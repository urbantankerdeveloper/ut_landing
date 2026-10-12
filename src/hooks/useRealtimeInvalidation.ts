import { useEffect } from 'react'
import { useQueryClient, type QueryKey } from '@tanstack/react-query'
import { VendorRealtimeClient } from '../services/realtime'

const realtimeUrl = import.meta.env.VITE_REALTIME_URL ?? 'http://localhost:8080'
export function useRealtimeInvalidation(queryKey: QueryKey) {
  const queryClient = useQueryClient()
  useEffect(() => { const client = new VendorRealtimeClient(realtimeUrl, () => { void queryClient.invalidateQueries({ queryKey }) }); client.connect(); return () => client.disconnect() }, [queryClient, queryKey])
}