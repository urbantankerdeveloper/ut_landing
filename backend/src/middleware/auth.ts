import type { NextFunction, Request, Response } from 'express'
import { logger } from '../lib/logger.js'
import { supabase } from '../supabase.js'

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
  const token = request.headers.authorization?.replace(/^Bearer\s+/i, '')
  if (!token) return response.status(401).json({ error: 'Authentication required' })

  const { data, error } = await supabase.auth.getUser(token)
  if (error || !data.user) return response.status(401).json({ error: 'Invalid session' })

  const { data: profile } = await supabase.from('profiles').select('id,role,full_name').eq('id', data.user.id).single()
  request.authUser = data.user
  request.profile = profile ?? undefined

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.on('finish', () => {
      const offlineId = request.header('x-offline-mutation-id')
      if (offlineId) {
        void (async () => {
          const { error: offlineError } = await supabase.from('offline_mutations').update({
            conflict_status: response.statusCode < 400 ? 'applied' : 'conflict',
            server_version: response.statusCode,
            updated_at: new Date().toISOString(),
          }).eq('id', offlineId).eq('actor_id', data.user.id)
          if (offlineError) logger.warn('offline_mutation.update_failed', { requestId: response.locals.requestId, error: offlineError.message })
        })().catch((offlineError: unknown) => {
          logger.warn('offline_mutation.update_failed', { requestId: response.locals.requestId, error: offlineError instanceof Error ? offlineError.message : String(offlineError) })
        })
      }

      const after = auditBodySnapshot(request.body)
      void (async () => {
        const { error: auditError } = await supabase.from('audit_logs').insert({
          actor_id: data.user.id,
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

export function requireRole(...roles: string[]) {
  return (request: Request, response: Response, next: NextFunction) => {
    if (!request.profile || !roles.includes(request.profile.role)) return response.status(403).json({ error: 'Insufficient permissions' })
    next()
  }
}
