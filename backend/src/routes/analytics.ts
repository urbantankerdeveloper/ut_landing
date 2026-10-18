import { Router } from 'express'
import { requireAuth, requireRole } from '../middleware/auth.js'
import { supabase } from '../supabase.js'
import { analyticsEventSchema, summarizeAnalyticsEvents } from '../lib/analytics.js'
import { config } from '../config.js'
import rateLimit from 'express-rate-limit'

const router = Router()
const analyticsEventLimit = rateLimit({ windowMs: 60 * 1000, limit: 60, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many analytics events. Try again later.' } })

router.post('/events', analyticsEventLimit, async (request, response) => {
  const parsed = analyticsEventSchema.safeParse(request.body)
  if (!parsed.success) return response.status(400).json({ error: 'Invalid analytics event' })
  const { error } = await supabase.from('analytics_events').insert({
    event_name: parsed.data.eventName,
    session_id: parsed.data.sessionId,
    properties: parsed.data.properties,
  })
  if (error) return response.status(503).json({ error: 'Analytics storage unavailable' })
  response.status(204).send()
})

router.get('/summary', requireAuth, requireRole('admin'), async (request, response) => {
  const days = Math.min(90, Math.max(1, Number(request.query.days ?? 30)))
  const to = typeof request.query.to === 'string' ? new Date(request.query.to) : new Date()
  const from = typeof request.query.from === 'string' ? new Date(request.query.from) : new Date(to.getTime() - days * 24 * 60 * 60 * 1000)
  if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || from > to) return response.status(400).json({ error: 'Invalid analytics date range' })
  const { data, error } = await supabase.from('analytics_events').select('event_name,session_id,properties,created_at').gte('created_at', from.toISOString()).lte('created_at', to.toISOString()).limit(10_000)
  if (error) return response.status(503).json({ error: 'Analytics storage unavailable' })
  const events = (data ?? []).map((event) => ({ eventName: event.event_name, properties: { ...(event.properties ?? {}), sessionId: event.session_id }, createdAt: event.created_at }))
  const summary = { days, from: from.toISOString(), to: to.toISOString(), ...summarizeAnalyticsEvents(events) }
  if (request.query.format === 'csv') {
    const rows = Object.entries(summary.byEvent).map(([eventName, count]) => `${eventName},${count}`)
    return response.type('text/csv').send(['event_name,count', ...rows].join('\n'))
  }
  response.json(summary)
})

router.get('/export', requireAuth, requireRole('admin'), async (request, response) => {
  const from = typeof request.query.from === 'string' ? new Date(request.query.from) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
  const to = typeof request.query.to === 'string' ? new Date(request.query.to) : new Date()
  if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || from > to) return response.status(400).json({ error: 'Invalid analytics date range' })
  const { data, error } = await supabase.from('analytics_events').select('event_name,session_id,properties,created_at').gte('created_at', from.toISOString()).lte('created_at', to.toISOString()).order('created_at', { ascending: false }).limit(10_000)
  if (error) return response.status(503).json({ error: 'Analytics storage unavailable' })
  if (request.query.format === 'csv') {
    const csv = (data ?? []).map((event) => [event.created_at, event.event_name, event.session_id, JSON.stringify(event.properties)].map((value) => `"${String(value).replaceAll('"', '""')}"`).join(','))
    return response.type('text/csv').send(['created_at,event_name,session_id,properties', ...csv].join('\n'))
  }
  response.json({ from: from.toISOString(), to: to.toISOString(), events: data ?? [] })
})

export async function runAnalyticsRetentionSweep() {
  const retentionCutoff = new Date(Date.now() - config.ANALYTICS_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString()
  const anonymizeCutoff = new Date(Date.now() - config.ANALYTICS_ANONYMIZE_AFTER_DAYS * 24 * 60 * 60 * 1000).toISOString()
  const deleted = await supabase.from('analytics_events').delete().lt('created_at', retentionCutoff)
  if (deleted.error) throw new Error(`Analytics retention sweep failed: ${deleted.error.message}`)
  const anonymized = await supabase.from('analytics_events').update({ session_id: 'anonymized' }).lt('created_at', anonymizeCutoff).neq('session_id', 'anonymized')
  if (anonymized.error) throw new Error(`Analytics anonymization sweep failed: ${anonymized.error.message}`)
  return { deleted: deleted.count ?? 0, anonymized: anonymized.count ?? 0 }
}

export default router
