import { getRedisPair } from './scaling.js'
import { config } from '../config.js'

// Read-mostly catalogs (services, offers, plans, feature flags). With REDIS_URL the entries live in Redis, so an admin change
// invalidates every instance. Without it they live in process memory, bounded by MAX_LOCAL_ENTRIES.
const MAX_LOCAL_ENTRIES = 200
const local = new Map<string, { value: string; expiresAt: number }>()
const keyPrefix = 'catalog:'

function readLocal(key: string) {
  const entry = local.get(key)
  if (!entry) return undefined
  if (entry.expiresAt <= Date.now()) {
    local.delete(key)
    return undefined
  }
  return entry.value
}

function writeLocal(key: string, value: string, ttlMs: number) {
  if (!local.has(key) && local.size >= MAX_LOCAL_ENTRIES) {
    const oldest = local.keys().next().value
    if (oldest !== undefined) local.delete(oldest)
  }
  local.set(key, { value, expiresAt: Date.now() + ttlMs })
}

// Loads through the cache. A failing loader is not cached. A Redis failure falls back to loading from the database.
export async function cachedCatalog<T>(name: string, load: () => Promise<T>, ttlMs = config.CATALOG_CACHE_TTL_SECONDS * 1000): Promise<T> {
  const key = `${keyPrefix}${name}`
  const redis = getRedisPair()
  if (ttlMs <= 0) return load()
  if (redis) {
    try {
      const cached = await redis.pub.get(key)
      if (cached !== null) return JSON.parse(cached) as T
    } catch (error) {
      console.error(JSON.stringify({ event: 'catalog_cache.read_failed', key, error: error instanceof Error ? error.message : String(error) }))
    }
    const value = await load()
    try {
      await redis.pub.set(key, JSON.stringify(value), { PX: ttlMs })
    } catch (error) {
      console.error(JSON.stringify({ event: 'catalog_cache.write_failed', key, error: error instanceof Error ? error.message : String(error) }))
    }
    return value
  }
  const cached = readLocal(key)
  if (cached !== undefined) return JSON.parse(cached) as T
  const value = await load()
  writeLocal(key, JSON.stringify(value), ttlMs)
  return value
}

// Call after any admin write that changes the catalog. Shared through Redis when it is configured.
export async function invalidateCatalog(...names: string[]) {
  for (const name of names) local.delete(`${keyPrefix}${name}`)
  const redis = getRedisPair()
  if (!redis || names.length === 0) return
  try {
    await redis.pub.del(names.map((name) => `${keyPrefix}${name}`))
  } catch (error) {
    console.error(JSON.stringify({ event: 'catalog_cache.invalidate_failed', names, error: error instanceof Error ? error.message : String(error) }))
  }
}

export function clearLocalCatalogCache() {
  local.clear()
}
