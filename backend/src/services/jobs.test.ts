import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({
  queue: [] as Array<{ data?: unknown; count?: number | null; error: { message: string } | null }>,
  fromCalls: [] as Array<{ table: string; select?: unknown[]; inArgs?: unknown[] }>,
  removeCalls: [] as unknown[][],
  removeError: null as { message: string } | null,
}))

function builder(table: string) {
  const call: { table: string; select?: unknown[]; inArgs?: unknown[] } = { table }
  db.fromCalls.push(call)
  const result = db.queue.shift() ?? { error: null }
  const chain: Record<string, unknown> = {
    select: (...args: unknown[]) => { call.select = args; return chain },
    eq: () => chain,
    lt: () => chain,
    lte: () => chain,
    limit: () => chain,
    delete: () => chain,
    in: (...args: unknown[]) => { call.inArgs = args; return chain },
    then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => Promise.resolve(result).then(resolve, reject),
  }
  return chain
}

vi.mock('../supabase.js', () => ({
  supabase: {
    from: (table: string) => builder(table),
    storage: {
      from: () => ({
        remove: async (keys: unknown[]) => {
          db.removeCalls.push(keys)
          return { error: db.removeError }
        },
      }),
    },
  },
}))
vi.mock('../config.js', () => ({ config: { NODE_ENV: 'test' } }))
vi.mock('../database.js', () => ({ databasePool: null }))
vi.mock('../routes/analytics.js', () => ({ runAnalyticsRetentionSweep: async () => 0 }))

import { runDocumentExpirySweep, runReminderSweep, runStorageCleanupSweep } from './jobs.js'

describe('background sweeps', () => {
  beforeEach(() => {
    db.queue.length = 0
    db.fromCalls.length = 0
    db.removeCalls.length = 0
    db.removeError = null
  })

  it('counts reminder candidates with a head query instead of transferring rows', async () => {
    db.queue.push({ count: 4, error: null })
    expect(await runReminderSweep()).toBe(4)
    expect(db.fromCalls[0]?.select).toEqual(['id', { count: 'exact', head: true }])
  })

  it('counts expiring documents with a head query', async () => {
    db.queue.push({ count: 0, error: null })
    expect(await runDocumentExpirySweep()).toBe(0)
    expect(db.fromCalls[0]?.select).toEqual(['id', { count: 'exact', head: true }])
  })

  it('removes a rejected-document batch with one storage call and deletes its rows with one statement', async () => {
    db.queue.push({ data: [{ id: 'a', object_key: 'k1' }, { id: 'b', object_key: 'k2' }], error: null })
    db.queue.push({ error: null })
    expect(await runStorageCleanupSweep()).toEqual({ scanned: 2, removed: 2, failed: 0, failures: [] })
    expect(db.removeCalls).toEqual([['k1', 'k2']])
    expect(db.fromCalls[1]?.inArgs).toEqual(['id', ['a', 'b']])
  })

  it('reports every row as failed and keeps the rows when the storage remove fails', async () => {
    db.queue.push({ data: [{ id: 'a', object_key: 'k1' }], error: null })
    db.removeError = { message: 'storage unavailable' }
    expect(await runStorageCleanupSweep()).toEqual({ scanned: 1, removed: 0, failed: 1, failures: ['a'] })
    expect(db.fromCalls).toHaveLength(1)
  })

  it('does nothing when no rows are due', async () => {
    db.queue.push({ data: [], error: null })
    expect(await runStorageCleanupSweep()).toEqual({ scanned: 0, removed: 0, failed: 0, failures: [] })
    expect(db.removeCalls).toEqual([])
  })
})
