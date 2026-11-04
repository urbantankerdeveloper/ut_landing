import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useEffect, type PropsWithChildren } from 'react'
import { ApiError } from '../api/client'
import { ToastHost } from '../components/ToastHost'
import { describeError, notifyError, wasReported } from '../utils/notify'

// Network and timeout failures are retried inside apiFetch for GETs, so the query layer only retries server errors.
const retryTransientFailures = (failureCount: number, error: Error) => failureCount < 2 && error instanceof ApiError && error.status >= 500

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

function ToastLayer() {
  useGlobalErrorToasts()
  return <ToastHost />
}

export function AppProviders({ children }: PropsWithChildren) {
  return <QueryClientProvider client={queryClient}>
    {children}
    <ToastLayer />
  </QueryClientProvider>
}
