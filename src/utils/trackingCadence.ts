export const PUBLIC_TRACKING_POLL_INTERVAL_MS = 30_000

export function authenticatedTrackingRefetchInterval(realtimeConnected: boolean): number | false {
  return realtimeConnected ? false : 30_000
}
