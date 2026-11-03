import type { NextFunction, Request, Response } from 'express'
import { errors } from 'jose'
import { supabase } from '../supabase.js'
import { config } from '../config.js'
import { verifyAccessToken } from '../services/accessToken.js'
import { loadAuthContext } from '../services/authContext.js'
import { enqueueAuditRow } from '../services/auditLog.js'
import { isTokenRevoked } from '../services/sessionRevocation.js'

// Only these keys are copied into audit metadata. Anything else, including free text and contact details, is replaced.
const auditSafeKeys = new Set([
  'action', 'amount', 'appVersion', 'capacity', 'channel', 'couponCode', 'currency', 'deliveryDate', 'enabled', 'isActive', 'is_active',
  'kind', 'limit', 'offset', 'orderId', 'page', 'pageSize', 'paymentMethod', 'planId', 'platform', 'preferredTime', 'priority',
  'quantity', 'rating', 'reason', 'role', 'scheduledFor', 'serviceId', 'serviceType', 'status', 'subscriptionId', 'template',
  'themeMode', 'tankerCount', 'type', 'verification', 'vendorId', 'waterType',
])

export function sanitizeAuditValue(value: unknown, depth = 0): unknown {
  if (depth >= 5) return '[nested value omitted]'
  if (typeof value === 'string') return value.length > 500 ? `${value.slice(0, 500)}…` : value
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => sanitizeAuditValue(item, depth + 1))
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).slice(0, 50).map(([key, item]) => [
      key,
      auditSafeKeys.has(key) ? sanitizeAuditValue(item, depth + 1) : '[omitted]',
    ]))
  }
  return value
}

// Raw buffers (for example webhook payloads) are never copied into the audit log.
export function auditBodySnapshot(body: unknown) {
  if (!body || typeof body !== 'object' || Buffer.isBuffer(body)) return undefined
  return sanitizeAuditValue(body)
}

export type AuthIdentity = { id: string; email?: string; sessionId?: string; issuedAt?: number }

// Reads the claims of a token that Supabase has already accepted. The payload is authentic at this point, so no signature check is needed.
function claimsOf(token: string): { session_id?: string; iat?: number } {
  const segment = token.split('.')[1]
  if (!segment) return {}
  try {
    return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8')) as { session_id?: string; iat?: number }
  } catch {
    return {}
  }
}

// Local verification first when AUTH_LOCAL_JWT is on. Anything it does not accept goes to Supabase (auth.getUser), which decides.
// Revocations recorded by logout and password change are checked on both paths.
export async function resolveIdentity(token: string): Promise<AuthIdentity | null> {
  if (config.AUTH_LOCAL_JWT) {
    try {
      const claims = await verifyAccessToken(token)
      if (await isTokenRevoked(claims)) return null
      return { id: claims.sub, email: claims.email, sessionId: claims.session_id, issuedAt: claims.iat }
    } catch (error) {
      if (error instanceof errors.JWTClaimValidationFailed && ['iss', 'aud'].includes(error.claim)) {
        // A mismatch here means the configured project URL or audience differs from the token. Worth a log, because it silently costs latency.
        console.warn(JSON.stringify({ event: 'auth.local_claim_mismatch', claim: error.claim }))
      }
    }
  }
  const { data, error } = await supabase.auth.getUser(token)
  if (error || !data.user) return null
  const claims = claimsOf(token)
  const identity = { id: data.user.id, email: data.user.email ?? undefined, sessionId: claims.session_id, issuedAt: claims.iat }
  if (await isTokenRevoked({ sub: identity.id, iat: identity.issuedAt ?? 0, session_id: identity.sessionId })) return null
  return identity
}

export async function requireAuth(request: Request, response: Response, next: NextFunction) {
  const token = request.headers.authorization?.replace(/^Bearer\s+/i, '')
  if (!token) return response.status(401).json({ error: 'Authentication required' })

  const identity = await resolveIdentity(token)
  if (!identity) return response.status(401).json({ error: 'Invalid session' })

  // A profile that cannot be read leaves request.profile unset, which the role checks treat as no role (same as before).
  const context = await loadAuthContext(identity.id).catch(() => null)
  const actorId = identity.id
  request.authUser = { id: actorId, email: identity.email }
  request.profile = context ? { id: context.id, role: context.role, full_name: context.fullName ?? '' } : undefined
  request.vendorId = context?.vendorId ?? undefined

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.on('finish', () => {
      const offlineId = request.header('x-offline-mutation-id')
      if (offlineId) {
        void (async () => {
          const { error: offlineError } = await supabase.from('offline_mutations').update({
            conflict_status: response.statusCode < 400 ? 'applied' : 'conflict',
            server_version: response.statusCode,
            updated_at: new Date().toISOString(),
          }).eq('id', offlineId).eq('actor_id', actorId)
          if (offlineError) console.warn(JSON.stringify({ event: 'offline_mutation.update_failed', requestId: response.locals.requestId, error: offlineError.message }))
        })().catch((offlineError: unknown) => {
          console.warn(JSON.stringify({ event: 'offline_mutation.update_failed', requestId: response.locals.requestId, error: offlineError instanceof Error ? offlineError.message : String(offlineError) }))
        })
      }

      const after = auditBodySnapshot(request.body)
      const row = {
        actor_id: actorId,
        action: `${request.method.toLowerCase()} ${request.route?.path ?? request.path}`,
        entity_type: request.baseUrl.split('/').filter(Boolean).pop() ?? 'api',
        entity_id: typeof request.params.id === 'string' ? request.params.id : null,
        metadata: { status: response.statusCode, requestId: response.locals.requestId, before: null, after, offlineMutationId: offlineId },
      }
      if (config.AUDIT_BATCHING) {
        enqueueAuditRow(row)
        return
      }
      void (async () => {
        const { error: auditError } = await supabase.from('audit_logs').insert(row)
        if (auditError) console.warn(JSON.stringify({ event: 'audit.write_failed', requestId: response.locals.requestId, error: auditError.message }))
      })().catch((auditError: unknown) => {
        console.warn(JSON.stringify({ event: 'audit.write_failed', requestId: response.locals.requestId, error: auditError instanceof Error ? auditError.message : String(auditError) }))
      })
    })
  }
  return next()
}

export function requireRole(...roles: string[]) {
  return (request: Request, response: Response, next: NextFunction) => {
    if (!request.profile || !roles.includes(request.profile.role)) return response.status(403).json({ error: 'Insufficient permissions' })
    next()
  }
}

// For high-risk actions (payouts, refunds, account deletes and status changes). Asks Supabase on every call, so a
// revoked session or banned account is refused at once, whatever the local check would accept.
export async function requireFreshAuth(request: Request, response: Response, next: NextFunction) {
  const token = request.headers.authorization?.replace(/^Bearer\s+/i, '')
  if (!token) return response.status(401).json({ error: 'Authentication required' })
  const { data, error } = await supabase.auth.getUser(token)
  if (error || !data.user || data.user.id !== request.authUser?.id) return response.status(401).json({ error: 'Invalid session' })
  return next()
}
