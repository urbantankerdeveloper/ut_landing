import { Router } from 'express'
import { z } from 'zod'
import { supabase } from '../supabase.js'

const router = Router()
const phone = z.string().regex(/^\d{10}$/, 'Enter a valid 10-digit phone number.')
const applicationSchema = z.object({
  businessName: z.string().trim().min(2).max(120),
  partnerType: z.string().trim().min(2).max(60),
  phone,
  whatsapp: phone.optional().or(z.literal('')),
  email: z.string().trim().email().max(160),
  zone: z.string().trim().min(2).max(120),
  address: z.string().trim().min(5).max(500),
  serviceCodes: z.array(z.string().trim().min(2).max(100)).min(1).max(20),
  vehicleCount: z.number().int().min(1).max(250),
  registration: z.string().trim().min(3).max(40),
  capacity: z.string().trim().min(2).max(40),
  experience: z.number().int().min(0).max(75).optional(),
  availability: z.string().trim().min(2).max(80),
  notes: z.string().trim().max(2000).optional(),
  documentNames: z.array(z.string().trim().min(1).max(180)).max(10).default([]),
})

function reference() { return `PA-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}` }

router.post('/applications', async (request, response) => {
  const parsed = applicationSchema.safeParse(request.body)
  if (!parsed.success) return response.status(400).json({ error: 'Complete the required partner application fields.', details: parsed.error.flatten() })
  const input = parsed.data
  const { data, error } = await supabase.from('partner_applications').insert({ reference: reference(), business_name: input.businessName, partner_type: input.partnerType, phone_e164: input.phone, whatsapp_e164: input.whatsapp || null, email: input.email, service_zone: input.zone, business_address: input.address, service_codes: input.serviceCodes, vehicle_count: input.vehicleCount, primary_registration: input.registration, vehicle_capacity: input.capacity, years_in_operation: input.experience ?? null, availability: input.availability, notes: input.notes || null, document_names: input.documentNames }).select('reference,status,created_at').single()
  if (error) return response.status(500).json({ error: 'The partner application could not be saved.' })
  response.status(201).json({ ok: true, reference: data.reference, status: data.status, message: 'Your partnership request was received for review.' })
})

export default router
