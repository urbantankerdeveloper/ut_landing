import { apiFetch } from './client'

export type PartnerApplicationInput = {
  businessName: string
  partnerType: string
  phone: string
  phoneChallengeId?: string
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
  notes?: string
  documents?: PartnerDocument[]
}

export type PartnerDocument = { path: string; type: string }

export type PartnerApplicationResponse = { ok: true; reference: string; status: string; message: string }

export const partnerApi = {
  requestPhoneOtp: (phone: string) => apiFetch<{ challengeId: string; expiresInSeconds: number }>('/auth/partner/request-otp', { method: 'POST', body: JSON.stringify({ phone }) }),
  verifyPhoneOtp: (payload: { challengeId: string; phone: string; otp: string }) => apiFetch<{ verified: boolean }>('/auth/partner/verify-otp', { method: 'POST', body: JSON.stringify(payload) }),
  apply: (payload: PartnerApplicationInput) => apiFetch<PartnerApplicationResponse>('/partner/applications', { method: 'POST', body: JSON.stringify(payload) }),
}
