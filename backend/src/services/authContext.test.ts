import { beforeEach, describe, expect, it, vi } from 'vitest'

const cfg = vi.hoisted(() => ({ AUTH_CONTEXT_CACHE: false }))
const db = vi.hoisted(() => ({ queries: 0, row: null as Record<string, unknown> | null, error: null as { message: string } | null }))

vi.mock('../config.js', () => ({ config: cfg }))
vi.mock('../supabase.js', () => ({
  supabase: {
    from: () => {
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () => {
          db.queries += 1
          return { data: db.row, error: db.error }
        },
      }
      return chain
    },
  },
}))

import { invalidateAuthContext, loadAuthContext, clearLocalAuthContext } from './authContext.js'

describe('loadAuthContext', () => {
  beforeEach(() => {
    db.queries = 0
    db.row = { id: 'user-1', role: 'vendor', full_name: 'Asha', vendors: [{ id: 'vendor-1' }] }
    db.error = null
    cfg.AUTH_CONTEXT_CACHE = false
    clearLocalAuthContext()
  })

  it('reads the profile and vendor id in one query, mapping the embed to vendorId', async () => {
    expect(await loadAuthContext('user-1')).toEqual({ id: 'user-1', role: 'vendor', fullName: 'Asha', vendorId: 'vendor-1' })
    expect(db.queries).toBe(1)
  })

  it('reads the database on every call while the cache flag is off', async () => {
    await loadAuthContext('user-1')
    await loadAuthContext('user-1')
    expect(db.queries).toBe(2)
  })

  it('serves repeat calls from the cache while the flag is on, until invalidated', async () => {
    cfg.AUTH_CONTEXT_CACHE = true
    await loadAuthContext('user-1')
    await loadAuthContext('user-1')
    expect(db.queries).toBe(1)
    await invalidateAuthContext('user-1')
    db.row = { id: 'user-1', role: 'customer', full_name: 'Asha', vendors: [] }
    expect(await loadAuthContext('user-1')).toMatchObject({ role: 'customer', vendorId: null })
    expect(db.queries).toBe(2)
  })

  it('does not cache a missing profile, so a profile created a moment later is seen', async () => {
    cfg.AUTH_CONTEXT_CACHE = true
    db.row = null
    expect(await loadAuthContext('user-2')).toBeNull()
    db.row = { id: 'user-2', role: 'customer', full_name: null, vendors: [] }
    expect(await loadAuthContext('user-2')).toMatchObject({ id: 'user-2' })
    expect(db.queries).toBe(2)
  })

  it('throws on a database error and caches nothing', async () => {
    cfg.AUTH_CONTEXT_CACHE = true
    db.error = { message: 'timeout' }
    await expect(loadAuthContext('user-3')).rejects.toEqual({ message: 'timeout' })
    db.error = null
    await loadAuthContext('user-3')
    expect(db.queries).toBe(2)
  })
})
