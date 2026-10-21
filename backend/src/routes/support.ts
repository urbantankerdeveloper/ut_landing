import { Router } from 'express'
import { z } from 'zod'
import { requireAuth } from '../middleware/auth.js'
import { supabase } from '../supabase.js'

const router = Router()
router.use(requireAuth)
router.get('/requests', async (request, response) => { const { data, error } = await supabase.from('complaints').select('*').eq('customer_id', request.authUser!.id).is('vendor_id', null).order('created_at', { ascending: false }); if (error) return response.status(500).json({ error: error.message }); response.json((data ?? []).map((item) => ({ id: item.id, subject: item.subject, message: item.message, status: item.status, response: item.response ?? null, createdAt: item.created_at, updatedAt: item.updated_at ?? item.created_at }))) })
router.get('/requests/:id', async (request, response) => {
  const { data, error } = await supabase
    .from('complaints')
    .select('*')
    .eq('id', request.params.id)
    .eq('customer_id', request.authUser!.id)
    .is('vendor_id', null)
    .single()
  if (error || !data) return response.status(404).json({ error: 'Support request not found' })
  const timeline = [
    {
      type: 'customer',
      message: data.message,
      createdAt: data.created_at,
    },
    ...(data.response
      ? [{ type: 'support', message: data.response, createdAt: data.updated_at ?? data.created_at }]
      : []),
  ]
  response.json({
    id: data.id,
    subject: data.subject,
    message: data.message,
    status: data.status,
    bookingId: data.booking_id ?? null,
    response: data.response ?? null,
    createdAt: data.created_at,
    updatedAt: data.updated_at ?? data.created_at,
    timeline,
  })
})
router.post('/requests', async (request, response) => { const parsed = z.object({ subject: z.string().min(2).max(120), message: z.string().min(2).max(2000), orderId: z.string().uuid().optional() }).safeParse(request.body); if (!parsed.success) return response.status(400).json({ error: 'Invalid support request' }); const { data, error } = await supabase.from('complaints').insert({ customer_id: request.authUser!.id, booking_id: parsed.data.orderId ?? null, subject: parsed.data.subject, message: parsed.data.message, status: 'open' }).select().single(); if (error) return response.status(400).json({ error: error.message }); response.status(201).json({ id: data.id, subject: data.subject, message: data.message, status: data.status, createdAt: data.created_at }) })

export default router