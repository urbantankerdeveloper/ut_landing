import { create } from 'zustand'

export type ToastTone = 'success' | 'error' | 'info'
export type Toast = { id: number; tone: ToastTone; message: string }

type ToastState = {
  toasts: Toast[]
  push: (tone: ToastTone, message: string) => void
  dismiss: (id: number) => void
}

const MAX_VISIBLE = 4
// The same message from several failing requests in a row shows once, not once per request.
const DUPLICATE_WINDOW_MS = 4_000
const DURATION_MS: Record<ToastTone, number> = { success: 4_000, info: 4_000, error: 6_000 }

let nextId = 1
const lastShownAt = new Map<string, number>()

export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],
  push: (tone, message) => {
    const now = Date.now()
    const key = `${tone}:${message}`
    const previous = lastShownAt.get(key)
    if (previous !== undefined && now - previous < DUPLICATE_WINDOW_MS) return
    lastShownAt.set(key, now)

    const id = nextId++
    set((state) => ({ toasts: [...state.toasts, { id, tone, message }].slice(-MAX_VISIBLE) }))
    window.setTimeout(() => get().dismiss(id), DURATION_MS[tone])
  },
  dismiss: (id) => set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) })),
}))
