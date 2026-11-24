import type { NextFunction, Request, Response } from 'express'
import { logger } from '../lib/logger.js'
import { supabase } from '../supabase.js'
import { config } from '../config.js'
import { getCachedAuthProfile } from '../services/authCache.js'
import { createRemoteJWKSet, jwtVerify } from 'jose'
import type { User } from '@supabase/supabase-js'

let supabaseJwks: ReturnType<typeof createRemoteJWKSet> | null = null

export async function resolveAuthenticatedUser(token: string): Promise<{ user: User | null; error?: Error }> {
  if (config.featureFlags.AUTH_LOCAL_JWT_VERIFY) {
    try {
      if (!supabaseJwks) supabaseJwks = createRemoteJWKSet(new URL(`${config.SUPABASE_URL}/auth/v1/.well-known/jwks.json`))
      const { payload } = await jwtVerify(token, supabaseJwks, { requiredClaims: ['sub'] })
      const sub = typeof payload.sub === 'string' ? payload.sub : null
      if (!sub) throw new Error('JWT is missing sub')
      return {
        user: {
          id: sub,
          aud: typeof payload.aud === 'string' ? payload.aud : 'authenticated',
          role: typeof payload.role === 'string' ? payload.role : 'authenticated',
          email: typeof payload.email === 'string' ? payload.email : undefined,
          app_metadata: typeof payload.app_metadata === 'object' && payload.app_metadata ? payload.app_metadata as User['app_metadata'] : {},
          user_metadata: typeof payload.user_metadata === 'object' && payload.user_metadata ? payload.user_metadata as User['user_metadata'] : {},
          created_at: typeof payload.created_at === 'string' ? payload.created_at : new Date(0).toISOString(),
        },
      }
    } catch (error) {
      logger.warn('auth.local_jwt_verify_failed_fallback', { error: error instanceof Error ? error.message : 'Unknown JWT error' })
    }
  }
  const { data, error } = await supabase.auth.getUser(token)
  return { user: data.user ?? null, error: error ?? undefined }
}

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

export async function requireAuth(request: Request, response: Response, next: NextFunction) {
  if (request.authUser && request.profile) return next()
  const token = request.headers.authorization?.replace(/^Bearer\s+/i, '')
  if (!token) return response.status(401).json({ error: 'Authentication required' })

  const resolved = await resolveAuthenticatedUser(token)
  if (!resolved.user) return response.status(401).json({ error: 'Invalid session' })
  const authUser = resolved.user

  const profile = config.featureFlags.AUTH_PROFILE_CACHE
    ? await getCachedAuthProfile(authUser.id)
    : (await supabase.from('profiles').select('id,role,full_name').eq('id', authUser.id).single()).data
  request.authUser = authUser
  request.profile = profile ?? undefined

  if (!request.authAuditRegistered && request.method !== 'GET' && request.method !== 'HEAD') {
    request.authAuditRegistered = true
    response.on('finish', () => {
      const offlineId = request.header('x-offline-mutation-id')
      if (offlineId) {
        void (async () => {
          const { error: offlineError } = await supabase.from('offline_mutations').update({
            conflict_status: response.statusCode < 400 ? 'applied' : 'conflict',
            server_version: response.statusCode,
            updated_at: new Date().toISOString(),
          }).eq('id', offlineId).eq('actor_id', authUser.id)
          if (offlineError) logger.warn('offline_mutation.update_failed', { requestId: response.locals.requestId, error: offlineError.message })
        })().catch((offlineError: unknown) => {
          logger.warn('offline_mutation.update_failed', { requestId: response.locals.requestId, error: offlineError instanceof Error ? offlineError.message : String(offlineError) })
        })
      }

      const after = auditBodySnapshot(request.body)
      void (async () => {
        const { error: auditError } = await supabase.from('audit_logs').insert({
          actor_id: authUser.id,
          action: `${request.method.toLowerCase()} ${request.route?.path ?? request.path}`,
          entity_type: request.baseUrl.split('/').filter(Boolean).pop() ?? 'api',
          entity_id: typeof request.params.id === 'string' ? request.params.id : undefined,
          metadata: { status: response.statusCode, requestId: response.locals.requestId, before: null, after, offlineMutationId: offlineId },
        })
        if (auditError) logger.warn('audit.write_failed', { requestId: response.locals.requestId, error: auditError.message })
      })().catch((auditError: unknown) => {
        logger.warn('audit.write_failed', { requestId: response.locals.requestId, error: auditError instanceof Error ? auditError.message : String(auditError) })
      })
    })
  }
  return next()
}

export async function optionalAuth(request: Request, response: Response, next: NextFunction) {
  const token = request.headers.authorization?.replace(/^Bearer\s+/i, '')
  if (!token) return next()

  const resolved = await resolveAuthenticatedUser(token)
  if (!resolved.user) return response.status(401).json({ error: 'Invalid session' })

  const profile = config.featureFlags.AUTH_PROFILE_CACHE
    ? await getCachedAuthProfile(resolved.user.id)
    : (await supabase.from('profiles').select('id,role,full_name').eq('id', resolved.user.id).single()).data
  request.authUser = resolved.user
  request.profile = profile ?? undefined
  return next()
}

export function authenticatedRateLimitKey(request: Request, fallback: () => string): string {
  if (!config.featureFlags.RATE_LIMIT_BY_USER) return fallback()
  return request.authUser?.id ? `user:${request.authUser.id}` : `ip:${request.ip}`
}

export function requireRole(...roles: string[]) {
  return (request: Request, response: Response, next: NextFunction) => {
    if (!request.profile || !roles.includes(request.profile.role)) return response.status(403).json({ error: 'Insufficient permissions' })
    next()
  }
}
