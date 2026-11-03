import { getRedisPair } from './scaling.js'

// Access tokens stay valid until they expire (1 hour). Logout revokes the session id, and a password change sets a
// per-user cutoff: a token issued before the cutoff is refused. Records live as long as a token could still be valid.
const RECORD_TTL_MS = 65 * 60 * 1000
const local = new Map<string, { value: string; expiresAt: number }>()

function sessionKey(sessionId: string) {
  return `revoked:session:${sessionId}`
}

function userKey(userId: string) {
  return `revoked:user-before:${userId}`
}

function writeLocal(key: string, value: string) {
  local.set(key, { value, expiresAt: Date.now() + RECORD_TTL_MS })
}

function readLocal(key: string) {
  const entry = local.get(key)
  if (!entry) return undefined
  if (entry.expiresAt <= Date.now()) {
    local.delete(key)
    return undefined
  }
  return entry.value
}

async function write(key: string, value: string) {
  writeLocal(key, value)
  const redis = getRedisPair()
  if (!redis) return
  try {
    await redis.pub.set(key, value, { PX: RECORD_TTL_MS })
  } catch (error) {
    console.error(JSON.stringify({ event: 'session_revocation.write_failed', error: error instanceof Error ? error.message : String(error) }))
  }
}

async function read(key: string) {
  const redis = getRedisPair()
  if (!redis) return readLocal(key)
  try {
    return (await redis.pub.get(key)) ?? undefined
  } catch (error) {
    // Fails open while Redis is unreachable, so logins keep working. The high-risk actions still ask Supabase directly.
    console.error(JSON.stringify({ event: 'session_revocation.read_failed', error: error instanceof Error ? error.message : String(error) }))
    return readLocal(key)
  }
}

export async function revokeSession(sessionId: string) {
  await write(sessionKey(sessionId), '1')
}

// The cutoff is one second ahead, so a token minted in the same second as the revocation is refused too.
export async function revokeUserTokens(userId: string, nowSeconds = Math.floor(Date.now() / 1000) + 1) {
  await write(userKey(userId), String(nowSeconds))
}

export async function isTokenRevoked(claims: { sub: string; iat: number; session_id?: string }) {
  if (claims.session_id && (await read(sessionKey(claims.session_id))) !== undefined) return true
  const cutoff = await read(userKey(claims.sub))
  return cutoff !== undefined && claims.iat < Number(cutoff)
}

export function clearLocalRevocations() {
  local.clear()
}
