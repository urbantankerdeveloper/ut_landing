import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Options } from 'express-rate-limit'

const fake = vi.hoisted(() => ({
  failCommands: false,
  clients: [] as Array<{ sendCommand: (args: string[]) => Promise<unknown> }>,
}))

vi.mock('../config.js', () => ({ config: { REDIS_URL: 'rediss://cache.example.test:6380', NODE_ENV: 'test' } }))
vi.mock('redis', () => ({
  createClient: () => {
    const client = {
      isReady: true,
      on: () => client,
      connect: async () => undefined,
      destroy: () => undefined,
      quit: async () => 'OK',
      sendCommand: async () => {
        if (fake.failCommands) throw new Error('redis down')
        return 0
      },
    }
    fake.clients.push(client)
    return client
  },
}))

import { createRedisPair, limiterStore } from './scaling.js'

const options = { windowMs: 60_000, limit: 5 } as Options

describe('limiterStore without Redis', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('counts hits in memory', async () => {
    const store = limiterStore('rl:test:memory:')
    store.init?.(options)
    expect((await store.increment('client-a')).totalHits).toBe(1)
    expect((await store.increment('client-a')).totalHits).toBe(2)
    expect((await store.increment('client-b')).totalHits).toBe(1)
    await store.decrement('client-a')
    expect((await store.increment('client-a')).totalHits).toBe(2)
  })
})

describe('limiterStore with Redis', () => {
  beforeEach(async () => {
    fake.failCommands = false
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    await createRedisPair()
  })
  afterEach(() => {
    fake.failCommands = false
    vi.restoreAllMocks()
  })

  it('falls back to memory on a Redis error when onRedisError is memory', async () => {
    const store = limiterStore('rl:test:login:', 'memory')
    store.init?.(options)
    fake.failCommands = true
    expect((await store.increment('account:x')).totalHits).toBe(1)
    expect((await store.increment('account:x')).totalHits).toBe(2)
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('rate_limit.memory_fallback'))
  })

  it('rethrows a Redis error when onRedisError is open, so passOnStoreError decides', async () => {
    const store = limiterStore('rl:test:open:', 'open')
    store.init?.(options)
    fake.failCommands = true
    await expect(store.increment('client-a')).rejects.toThrow('redis down')
  })
})
