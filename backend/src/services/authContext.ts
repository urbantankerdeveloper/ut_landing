import { supabase } from '../supabase.js'
import { config } from '../config.js'
import { getRedisPair } from './scaling.js'

// Profile and vendor id for an authenticated user, loaded with one query (the vendors embed uses the owner_profile_id foreign key).
// Cached for 30 s per process, or in Redis when it is configured. Off unless AUTH_CONTEXT_CACHE is true.
export type AuthContext = { id: string; role: string; fullName: string | null; vendorId: string | null }

const TTL_MS = 30_000
const MAX_LOCAL_ENTRIES = 10_000
const local = new Map<string, { value: AuthContext; expiresAt: number }>()
const keyPrefix = 'authctx:'

function readLocal(userId: string) {
  const entry = local.get(userId)
  if (!entry) return undefined
  if (entry.expiresAt <= Date.now()) {
    local.delete(userId)
    return undefined
  }
  // Re-insert so the Map order tracks recent use (a simple LRU).
  local.delete(userId)
  local.set(userId, entry)
  return entry.value
}

function writeLocal(userId: string, value: AuthContext) {
  local.delete(userId)
  if (local.size >= MAX_LOCAL_ENTRIES) {
    const oldest = local.keys().next().value
    if (oldest !== undefined) local.delete(oldest)
  }
  local.set(userId, { value, expiresAt: Date.now() + TTL_MS })
}

async function loadFromDatabase(userId: string): Promise<AuthContext | null> {
  const { data, error } = await supabase.from('profiles').select('id,role,full_name,vendors(id)').eq('id', userId).maybeSingle()
  if (error) throw error
  if (!data) return null
  const vendors = (data.vendors ?? []) as Array<{ id: string }>
  return { id: data.id, role: data.role, fullName: data.full_name ?? null, vendorId: vendors[0]?.id ?? null }
}

// Returns null when there is no profile. Throws on a database error. Neither result is cached.
export async function loadAuthContext(userId: string): Promise<AuthContext | null> {
  if (!config.AUTH_CONTEXT_CACHE) return loadFromDatabase(userId)
  const redis = getRedisPair()
  if (redis) {
    try {
      const cached = await redis.pub.get(`${keyPrefix}${userId}`)
      if (cached !== null) return JSON.parse(cached) as AuthContext
    } catch (error) {
      console.error(JSON.stringify({ event: 'auth_context.read_failed', error: error instanceof Error ? error.message : String(error) }))
    }
    const loaded = await loadFromDatabase(userId)
    if (loaded) {
      try {
        await redis.pub.set(`${keyPrefix}${userId}`, JSON.stringify(loaded), { PX: TTL_MS })
      } catch (error) {
        console.error(JSON.stringify({ event: 'auth_context.write_failed', error: error instanceof Error ? error.message : String(error) }))
      }
    }
    return loaded
  }
  const cached = readLocal(userId)
  if (cached) return cached
  const loaded = await loadFromDatabase(userId)
  if (loaded) writeLocal(userId, loaded)
  return loaded
}

// Call after any change to a user's role, vendor link or account status.
export async function invalidateAuthContext(userId: string) {
  local.delete(userId)
  const redis = getRedisPair()
  if (!redis) return
  try {
    await redis.pub.del(`${keyPrefix}${userId}`)
  } catch (error) {
    console.error(JSON.stringify({ event: 'auth_context.invalidate_failed', error: error instanceof Error ? error.message : String(error) }))
  }
}

export function clearLocalAuthContext() {
  local.clear()
}
