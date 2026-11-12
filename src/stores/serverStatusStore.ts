import { create } from 'zustand'

type ServerStatusState = { slowRequests: number; noticeVisible: boolean; hasShownNotice: boolean; markSlow: () => void; markSettled: () => void }

// Counts slow requests and shows the wake-up notice only once per page load.
export const useServerStatusStore = create<ServerStatusState>((set) => ({
  slowRequests: 0,
  noticeVisible: false,
  hasShownNotice: false,
  markSlow: () => set((state) => ({
    slowRequests: state.slowRequests + 1,
    noticeVisible: state.noticeVisible || !state.hasShownNotice,
    hasShownNotice: true,
  })),
  markSettled: () => set((state) => {
    const slowRequests = Math.max(0, state.slowRequests - 1)
    return { slowRequests, noticeVisible: slowRequests > 0 && state.noticeVisible }
  }),
}))
