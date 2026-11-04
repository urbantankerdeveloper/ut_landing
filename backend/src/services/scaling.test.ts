import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

const fakeRedis = vi.hoisted(() => ({
  clients: [] as Array<{ options: { socket: { reconnectStrategy: (retries: number) => number | Error } }; handlers: Record<string, () => void>; connect: () => Promise<void>; destroy: () => void }>,
  connectError: null as Error | null,
  destroyCalls: 0,
}))

vi.mock('redis', () => ({
  createClient: (options: unknown) => {
    const client = {
      options: options as (typeof fakeRedis.clients)[number]['options'],
      handlers: {} as Record<string, () => void>,
      connect: async () => { if (fakeRedis.connectError) throw fakeRedis.connectError },
      destroy: () => { fakeRedis.destroyCalls += 1 },
      on(event: string, handler: () => void) { client.handlers[event] = handler; return client },
    }
    fakeRedis.clients.push(client)
    return client
  },
}))

const base = { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'k', SUPABASE_DB_URL: '', APPLIED_GST_PERCENTAGE: '18' }

describe('horizontal scaling switch', () => {
  const original = { ...process.env }
  beforeEach(() => { vi.resetModules() })
  afterEach(() => { process.env = { ...original } })

  it('runs as a single instance when REDIS_URL is not set', async () => {
    process.env = { ...original, ...base, REDIS_URL: '' }
    const { createRedisPair, rateLimitStoreFor, socketAdapterFor } = await import('./scaling.js')
    expect(await createRedisPair()).toBeNull()
    expect(rateLimitStoreFor(null)).toBeUndefined()
    expect(socketAdapterFor(null)).toBeUndefined()
  })

  it('defaults APPLIED_GST_PERCENTAGE to 18 when it is not configured', async () => {
    const withoutGst: Record<string, string> = { ...base }
    delete withoutGst.APPLIED_GST_PERCENTAGE
    process.env = { ...original, ...withoutGst }
    const { config } = await import('../config.js')
    expect(config.APPLIED_GST_PERCENTAGE).toBe(18)
  })

  it('rejects a non-numeric APPLIED_GST_PERCENTAGE', async () => {
    process.env = { ...original, ...base, APPLIED_GST_PERCENTAGE: 'eighteen' }
    await expect(import('../config.js')).rejects.toThrow('APPLIED_GST_PERCENTAGE')
  })

  it('rejects a REDIS_URL that is not a URL', async () => {
    process.env = { ...original, ...base, REDIS_URL: 'not-a-url' }
    await expect(import('../config.js')).rejects.toThrow('REDIS_URL')
  })

  it('warns in production when REDIS_URL is missing', async () => {
    process.env = { ...original, ...base, NODE_ENV: 'production', FRONTEND_ORIGIN: 'https://app.example.com', CORS_ORIGINS: 'https://app.example.com', REDIS_URL: '', OTP_HMAC_SECRET: 'x'.repeat(32) }
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const { warnIfSingleInstanceInProduction } = await import('./scaling.js')
    warnIfSingleInstanceInProduction()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('scaling.single_instance'))
    warn.mockRestore()
  })

  it('gives up reconnecting only before the first successful connection', async () => {
    process.env = { ...original, ...base, REDIS_URL: 'rediss://cache.example.com:6380' }
    fakeRedis.clients.length = 0
    fakeRedis.connectError = null
    const { createRedisPair } = await import('./scaling.js')
    expect(await createRedisPair()).not.toBeNull()
    const [publisher] = fakeRedis.clients
    const strategy = publisher!.options.socket.reconnectStrategy
    expect(strategy(6)).toBeInstanceOf(Error)
    publisher!.handlers.ready!()
    expect(strategy(6)).toBe(2_000)
  })

  it('fails startup with a clear error and closes both clients when Redis is unreachable', async () => {
    process.env = { ...original, ...base, REDIS_URL: 'rediss://cache.example.com:6380' }
    fakeRedis.clients.length = 0
    fakeRedis.destroyCalls = 0
    fakeRedis.connectError = new Error('Redis is unreachable. Check REDIS_URL.')
    const { createRedisPair } = await import('./scaling.js')
    await expect(createRedisPair()).rejects.toThrow('Redis is unreachable')
    expect(fakeRedis.destroyCalls).toBe(2)
    fakeRedis.connectError = null
  })
})
