import { create } from 'zustand'

export type ToastTone = 'success' | 'error' | 'info'
export type ToastAction = { label: string; onSelect: () => void; variant?: 'primary' | 'quiet' }
export type ToastOptions = {
  // Lets code dismiss the toast later when the business fact it describes is resolved.
  key?: string
  // Sticky toasts stay until the user dismisses them or code dismisses them by key.
  sticky?: boolean
  actions?: ToastAction[]
}
export type Toast = { id: number; tone: ToastTone; message: string } & ToastOptions

type ToastState = {
  toasts: Toast[]
  push: (tone: ToastTone, message: string, options?: ToastOptions) => void
  dismiss: (id: number) => void
  dismissByKey: (key: string) => void
}

const MAX_VISIBLE = 4
// The same message from several failing requests in a row shows once, not once per request.
const DUPLICATE_WINDOW_MS = 4_000
const DURATION_MS: Record<ToastTone, number> = { success: 4_000, info: 4_000, error: 6_000 }

let nextId = 1
const lastShownAt = new Map<string, number>()

// Drops the oldest transient toast when over the limit. Sticky toasts are never evicted, so an open order offer is not lost to newer notices.
function capVisible(toasts: Toast[]): Toast[] {
  let result = toasts
  while (result.length > MAX_VISIBLE) {
    const index = result.findIndex((toast) => !toast.sticky)
    if (index === -1) break
    result = [...result.slice(0, index), ...result.slice(index + 1)]
  }
  return result
}

export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],
  push: (tone, message, options = {}) => {
    if (options.key && get().toasts.some((toast) => toast.key === options.key)) return
    const now = Date.now()
    const dedupeKey = `${tone}:${message}`
    const previous = lastShownAt.get(dedupeKey)
    if (previous !== undefined && now - previous < DUPLICATE_WINDOW_MS) return
    lastShownAt.set(dedupeKey, now)

    const id = nextId++
    set((state) => ({ toasts: capVisible([...state.toasts, { id, tone, message, ...options }]) }))
    if (!options.sticky) window.setTimeout(() => get().dismiss(id), DURATION_MS[tone])
  },
  dismiss: (id) => set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) })),
  dismissByKey: (key) => set((state) => ({ toasts: state.toasts.filter((toast) => toast.key !== key) })),
}))
