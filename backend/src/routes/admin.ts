import { Router } from 'express'
import { requireAuth, requireRole } from '../middleware/auth.js'
import { supabase } from '../supabase.js'
const router = Router(); router.use(requireAuth, requireRole('admin', 'dispatcher'))
router.get('/orders', async (_request, response) => { const { data, error } = await supabase.from('bookings').select('*').order('created_at', { ascending: false }); if (error) return response.status(500).json({ error: error.message }); response.json(data ?? []) })
router.get('/vendors', async (_request, response) => { const { data, error } = await supabase.from('vendors').select('*').order('created_at', { ascending: false }); if (error) return response.status(500).json({ error: error.message }); response.json(data ?? []) })
router.get('/coupons', async (_request, response) => { const { data, error } = await supabase.from('coupons').select('*').order('created_at', { ascending: false }); if (error) return response.status(500).json({ error: error.message }); response.json(data ?? []) })
router.get('/audit-logs', async (_request, response) => { const { data, error } = await supabase.from('audit_logs').select('*').order('created_at', { ascending: false }).limit(100); if (error) return response.status(500).json({ error: error.message }); response.json(data ?? []) })
export default router
