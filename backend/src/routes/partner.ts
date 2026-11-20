import { Router, type Response } from 'express'
import { z } from 'zod'
import rateLimit from 'express-rate-limit'
import crypto from 'node:crypto'
import { supabase } from '../supabase.js'
import { limiterStore } from '../services/scaling.js'
import { config } from '../config.js'
import { toE164IndianMobile } from '../lib/phone.js'
import { logger } from '../lib/logger.js'
import { optionalAuth } from '../middleware/auth.js'
import { isPhoneVerificationRequired, isPhoneVerified } from '../services/phoneVerification.js'

const router = Router()
const partnerApplicationLimit = rateLimit({ windowMs: 60 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false, store: limiterStore('rl:partner:', 'open'), passOnStoreError: true, message: { error: 'Too many partner applications from this address. Try again later.' } })
const partnerDocumentUploadLimit = rateLimit({ windowMs: 60 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false, store: limiterStore('rl:partner-upload:', 'open'), passOnStoreError: true, message: { error: 'Too many document uploads from this address. Try again later.' } })
const phone = z.string().regex(/^\d{10}$/, 'Enter a valid 10-digit phone number.')
const allowedServices = z.enum(['Water tanker', 'Sewage suction', 'Drinking water supply', 'Tank and sump cleaning', 'Borewell services', 'RMC mix / ready-mix concrete', 'Empty tanker and bulk-liquid transport', 'Emergency water and sewage'])
const partnerDocumentPrefix = 'partner-applications/'
const partnerDocumentPath = z.string().trim().min(1).max(300).regex(/^[A-Za-z0-9][A-Za-z0-9._/-]*$/).refine((path) => path.startsWith(partnerDocumentPrefix) && !path.includes('..'), { message: 'Document path is not allowed.' })
const partnerDocumentContentType = z.enum(['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
const partnerDocumentExtensions: Record<z.infer<typeof partnerDocumentContentType>, readonly string[]> = {
  'application/pdf': ['pdf'],
  'image/jpeg': ['jpg', 'jpeg'],
  'image/png': ['png'],
  'image/webp': ['webp'],
  'application/msword': ['doc'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['docx'],
}
const partnerDocumentBucket = 'urban-tanker-documents'
const maxPartnerDocumentBytes = 10 * 1024 * 1024
const applicationSchema = z.object({
  businessName: z.string().trim().min(2).max(120),
  partnerType: z.string().trim().min(2).max(60),
  phone,
  phoneChallengeId: z.string().uuid().optional(),
  uploadBatchId: z.string().uuid().optional(),
  whatsapp: phone.optional().or(z.literal('')),
  email: z.string().trim().email().max(160),
  zone: z.string().trim().min(2).max(120),
  address: z.string().trim().min(5).max(500),
  serviceCodes: z.array(allowedServices).min(1).max(8),
  vehicleCount: z.number().int().min(1).max(250),
  registration: z.string().trim().min(3).max(40),
  capacity: z.string().trim().min(2).max(40),
  experience: z.number().int().min(0).max(75).optional(),
  availability: z.string().trim().min(2).max(80),
  notes: z.string().trim().max(2000).optional(),
  documentNames: z.array(z.string().trim().min(1).max(180)).max(10).default([]),
  documents: z.array(z.object({ path: partnerDocumentPath, type: z.string().trim().min(1).max(100) })).max(10).optional(),
  vehicles: z.array(z.object({
    registrationNumber: z.string().trim().min(3).max(40),
    vehicleType: z.string().trim().min(2).max(60),
    serviceCategory: allowedServices,
    capacity: z.string().trim().min(2).max(40),
    availability: z.string().trim().min(2).max(80),
    documents: z.array(z.object({ path: partnerDocumentPath, type: z.string().trim().min(1).max(100) })).max(10).default([]),
  })).min(1).max(250).optional(),
}).superRefine((value, context) => {
  if (!value.vehicles) return
  if (value.vehicles.length !== value.vehicleCount) {
    context.addIssue({ code: 'custom', path: ['vehicles'], message: 'Provide details for every registered vehicle.' })
  }
  const registrations = new Set<string>()
  value.vehicles.forEach((vehicle, index) => {
    const registration = vehicle.registrationNumber.toUpperCase().replace(/[^A-Z0-9]/g, '')
    if (registrations.has(registration)) {
      context.addIssue({ code: 'custom', path: ['vehicles', index, 'registrationNumber'], message: 'Vehicle registrations must be unique.' })
    }
    registrations.add(registration)
    if (!value.serviceCodes.includes(vehicle.serviceCategory)) {
      context.addIssue({ code: 'custom', path: ['vehicles', index, 'serviceCategory'], message: 'Vehicle services must be selected for the application.' })
    }
    const applicationDocuments = new Set((value.documents ?? []).map((document) => document.path))
    if (vehicle.documents.some((document) => !applicationDocuments.has(document.path))) {
      context.addIssue({ code: 'custom', path: ['vehicles', index, 'documents'], message: 'Vehicle documents must be included with the application.' })
    }
  })
})

function phoneVerificationAuth(request: Parameters<typeof optionalAuth>[0], response: Parameters<typeof optionalAuth>[1], next: Parameters<typeof optionalAuth>[2]) {
  if (!isPhoneVerificationRequired()) return next()
  return optionalAuth(request, response, next)
}

function reference() { return `PA-${crypto.randomUUID().slice(0, 8).toUpperCase()}` }
async function hasRecentVerifiedPhoneChallenge(response: Response, challengeId: string | undefined, phone: string): Promise<boolean | null> {
  const phoneE164 = toE164IndianMobile(phone)
  if (!challengeId || !phoneE164) return false
  const { data, error } = await supabase
    .from('guest_otp_challenges')
    .select('id')
    .eq('id', challengeId)
    .eq('phone_e164', phoneE164)
    .is('user_id', null)
    .not('verified_at', 'is', null)
    .gt('expires_at', new Date().toISOString())
    .maybeSingle()
  if (error) {
    logger.error('partner.application_otp_check_failed', { requestId: response.locals.requestId, error: error.message })
    response.status(500).json({ error: 'Mobile verification could not be confirmed. Please try again.' })
    return null
  }
  return Boolean(data)
}

function partnerDocumentName(path: string) {
  const fileName = path.split('/').pop() ?? path
  return fileName.replace(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}-/i, '')
}

router.post('/documents/signed-url', partnerDocumentUploadLimit, async (request, response) => {
  if (!config.featureFlags.partner_application_otp_enabled) return response.status(404).json({ error: 'Partner document uploads are disabled.' })
  const parsed = z.object({
    uploadBatchId: z.string().uuid(),
    phoneChallengeId: z.string().uuid(),
    phone,
    fileName: z.string().trim().min(1).max(180),
    contentType: partnerDocumentContentType,
    size: z.number().int().positive().max(maxPartnerDocumentBytes),
  }).safeParse(request.body)
  if (!parsed.success) return response.status(400).json({ error: 'Upload an allowed document type up to 10 MB.' })
  const phoneVerified = await hasRecentVerifiedPhoneChallenge(response, parsed.data.phoneChallengeId, parsed.data.phone)
  if (phoneVerified === null) return
  if (!phoneVerified) return response.status(400).json({ error: 'Verify your mobile number before uploading documents.' })

  const fileName = parsed.data.fileName.split(/[\\/]/).pop() ?? ''
  const extension = fileName.toLowerCase().split('.').pop() ?? ''
  if (!partnerDocumentExtensions[parsed.data.contentType].includes(extension) || fileName === extension) {
    return response.status(400).json({ error: 'The document type does not match its file extension.' })
  }
  const stem = fileName.slice(0, -(extension.length + 1)).replace(/[^A-Za-z0-9_-]/g, '-').replace(/-+/g, '-').slice(0, 80) || 'document'
  const path = `${partnerDocumentPrefix}${parsed.data.uploadBatchId}/${crypto.randomUUID()}-${stem}.${extension}`
  const { data: signed, error: signedError } = await supabase.storage.from(partnerDocumentBucket).createSignedUploadUrl(path)
  if (signedError || !signed) {
    logger.error('partner.document_upload_sign_failed', { requestId: response.locals.requestId, error: signedError?.message })
    return response.status(500).json({ error: 'The document upload could not be prepared. Please try again.' })
  }
  const { error: recordError } = await supabase.from('documents').insert({
    owner_type: 'partner_application_upload',
    owner_id: parsed.data.uploadBatchId,
    document_type: parsed.data.contentType,
    object_key: path,
    verification: 'pending',
  })
  if (recordError) {
    logger.error('partner.document_upload_record_failed', { requestId: response.locals.requestId, error: recordError.message })
    return response.status(500).json({ error: 'The document upload could not be recorded. Please try again.' })
  }
  response.json({ path, token: signed.token, signedUrl: signed.signedUrl, contentType: parsed.data.contentType, maxBytes: maxPartnerDocumentBytes })
})

router.post('/applications', partnerApplicationLimit, phoneVerificationAuth, async (request, response) => {
  if (request.authUser && isPhoneVerificationRequired()) {
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('phone_verified,phone_verified_at')
      .eq('id', request.authUser.id)
      .maybeSingle()
    if (profileError) {
      logger.error('partner.application_phone_verification_lookup_failed', { requestId: response.locals.requestId, error: profileError.message })
      return response.status(500).json({ error: 'Account phone verification could not be checked. Please try again.' })
    }
    if (!profile || !isPhoneVerified(profile)) {
      return response.status(403).json({
        code: 'PHONE_NOT_VERIFIED',
        error: 'Verify your account phone number before submitting a partner application.',
      })
    }
  }
  const parsed = applicationSchema.safeParse(request.body)
  if (!parsed.success) return response.status(400).json({ error: 'Complete the required partner application fields.', details: parsed.error.flatten() })
  const input = parsed.data
  if (config.featureFlags.partner_application_otp_enabled) {
    const phoneVerified = await hasRecentVerifiedPhoneChallenge(response, input.phoneChallengeId, input.phone)
    if (phoneVerified === null) return
    if (!phoneVerified) return response.status(400).json({ error: 'Verify your mobile number before submitting the application.' })
  }
  const { data: activeApplication, error: duplicateCheckError } = await supabase
    .from('partner_applications')
    .select('id')
    .eq('phone_e164', input.phone)
    .in('status', ['submitted', 'under_review', 'additional_info_required', 'approved'])
    .maybeSingle()
  if (duplicateCheckError) {
    logger.error('partner.application_duplicate_check_failed', { requestId: response.locals.requestId, error: duplicateCheckError.message })
    return response.status(500).json({ error: 'The application could not be checked for an existing registration. Please try again.' })
  }
  if (activeApplication) {
    return response.status(409).json({ error: 'An active application already exists for this mobile number. Contact support if you need to update it.' })
  }
  const documents = input.documents ?? []
  if (config.featureFlags.partner_application_otp_enabled && documents.length > 0) {
    if (!input.uploadBatchId || documents.some((document) => !document.path.startsWith(`${partnerDocumentPrefix}${input.uploadBatchId}/`))) {
      return response.status(400).json({ error: 'The uploaded documents could not be matched to this application.' })
    }
    const { data: uploads, error: uploadsError } = await supabase
      .from('documents')
      .select('object_key,document_type')
      .eq('owner_type', 'partner_application_upload')
      .eq('owner_id', input.uploadBatchId)
      .in('object_key', documents.map((document) => document.path))
    if (uploadsError) {
      logger.error('partner.document_upload_lookup_failed', { requestId: response.locals.requestId, error: uploadsError.message })
      return response.status(500).json({ error: 'The uploaded documents could not be confirmed. Please try again.' })
    }
    const registeredTypes = new Map((uploads ?? []).map((upload) => [upload.object_key, upload.document_type]))
    if (documents.some((document) => registeredTypes.get(document.path) !== document.type)) {
      return response.status(400).json({ error: 'The uploaded documents could not be matched to this application.' })
    }
  }
  const { data, error } = await supabase.from('partner_applications').insert({ reference: reference(), business_name: input.businessName, partner_type: input.partnerType, phone_e164: input.phone, whatsapp_e164: input.whatsapp || null, email: input.email, service_zone: input.zone, business_address: input.address, service_codes: input.serviceCodes, vehicle_count: input.vehicleCount, primary_registration: input.registration, vehicle_capacity: input.capacity, vehicle_details: input.vehicles ?? [], years_in_operation: input.experience ?? null, availability: input.availability, notes: input.notes || null, document_names: [...input.documentNames, ...documents.map((document) => partnerDocumentName(document.path))] }).select('id,reference,status,created_at').single()
  if (error) return response.status(500).json({ error: 'The partner application could not be saved.' })
  if (config.featureFlags.partner_application_otp_enabled && input.uploadBatchId && documents.length > 0) {
    const { error: attachError } = await supabase
      .from('documents')
      .update({ owner_type: 'partner_application', owner_id: data.id })
      .eq('owner_type', 'partner_application_upload')
      .eq('owner_id', input.uploadBatchId)
      .in('object_key', documents.map((document) => document.path))
    if (attachError) {
      logger.error('partner.document_upload_attach_failed', { requestId: response.locals.requestId, error: attachError.message })
      const { error: rollbackError } = await supabase.from('partner_applications').delete().eq('id', data.id)
      if (rollbackError) logger.error('partner.application_rollback_failed', { requestId: response.locals.requestId, error: rollbackError.message })
      return response.status(500).json({ error: 'The application documents could not be attached. Please try again.' })
    }
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
        event_type: 'partner.application_submitted',
        title: 'New partner application',
        payload: {
          applicationId: data.id,
          reference: data.reference,
          status: data.status,
        },
      })),
    )
    if (!notificationError) {
      notificationStatus = 'created'
    } else {
      logger.error('partner.application_notification_failed', {
        requestId: response.locals.requestId,
        applicationId: data.id,
        databaseErrorCode: notificationError.code,
      })
    }
  } else {
    logger.error('partner.application_admin_lookup_failed', {
      requestId: response.locals.requestId,
      applicationId: data.id,
      reason: adminsError ? 'admin_lookup_failed' : 'no_admin_recipients',
      databaseErrorCode: adminsError?.code,
    })
  }
  response.status(201).json({ ok: true, reference: data.reference, status: data.status, notificationStatus, message: 'Your partnership request was received for review.' })
})

export default router
