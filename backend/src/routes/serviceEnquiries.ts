import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import { z } from 'zod'
import { logger } from '../lib/logger.js'
import { toE164IndianMobile } from '../lib/phone.js'
import { limiterStore } from '../services/scaling.js'
import { emitRealtimeToAdmins } from '../services/realtime.js'
import { supabase } from '../supabase.js'

const router = Router()
const submissionLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  store: limiterStore('rl:service-enquiries:', 'open'),
  passOnStoreError: true,
  message: { error: 'Too many service enquiries. Try again later.' },
})

const contact = {
  customerName: z.string().trim().min(2).max(120),
  mobile: z.string().regex(/^[6-9]\d{9}$/, 'Enter a valid 10-digit mobile number.'),
  email: z.string().trim().email().max(160).optional().or(z.literal('')),
  location: z.string().trim().min(5).max(500),
  requiredDate: z.string().date(),
}

const enquirySchema = z.discriminatedUnion('serviceCategory', [
  z.object({
    ...contact,
    serviceCategory: z.literal('empty_tanker'),
    details: z.object({
      capacityLitres: z.number().int().min(1000).max(50000),
      requirements: z.string().trim().min(2).max(2000),
    }),
  }),
  z.object({
    ...contact,
    serviceCategory: z.literal('rmc'),
    details: z.object({
      grade: z.string().trim().min(2).max(40),
      quantityCubicMetres: z.number().positive().max(10000),
      pumpRequired: z.boolean(),
      requirements: z.string().trim().max(2000).optional(),
    }),
  }),
  z.object({
    ...contact,
    serviceCategory: z.literal('borewell'),
    details: z.object({
      proposedDepthMetres: z.number().positive().max(1000),
      siteRequirements: z.string().trim().min(2).max(2000),
    }),
  }),
]).refine(
  (value) => value.requiredDate >= new Date().toISOString().slice(0, 10),
  { message: 'Choose a date that is today or later.', path: ['requiredDate'] },
)

const serviceTitles = {
  empty_tanker: 'Empty tanker',
  rmc: 'RMC concrete mixer',
  borewell: 'Borewell services',
} as const

const detailLabels: Record<string, string> = {
  capacityLitres: 'Tanker capacity (litres)',
  requirements: 'Service requirements',
  grade: 'Concrete grade',
  quantityCubicMetres: 'Concrete quantity (m³)',
  pumpRequired: 'Concrete pump',
  proposedDepthMetres: 'Proposed depth (metres)',
  siteRequirements: 'Site requirements',
}

router.post('/', submissionLimit, async (request, response) => {
  const parsed = enquirySchema.safeParse(request.body)
  if (!parsed.success) {
    return response.status(400).json({
      error: 'Check the enquiry details and try again.',
      details: parsed.error.flatten(),
    })
  }

  const enquiry = parsed.data
  const serviceTitle = serviceTitles[enquiry.serviceCategory]
  const phoneE164 = toE164IndianMobile(enquiry.mobile)
  if (!phoneE164) return response.status(400).json({ error: 'Enter a valid mobile number.' })

  const message = [
    `Customer: ${enquiry.customerName}`,
    `Mobile: ${phoneE164}`,
    ...(enquiry.email ? [`Email: ${enquiry.email}`] : []),
    `Location: ${enquiry.location}`,
    `Required date: ${enquiry.requiredDate}`,
    ...Object.entries(enquiry.details).map(([key, value]) => {
      const formatted = typeof value === 'boolean' ? (value ? 'Yes' : 'No') : String(value)
      return `${detailLabels[key] ?? key}: ${formatted}`
    }),
  ].join('\n')

  const { data: created, error } = await supabase
    .from('enquiries')
    .insert({
      subject: `${serviceTitle} enquiry`,
      message,
      status: 'new',
      customer_name: enquiry.customerName,
      mobile_e164: phoneE164,
      email: enquiry.email || null,
      location: enquiry.location,
      service_category: enquiry.serviceCategory,
      required_date: enquiry.requiredDate,
      service_details: enquiry.details,
    })
    .select('id,subject,status,created_at')
    .single()

  if (error || !created) {
    logger.error('service_enquiry.create_failed', {
      requestId: response.locals.requestId,
      databaseErrorCode: error?.code,
    })
    return response.status(500).json({ error: 'The enquiry could not be saved. Please try again.' })
  }

  const { data: admins, error: adminsError } = await supabase
    .from('profiles')
    .select('id')
    .eq('role', 'admin')
  let notificationStatus: 'created' | 'unavailable' = 'unavailable'
  if (!adminsError && admins?.length) {
    const { error: notificationError } = await supabase.from('notifications').insert(
      admins.map((admin) => ({
        recipient_id: admin.id,
        event_type: 'enquiry.created',
        title: `New ${serviceTitle.toLowerCase()} enquiry`,
        payload: {
          enquiryId: created.id,
          serviceCategory: enquiry.serviceCategory,
          status: 'new',
        },
      })),
    )
    if (!notificationError) {
      notificationStatus = 'created'
      emitRealtimeToAdmins('enquiry.created', {
        enquiryId: created.id,
        serviceCategory: enquiry.serviceCategory,
        status: 'new',
      })
    } else {
      logger.error('service_enquiry.notification_failed', {
        requestId: response.locals.requestId,
        enquiryId: created.id,
        databaseErrorCode: notificationError.code,
      })
    }
  } else {
    logger.error('service_enquiry.admin_lookup_failed', {
      requestId: response.locals.requestId,
      enquiryId: created.id,
      reason: adminsError ? 'admin_lookup_failed' : 'no_admin_recipients',
      databaseErrorCode: adminsError?.code,
    })
  }

  return response.status(201).json({
    id: created.id,
    subject: created.subject,
    status: created.status,
    createdAt: created.created_at,
    notificationStatus,
  })
})

export default router
