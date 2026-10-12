import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { supabase } from '../supabase.js'
import { bookingSchema } from '../lib/schemas.js'
const router = Router()
router.use(requireAuth)
router.get('/orders', async (request, response) => { const { data, error } = await supabase.from('bookings').select('*').eq('customer_id', request.authUser!.id).order('created_at', { ascending: false }); if (error) return response.status(500).json({ error: error.message }); response.json(data ?? []) })
router.post('/orders', async (request, response) => { const parsed = bookingSchema.safeParse(request.body); if (!parsed.success) return response.status(400).json({ error: 'Invalid booking', details: parsed.error.flatten() }); const reference = `UT-${Date.now().toString().slice(-8)}`; const { data, error } = await supabase.from('bookings').insert({ reference, customer_id: request.authUser!.id, service_code: parsed.data.serviceId, capacity_litres: Number.parseInt(parsed.data.capacity ?? '0', 10) || null, address_text: parsed.data.location, scheduled_for: parsed.data.deliveryDate, access_notes: parsed.data.notes ?? null, quoted_amount_paise: 0 }).select('id,reference').single(); if (error) return response.status(500).json({ error: error.message }); response.status(201).json(data) })
router.get('/invoices', async (request, response) => { const { data, error } = await supabase.from('invoices').select('*').eq('customer_id', request.authUser!.id).order('created_at', { ascending: false }); if (error) return response.status(500).json({ error: error.message }); response.json(data ?? []) })
router.get('/addresses', async (request, response) => { const { data, error } = await supabase.from('saved_addresses').select('*').eq('user_id', request.authUser!.id).order('created_at', { ascending: false }); if (error) return response.status(500).json({ error: error.message }); response.json(data ?? []) })
router.get('/subscriptions', async (request, response) => { const { data, error } = await supabase.from('subscriptions').select('*').eq('customer_id', request.authUser!.id).order('created_at', { ascending: false }); if (error) return response.status(500).json({ error: error.message }); response.json(data ?? []) })
router.get('/profile', async (request, response) => { const { data, error } = await supabase.from('profiles').select('*').eq('id', request.authUser!.id).single(); if (error) return response.status(500).json({ error: error.message }); response.json(data) })
export default router
