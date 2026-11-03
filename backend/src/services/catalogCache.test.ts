import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fakePair = vi.hoisted(() => ({
  current: null as null | { pub: Record<string, unknown> },
}))

vi.mock('../config.js', () => ({ config: { CATALOG_CACHE_TTL_SECONDS: 60 } }))
vi.mock('./scaling.js', () => ({ getRedisPair: () => fakePair.current }))

import { cachedCatalog, clearLocalCatalogCache, invalidateCatalog } from './catalogCache.js'

describe('cachedCatalog without Redis', () => {
  beforeEach(() => {
    fakePair.current = null
    clearLocalCatalogCache()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2030-01-01T00:00:00Z'))
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('loads once and serves the cached value until the TTL passes', async () => {
    const load = vi.fn(async () => [{ code: 'TANKER' }])
    expect(await cachedCatalog('customer.services', load, 1000)).toEqual([{ code: 'TANKER' }])
    expect(await cachedCatalog('customer.services', load, 1000)).toEqual([{ code: 'TANKER' }])
    expect(load).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(1001)
    await cachedCatalog('customer.services', load, 1000)
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('does not cache a failed load', async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error('db down')).mockResolvedValueOnce([1])
    await expect(cachedCatalog('customer.offers', load, 1000)).rejects.toThrow('db down')
    expect(await cachedCatalog('customer.offers', load, 1000)).toEqual([1])
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('drops the entry on invalidation so the next read reloads', async () => {
    const load = vi.fn().mockResolvedValueOnce(['old']).mockResolvedValueOnce(['new'])
    await cachedCatalog('admin.feature-flags', load, 60_000)
    await invalidateCatalog('admin.feature-flags')
    expect(await cachedCatalog('admin.feature-flags', load, 60_000)).toEqual(['new'])
  })

  it('bypasses the cache when the TTL is zero', async () => {
    const load = vi.fn(async () => 'value')
    await cachedCatalog('customer.services', load, 0)
    await cachedCatalog('customer.services', load, 0)
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('keeps the in-process cache bounded', async () => {
    const load = vi.fn(async () => 'x')
    for (let index = 0; index < 205; index += 1) await cachedCatalog(`bulk-${index}`, load, 60_000)
    await cachedCatalog('bulk-0', load, 60_000)
    expect(load).toHaveBeenCalledTimes(206)
  })
})

describe('cachedCatalog with Redis', () => {
  beforeEach(() => {
    clearLocalCatalogCache()
  })

  function fakeRedis(store: Map<string, string>, failures = { get: false, set: false }) {
    return {
      pub: {
        get: vi.fn(async (key: string) => {
          if (failures.get) throw new Error('redis down')
          return store.get(key) ?? null
        }),
        set: vi.fn(async (key: string, value: string) => {
          if (failures.set) throw new Error('redis down')
          store.set(key, value)
          return 'OK'
        }),
        del: vi.fn(async (keys: string[]) => {
          for (const key of keys) store.delete(key)
          return keys.length
        }),
      },
    }
  }

  it('reads and writes the shared store, and invalidates across instances', async () => {
    const store = new Map<string, string>()
    fakePair.current = fakeRedis(store)
    const load = vi.fn(async () => ({ plans: 2 }))
    expect(await cachedCatalog('customer.membership-plans', load, 60_000)).toEqual({ plans: 2 })
    expect(store.get('catalog:customer.membership-plans')).toBe('{"plans":2}')
    expect(await cachedCatalog('customer.membership-plans', load, 60_000)).toEqual({ plans: 2 })
    expect(load).toHaveBeenCalledTimes(1)
    await invalidateCatalog('customer.membership-plans')
    expect(store.has('catalog:customer.membership-plans')).toBe(false)
    await cachedCatalog('customer.membership-plans', load, 60_000)
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('loads from the database when Redis reads fail', async () => {
    fakePair.current = fakeRedis(new Map(), { get: true, set: true })
    const load = vi.fn(async () => ['row'])
    expect(await cachedCatalog('customer.services', load, 60_000)).toEqual(['row'])
  })

  it('does not fail an invalidation when Redis is down', async () => {
    fakePair.current = { pub: { del: vi.fn(async () => { throw new Error('redis down') }) } }
    await expect(invalidateCatalog('customer.services')).resolves.toBeUndefined()
  })
})
