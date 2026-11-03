import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({
  insert: vi.fn(async (_rows: unknown[]) => ({ error: null as { message: string } | null })),
}))

vi.mock('../supabase.js', () => ({ supabase: { from: () => ({ insert: (rows: unknown[]) => db.insert(rows) }) } }))

import { auditQueueDepth, enqueueAuditRow, flushAuditQueue, stopAuditBatcher } from './auditLog.js'

function row(index: number) {
  return { actor_id: 'user-1', action: `post /x/${index}`, entity_type: 'x', entity_id: null, metadata: { index } }
}

function insertedIndexes() {
  return db.insert.mock.calls.flatMap((call) => (call[0] as Array<{ metadata: { index: number } }>).map((item) => item.metadata.index))
}

describe('audit batcher', () => {
  beforeEach(() => {
    db.insert.mockClear()
    db.insert.mockResolvedValue({ error: null })
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  })
  afterEach(async () => {
    await flushAuditQueue()
    stopAuditBatcher()
    vi.restoreAllMocks()
  })

  it('holds rows until the one-second timer runs', async () => {
    vi.useFakeTimers()
    enqueueAuditRow(row(1))
    enqueueAuditRow(row(2))
    expect(db.insert).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1000)
    expect(db.insert).toHaveBeenCalledTimes(1)
    expect(insertedIndexes()).toEqual([1, 2])
    stopAuditBatcher()
    vi.useRealTimers()
  })

  it('writes a batch as soon as 100 rows are queued', async () => {
    for (let index = 0; index < 100; index += 1) enqueueAuditRow(row(index))
    await flushAuditQueue()
    expect(db.insert).toHaveBeenCalledTimes(1)
    expect((db.insert.mock.calls[0]?.[0] as unknown[]).length).toBe(100)
  })

  it('writes everything left on shutdown', async () => {
    enqueueAuditRow(row(7))
    await flushAuditQueue()
    expect(insertedIndexes()).toEqual([7])
    expect(auditQueueDepth()).toBe(0)
  })

  it('drops the oldest rows above 5000 and warns once with the count', async () => {
    for (let index = 0; index < 5005; index += 1) enqueueAuditRow(row(index))
    await flushAuditQueue()
    const indexes = insertedIndexes()
    expect(indexes).toHaveLength(5000)
    expect(indexes).not.toContain(0)
    expect(indexes).toContain(5004)
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('"dropped":5'))
  })

  it('keeps going when a batch insert fails, and logs without the audit content', async () => {
    db.insert.mockResolvedValueOnce({ error: { message: 'write refused' } })
    enqueueAuditRow(row(1))
    await expect(flushAuditQueue()).resolves.toBeUndefined()
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('audit.batch_write_failed'))
    expect(JSON.stringify((console.warn as unknown as { mock: { calls: unknown[][] } }).mock.calls)).not.toContain('post /x/1')
  })

  it('survives an insert that throws', async () => {
    db.insert.mockRejectedValueOnce(new Error('network down'))
    enqueueAuditRow(row(2))
    await expect(flushAuditQueue()).resolves.toBeUndefined()
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('network down'))
  })
})
