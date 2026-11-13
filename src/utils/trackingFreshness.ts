export function formatTrackingUpdatedAgo(timestamp: string | Date, now = Date.now()): string | null {
  const timestampMs = timestamp instanceof Date ? timestamp.getTime() : Date.parse(timestamp)
  if (!Number.isFinite(timestampMs)) return null

  const elapsedSeconds = Math.max(0, Math.floor((now - timestampMs) / 1000))
  if (elapsedSeconds < 5) return 'Updated just now'
  if (elapsedSeconds < 60) return `Updated ${elapsedSeconds}s ago`
  const elapsedMinutes = Math.floor(elapsedSeconds / 60)
  if (elapsedMinutes < 60) return `Updated ${elapsedMinutes}m ago`
  return `Updated ${Math.floor(elapsedMinutes / 60)}h ago`
}
