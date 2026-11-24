import { cachedCatalog, invalidateCatalog } from './catalogCache.js'
import { supabase } from '../supabase.js'

export type AuthProfile = { id: string; role: string; full_name: string }

export async function getCachedAuthProfile(userId: string): Promise<AuthProfile | null> {
  return cachedCatalog<AuthProfile | null>(
    `auth-profile:${userId}`,
    async () => {
      const { data } = await supabase
        .from('profiles')
        .select('id,role,full_name')
        .eq('id', userId)
        .maybeSingle()
      return data as AuthProfile | null
    },
    60_000,
  )
}

export async function getCachedVendorId(userId: string): Promise<string | null> {
  return cachedCatalog<string | null>(
    `auth-vendor:${userId}`,
    async () => {
      const { data } = await supabase
        .from('vendors')
        .select('id')
        .eq('owner_profile_id', userId)
        .maybeSingle()
      return data?.id ?? null
    },
    60_000,
  )
}

export async function invalidateAuthProfile(userId: string) {
  await invalidateCatalog(`auth-profile:${userId}`)
}

export async function invalidateAuthVendor(userId: string) {
  await invalidateCatalog(`auth-vendor:${userId}`)
}
