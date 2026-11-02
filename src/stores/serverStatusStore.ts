import { create } from 'zustand'

type ServerStatusState = { slowRequests: number; markSlow: () => void; markSettled: () => void }

// Counts requests that passed the wake-up threshold, so the notice stays up until every slow request has settled.
export const useServerStatusStore = create<ServerStatusState>((set) => ({
  slowRequests: 0,
  markSlow: () => set((state) => ({ slowRequests: state.slowRequests + 1 })),
  markSettled: () => set((state) => ({ slowRequests: Math.max(0, state.slowRequests - 1) })),
}))
