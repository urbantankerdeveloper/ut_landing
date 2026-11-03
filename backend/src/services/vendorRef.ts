import type { Request } from 'express'
import { supabase } from '../supabase.js'

// The vendor for the signed-in user. Uses the cached auth context when it already has a vendor. Otherwise it asks the
// database, so a vendor created inside the cache window is seen at once and non-vendor accounts behave as before.
export async function vendorRefFor(request: Request): Promise<{ id: string } | null> {
  if (request.vendorId) return { id: request.vendorId }
  const { data } = await supabase.from('vendors').select('id').eq('owner_profile_id', request.authUser!.id).maybeSingle()
  return data ?? null
}
