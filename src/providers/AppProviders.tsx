import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { PropsWithChildren } from 'react'
import { ApiError } from '../api/client'

// Network and timeout failures are retried inside apiFetch for GETs, so the query layer only retries server errors.
const retryTransientFailures = (failureCount: number, error: Error) => failureCount < 2 && error instanceof ApiError && error.status >= 500
const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 60_000, gcTime: 15 * 60_000, retry: retryTransientFailures, refetchOnWindowFocus: false } } })
export function AppProviders({ children }: PropsWithChildren) { return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider> }
