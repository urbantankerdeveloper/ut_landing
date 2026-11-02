import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { PropsWithChildren } from 'react'
import { ApiError } from '../api/client'

const retryTransientFailures = (failureCount: number, error: Error) => failureCount < 2 && (!(error instanceof ApiError) || error.status >= 500)
const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 60_000, gcTime: 15 * 60_000, retry: retryTransientFailures, refetchOnWindowFocus: false } } })
export function AppProviders({ children }: PropsWithChildren) { return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider> }
