import { createRemoteJWKSet, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from 'jose'
import { config } from '../config.js'

// Supabase signs access tokens with an asymmetric key (ES256). Verifying locally only needs the public keys from the JWKS endpoint.
export type VerifiedAccessToken = JWTPayload & { sub: string; iat: number; email?: string; session_id?: string }

let keySource: JWTVerifyGetKey | null = null

function issuer() {
  return `${config.SUPABASE_URL.replace(/\/+$/, '')}/auth/v1`
}

function keys() {
  keySource ??= createRemoteJWKSet(new URL(`${issuer()}/.well-known/jwks.json`), { cooldownDuration: 30_000, cacheMaxAge: 10 * 60 * 1000 })
  return keySource
}

// Tests inject a local key set here.
export function setAccessTokenKeySource(source: JWTVerifyGetKey | null) {
  keySource = source
}

// Throws for anything it does not accept. Callers then ask Supabase (auth.getUser), so a local failure never accepts a token the remote check would reject.
export async function verifyAccessToken(token: string): Promise<VerifiedAccessToken> {
  const { payload } = await jwtVerify(token, keys(), { issuer: issuer(), audience: 'authenticated', algorithms: ['ES256', 'RS256'], clockTolerance: 10 })
  if (typeof payload.sub !== 'string' || payload.sub.length === 0) throw new Error('Access token has no subject')
  if (typeof payload.iat !== 'number') throw new Error('Access token has no issued-at time')
  return payload as VerifiedAccessToken
}
