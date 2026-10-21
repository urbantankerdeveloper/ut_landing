import { Router } from 'express'
import { z } from 'zod'
import { requireAuth } from '../middleware/auth.js'
import { supabase } from '../supabase.js'

const router = Router()
router.use(requireAuth)

router.post('/register', async (request, response) => {
  const parsed = z.object({
    token: z.string().trim().min(10).max(4096),
    platform: z.enum(['android', 'ios']),
    appVersion: z.string().trim().max(40).optional(),
  }).safeParse(request.body)
  if (!parsed.success) return response.status(400).json({ error: 'Invalid device registration' })
  const { data, error } = await supabase.from('device_tokens').upsert({
    user_id: request.authUser!.id,
    token: parsed.data.token,
    platform: parsed.data.platform,
    app_version: parsed.data.appVersion ?? null,
    is_active: true,
    last_seen_at: new Date().toISOString(),
  }, { onConflict: 'token' }).select().single()
  if (error) return response.status(400).json({ error: error.message })
  response.status(201).json(data)
})

router.delete('/register', async (request, response) => {
  const parsed = z.object({ token: z.string().trim().min(10).max(4096) }).safeParse(request.body)
  if (!parsed.success) return response.status(400).json({ error: 'Invalid device token' })
  const { error } = await supabase.from('device_tokens')
    .update({ is_active: false, last_seen_at: new Date().toISOString() })
    .eq('user_id', request.authUser!.id)
    .eq('token', parsed.data.token)
  if (error) return response.status(400).json({ error: error.message })
  response.status(204).send()
})

export default router
