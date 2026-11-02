import { createAdapter } from '@socket.io/redis-adapter'
import { RedisStore } from 'rate-limit-redis'
import { createClient, type RedisClientType } from 'redis'
import { config } from '../config.js'

export type RedisPair = { pub: RedisClientType; sub: RedisClientType }

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
  return { pub, sub }
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

export async function closeRedisPair(redis: RedisPair | null) {
  if (!redis) return
  await Promise.allSettled([redis.pub.quit(), redis.sub.quit()])
}

export function warnIfSingleInstanceInProduction() {
  if (config.NODE_ENV === 'production' && !config.REDIS_URL) {
    console.warn(JSON.stringify({ event: 'scaling.single_instance', message: 'REDIS_URL is not set. Run one API instance, or set REDIS_URL before adding instances.' }))
  }
}
