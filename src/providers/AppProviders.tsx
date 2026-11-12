import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useEffect, type PropsWithChildren } from 'react'
import { ApiError } from '../api/client'
import { ToastHost } from '../components/ToastHost'
import { subscribeToRealtime } from '../services/realtime'
import { useAuthStore } from '../stores/authStore'
import { useRealtimeNotificationStore } from '../stores/realtimeNotificationStore'
import { describeError, notifyError, notifyInfo, notifySuccess, wasReported } from '../utils/notify'
import { playNewOrderAlert } from '../utils/newOrderAlert'
import { getRealtimeNotice } from '../utils/realtimeNotifications'

// Network and timeout failures are retried inside apiFetch for GETs, so the query layer only retries server errors.
const retryTransientFailures = (failureCount: number, error: Error) => failureCount < 2 && error instanceof ApiError && error.status >= 500
const realtimeUrl = import.meta.env.VITE_REALTIME_URL ?? (import.meta.env.PROD ? window.location.origin : 'http://localhost:8080')

// apiFetch already toasts API and network failures. These handlers cover everything else, such as a thrown parse error or a bug in a query function.
function reportUnhandled(error: unknown) {
  if (!wasReported(error)) notifyError(describeError(error))
}

const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError: reportUnhandled }),
  mutationCache: new MutationCache({ onError: reportUnhandled }),
  defaultOptions: { queries: { staleTime: 60_000, gcTime: 15 * 60_000, retry: retryTransientFailures, refetchOnWindowFocus: false } },
})

function useGlobalErrorToasts() {
  useEffect(() => {
    const onError = (event: ErrorEvent) => notifyError(describeError(event.error))
    const onRejection = (event: PromiseRejectionEvent) => notifyError(describeError(event.reason))
    window.addEventListener('error', onError)
    window.addEventListener('unhandledrejection', onRejection)
    return () => {
      window.removeEventListener('error', onError)
      window.removeEventListener('unhandledrejection', onRejection)
    }
  }, [])
}

function useGlobalRealtimeNotices() {
  const accessToken = useAuthStore((state) => state.accessToken)
  const role = useAuthStore((state) => state.user?.role ?? null)
  const hasHydrated = useAuthStore((state) => state.hasHydrated)
  useEffect(() => {
    if (!hasHydrated || !accessToken || (role !== 'customer' && role !== 'vendor')) return
    return subscribeToRealtime(realtimeUrl, (message) => {
      const notice = getRealtimeNotice(role, message)
      if (!notice) return
      useRealtimeNotificationStore.getState().recordFact(notice.key)
      if (notice.tone === 'success') notifySuccess(notice.message)
      else notifyInfo(notice.message)
      if (notice.newOrder) playNewOrderAlert()
    })
  }, [accessToken, hasHydrated, role])
}

function ToastLayer() {
  useGlobalErrorToasts()
  useGlobalRealtimeNotices()
  return <ToastHost />
}

export function AppProviders({ children }: PropsWithChildren) {
  return <QueryClientProvider client={queryClient}>
    {children}
    <ToastLayer />
  </QueryClientProvider>
}
