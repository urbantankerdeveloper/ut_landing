import { useQuery } from '@tanstack/react-query'
import { configApi } from '../api/config'

export function useFeatureFlags() {
  return useQuery({
    queryKey: ['config', 'flags'],
    queryFn: configApi.featureFlags,
    staleTime: 60_000,
    retry: false,
  })
}
