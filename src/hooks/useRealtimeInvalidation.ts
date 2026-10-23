import { useEffect } from 'react'
import { useQueryClient, type QueryKey } from '@tanstack/react-query'
import { VendorRealtimeClient } from '../services/realtime'

const realtimeUrl = import.meta.env.VITE_REALTIME_URL ?? (import.meta.env.PROD ? window.location.origin : 'http://localhost:8080')
export function useRealtimeInvalidation(queryKey: QueryKey, onMessage?: (message: { type: string; payload: unknown }) => void) {
  const queryClient = useQueryClient()
  useEffect(() => { const client = new VendorRealtimeClient(realtimeUrl, (message) => { void queryClient.invalidateQueries({ queryKey }); onMessage?.(message) }); client.connect(); return () => client.disconnect() }, [queryClient, queryKey, onMessage])
}