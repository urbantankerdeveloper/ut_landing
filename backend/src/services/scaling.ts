import { createAdapter } from '@socket.io/redis-adapter'
import { MemoryStore, type Options, type Store } from 'express-rate-limit'
import { RedisStore } from 'rate-limit-redis'
import { createClient, type RedisClientType } from 'redis'
import { config } from '../config.js'

export type RedisPair = { pub: RedisClientType; sub: RedisClientType }

// The pair is created at startup, after the route modules are loaded. Route limiters read it lazily through limiterStore().
let activePair: RedisPair | null = null
export function getRedisPair() {
  return activePair
}

// Several API instances share realtime rooms and rate limits through Redis. Without REDIS_URL the API runs as one instance.
function createRedisClient(url: string, disableOfflineQueue = false) {
  let connectedOnce = false
  const client = createClient({
    url,
    disableOfflineQueue,
    socket: {
      connectTimeout: 5_000,
      // Startup gives up after a few attempts so a missing Redis fails with a clear error instead of hanging.
      // After the first connection it keeps retrying, so a Redis restart does not leave this instance without Redis.
      reconnectStrategy: (retries) => (!connectedOnce && retries > 5 ? new Error('Redis is unreachable. Check REDIS_URL.') : Math.min(retries * 500, 2_000)),
    },
  })
  client.on('ready', () => { connectedOnce = true })
  client.on('error', (error: Error) => console.error(JSON.stringify({ event: 'redis.error', error: error.message })))
  return client
}

export async function createRedisPair(): Promise<RedisPair | null> {
  if (!config.REDIS_URL) return null
  // The publisher fails fast while disconnected, so rate-limit checks do not wait on a dead connection.
  const pub = createRedisClient(config.REDIS_URL, true)
  const sub = createRedisClient(config.REDIS_URL)
  try {
    await Promise.all([pub.connect(), sub.connect()])
  } catch (error) {
    pub.destroy()
    sub.destroy()
    throw error
  }
  activePair = { pub, sub }
  return activePair
}

export function socketAdapterFor(redis: RedisPair | null) {
  return redis ? createAdapter(redis.pub, redis.sub) : undefined
}

export function rateLimitStoreFor(redis: RedisPair | null, prefix = 'rl:api:') {
  if (!redis) return undefined
  return new RedisStore({
    prefix,
    sendCommand: async (...args: string[]) => {
      try {
        return await redis.pub.sendCommand(args)
      } catch (error) {
        console.error(JSON.stringify({ event: 'rate_limit.store_failed', prefix, error: error instanceof Error ? error.message : String(error) }))
        throw error
      }
    },
  })
}

// One store per limiter. Redis counts are shared across instances. Without a Redis pair the limiter counts in memory.
// onRedisError 'open' rethrows, so express-rate-limit's passOnStoreError decides (global behaviour).
// onRedisError 'memory' counts this instance in memory instead, so login and OTP limits are never switched off during a Redis outage.
export function limiterStore(prefix: string, onRedisError: 'open' | 'memory' = 'open'): Store {
  const memory = new MemoryStore()
  let options: Options | undefined
  let redisStore: RedisStore | undefined
  let redisPair: RedisPair | null = null
  const redisFor = () => {
    const pair = activePair
    if (!pair) return undefined
    if (pair !== redisPair) {
      redisPair = pair
      redisStore = rateLimitStoreFor(pair, prefix) as RedisStore
      if (options) void redisStore.init(options).catch((error: unknown) => console.error(JSON.stringify({ event: 'rate_limit.init_failed', prefix, error: error instanceof Error ? error.message : String(error) })))
    }
    return redisStore
  }
  async function run<T>(operation: (store: Store) => T | Promise<T>): Promise<T> {
    const store = redisFor()
    if (!store) return operation(memory)
    try {
      return await operation(store)
    } catch (error) {
      if (onRedisError === 'open') throw error
      console.error(JSON.stringify({ event: 'rate_limit.memory_fallback', prefix }))
      return operation(memory)
    }
  }
  return {
    init(value: Options) {
      options = value
      memory.init(value)
    },
    increment: (key) => run((store) => store.increment(key)),
    decrement: (key) => run((store) => store.decrement(key)),
    resetKey: (key) => run((store) => store.resetKey(key)),
  }
}

export async function closeRedisPair(redis: RedisPair | null) {
  if (!redis) return
  if (activePair === redis) activePair = null
  await Promise.allSettled([redis.pub.quit(), redis.sub.quit()])
}

export function warnIfSingleInstanceInProduction() {
  if (config.NODE_ENV === 'production' && !config.REDIS_URL) {
    console.warn(JSON.stringify({ event: 'scaling.single_instance', message: 'REDIS_URL is not set. Run one API instance, or set REDIS_URL before adding instances.' }))
  }
}
