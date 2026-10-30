import { useEffect, useRef } from 'react'
import { useQueryClient, type QueryKey } from '@tanstack/react-query'
import { subscribeToRealtime } from '../services/realtime'

const realtimeUrl = import.meta.env.VITE_REALTIME_URL ?? (import.meta.env.PROD ? window.location.origin : 'http://localhost:8080')

const eventQueryPrefixes: Record<string, string[][]> = {
  'booking.created': [['customer', 'bookings'], ['admin', 'orders']],
  'booking.updated': [['customer', 'bookings'], ['vendor', 'orders'], ['admin', 'orders']],
  'booking.delivered': [['customer', 'bookings'], ['vendor', 'orders'], ['admin', 'orders']],
  'booking.rejected': [['customer', 'bookings'], ['vendor', 'orders'], ['admin', 'orders']],
  'booking.vendor_accepted': [['customer', 'bookings'], ['vendor', 'orders'], ['admin', 'orders']],
  'booking.location.updated': [['customer', 'tracking'], ['vendor', 'orders']],
  'vendor.order.created': [['vendor', 'orders'], ['vendor', 'notifications'], ['admin', 'orders']],
  'vendor.order.taken': [['vendor', 'orders'], ['vendor', 'notifications'], ['customer', 'bookings'], ['admin', 'orders']],
  'vendor.order.declined': [['vendor', 'orders'], ['vendor', 'notifications'], ['admin', 'orders']],
  'notification.created': [['customer', 'notifications'], ['vendor', 'notifications'], ['admin', 'notifications']],
  'vendor.updated': [['admin', 'vendors'], ['vendor', 'dashboard']],
  'payment.authorized': [['customer', 'bookings'], ['admin', 'payments']],
  'payment.captured': [['customer', 'bookings'], ['admin', 'payments']],
  'payment.failed': [['customer', 'bookings'], ['admin', 'payments']],
}

function queryMatchesEvent(queryKey: QueryKey, eventType: string) {
  const prefix = queryKey.map(String)
  return (eventQueryPrefixes[eventType] ?? []).some((candidate) => candidate.length <= prefix.length && candidate.every((part, index) => prefix[index] === part))
}

export function useRealtimeInvalidation(queryKey: QueryKey, onMessage?: (message: { type: string; payload: unknown }) => void) {
  const queryClient = useQueryClient()
  const queryKeyRef = useRef(queryKey)
  const onMessageRef = useRef(onMessage)
  const queryKeyIdentity = JSON.stringify(queryKey)
  useEffect(() => {
    queryKeyRef.current = queryKey
    onMessageRef.current = onMessage
  }, [queryKey, onMessage])
  useEffect(() => subscribeToRealtime(realtimeUrl, (message) => {
    if (queryMatchesEvent(queryKeyRef.current, message.type)) void queryClient.invalidateQueries({ queryKey: queryKeyRef.current })
    onMessageRef.current?.(message)
  }), [queryClient, queryKeyIdentity])
}
