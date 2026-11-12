import { create } from 'zustand'

// The server can send two events for the same business fact (for example booking.vendor_accepted and booking.updated).
// A fact recorded within this window is not counted again.
const DEDUPE_WINDOW_MS = 10_000

type RealtimeNotificationState = {
  unread: number
  recordFact: (key: string) => void
  clear: () => void
}

const recordedAt = new Map<string, number>()

function pruneExpired(now: number) {
  recordedAt.forEach((time, key) => {
    if (now - time >= DEDUPE_WINDOW_MS) recordedAt.delete(key)
  })
}

export const useRealtimeNotificationStore = create<RealtimeNotificationState>((set) => ({
  unread: 0,
  recordFact: (key) => {
    const now = Date.now()
    pruneExpired(now)
    if (recordedAt.has(key)) return
    recordedAt.set(key, now)
    set((state) => ({ unread: state.unread + 1 }))
  },
  clear: () => set({ unread: 0 }),
}))
