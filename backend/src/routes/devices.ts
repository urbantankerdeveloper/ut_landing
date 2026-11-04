import { Router } from 'express'
import { z } from 'zod'
import { requireAuth } from '../middleware/auth.js'
import { supabase } from '../supabase.js'
import { logger } from '../lib/logger.js'

const router = Router()
router.use(requireAuth)

router.post('/register', async (request, response) => {
  const parsed = z.object({
    token: z.string().trim().min(10).max(4096),
    platform: z.enum(['android', 'ios']),
    appVersion: z.string().trim().max(40).optional(),
  }).safeParse(request.body)
  if (!parsed.success) return response.status(400).json({ error: 'Invalid device registration' })

  const userId = request.authUser!.id
  const values = {
    platform: parsed.data.platform,
    app_version: parsed.data.appVersion ?? null,
    is_active: true,
    last_seen_at: new Date().toISOString(),
  }
  const { data: existing, error: lookupError } = await supabase.from('device_tokens').select('user_id').eq('token', parsed.data.token).maybeSingle()
  if (lookupError) {
    logger.error('devices.lookup_failed', { requestId: response.locals.requestId, error: lookupError.message })
    return response.status(500).json({ error: 'Device registration could not be saved.' })
  }
  if (existing && existing.user_id !== userId) return response.status(409).json({ error: 'This device is registered to another account.' })

  if (existing) {
    const { data, error } = await supabase.from('device_tokens').update(values).eq('token', parsed.data.token).eq('user_id', userId).select().single()
    if (error || !data) {
      logger.error('devices.update_failed', { requestId: response.locals.requestId, error: error?.message })
      return response.status(500).json({ error: 'Device registration could not be saved.' })
    }
    return response.status(201).json(data)
  }

  const { data, error } = await supabase.from('device_tokens').insert({ ...values, user_id: userId, token: parsed.data.token }).select().single()
  if (error) {
    // A concurrent registration by another user wins the unique token, so the insert fails instead of reassigning it.
    if (error.code === '23505') return response.status(409).json({ error: 'This device is registered to another account.' })
    logger.error('devices.insert_failed', { requestId: response.locals.requestId, error: error.message })
    return response.status(500).json({ error: 'Device registration could not be saved.' })
  }
  response.status(201).json(data)
})

router.delete('/register', async (request, response) => {
  const parsed = z.object({ token: z.string().trim().min(10).max(4096) }).safeParse(request.body)
  if (!parsed.success) return response.status(400).json({ error: 'Invalid device token' })
  const { error } = await supabase.from('device_tokens')
    .update({ is_active: false, last_seen_at: new Date().toISOString() })
    .eq('user_id', request.authUser!.id)
    .eq('token', parsed.data.token)
  if (error) {
    logger.error('devices.deactivate_failed', { requestId: response.locals.requestId, error: error.message })
    return response.status(400).json({ error: 'Device could not be removed.' })
  }
  response.status(204).send()
})

export default router
