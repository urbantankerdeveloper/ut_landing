import { apiFetch } from './client'

export type PartnerApplicationInput = {
  businessName: string
  partnerType: string
  phone: string
  phoneChallengeId?: string
  uploadBatchId?: string
  whatsapp?: string
  email: string
  zone: string
  address: string
  serviceCodes: string[]
  vehicleCount: number
  registration: string
  capacity: string
  experience?: number
  availability: string
  vehicles?: PartnerVehicleInput[]
  notes?: string
  documents?: PartnerDocument[]
}

export type PartnerDocument = { path: string; type: string }
export type PartnerVehicleInput = {
  registrationNumber: string
  vehicleType: string
  serviceCategory: string
  capacity: string
  availability: string
  documents: PartnerDocument[]
}
type PartnerSignedUpload = { path: string; signedUrl: string; token: string; contentType: string; maxBytes: number }

export type PartnerApplicationResponse = {
  ok: true
  reference: string
  status: string
  notificationStatus: 'created' | 'unavailable'
  message: string
}

const partnerDocumentTypes: Record<string, string> = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
}

export const partnerApi = {
  requestPhoneOtp: (phone: string) => apiFetch<{ challengeId: string; expiresInSeconds: number }>('/auth/partner/request-otp', { method: 'POST', body: JSON.stringify({ phone }) }),
  verifyPhoneOtp: (payload: { challengeId: string; phone: string; otp: string }) => apiFetch<{ verified: boolean }>('/auth/partner/verify-otp', { method: 'POST', body: JSON.stringify(payload) }),
  uploadDocument: async (
    file: File,
    uploadBatchId: string,
    phoneChallengeId: string,
    phone: string,
  ): Promise<PartnerDocument> => {
    if (file.size <= 0 || file.size > 10 * 1024 * 1024) throw new Error('Files must be non-empty and 10 MB or smaller.')
    const extension = file.name.toLowerCase().split('.').pop() ?? ''
    const contentType = file.type || partnerDocumentTypes[extension]
    if (!contentType || partnerDocumentTypes[extension] !== contentType) {
      throw new Error('Choose a supported PDF, image, DOC, or DOCX document.')
    }
    const signed = await apiFetch<PartnerSignedUpload>('/partner/documents/signed-url', {
      method: 'POST',
      body: JSON.stringify({ uploadBatchId, phoneChallengeId, phone, fileName: file.name, contentType, size: file.size }),
    })
    const response = await fetch(signed.signedUrl, {
      method: 'PUT',
      headers: { 'Content-Type': contentType, 'x-upsert': 'false' },
      body: file,
    })
    if (!response.ok) throw new Error('Document upload failed. Please try again.')
    return { path: signed.path, type: contentType }
  },
  apply: (payload: PartnerApplicationInput) => apiFetch<PartnerApplicationResponse>('/partner/applications', { method: 'POST', body: JSON.stringify(payload) }),
}
