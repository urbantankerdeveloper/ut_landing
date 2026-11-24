export const PUBLIC_TRACKING_POLL_INTERVAL_MS = 30_000

export function authenticatedTrackingRefetchInterval(realtimeConnected: boolean): number | false {
  if (realtimeConnected) return false
  return import.meta.env.VITE_SOCKET_DRIVEN_REFRESH === 'true' ? 120_000 : 30_000
}
