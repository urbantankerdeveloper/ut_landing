import { apiFetch } from './client'

export type PartnerApplicationInput = {
  businessName: string
  partnerType: string
  phone: string
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
  documentNames: string[]
}

export type PartnerApplicationResponse = { ok: true; reference: string; status: string; message: string }

export const partnerApi = {
  apply: (payload: PartnerApplicationInput) => apiFetch<PartnerApplicationResponse>('/partner/applications', { method: 'POST', body: JSON.stringify(payload) }),
}
