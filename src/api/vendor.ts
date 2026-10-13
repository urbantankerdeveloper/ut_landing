import { apiFetch } from './client'

export type VendorOrderStatus = 'Available' | 'Accepted' | 'En route' | 'Arrived' | 'Delivered' | 'Rejected'
export type VendorOrder = { id: string; service: string; location: string; distance: number; amount: string; status: VendorOrderStatus; vehicle?: string; driver?: string }
export type VendorDashboard = { orders: VendorOrder[]; vehicles: string[]; drivers: string[] }
export type VendorVehicle = { id: string; registration_number: string; capacity_litres?: number; is_active: boolean; verification: string }
export type VendorDriver = { id: string; name: string; mobile_e164: string; licence_number?: string; is_active: boolean; verification: string }
export type VendorComplaint = { id: string; subject: string; booking_id?: string; status: string; message: string; created_at: string }
export type VendorNotification = { id: string; title: string; detail?: string; event_type?: string; read_at?: string; created_at: string }
export type VendorDocument = { id: string; owner_type: string; owner_id: string; document_type: string; object_key: string; expires_on?: string; verification: string; created_at: string }
export type VendorOrderMutation = { orderId: string; action: 'accept' | 'reject' | 'status' | 'assign'; status?: VendorOrderStatus; vehicleId?: string; driverId?: string }

export const vendorApi = {
  dashboard: () => apiFetch<VendorDashboard>('/vendor/dashboard'),
  orders: () => apiFetch<VendorOrder[]>('/vendor/orders'),
  mutateOrder: (payload: VendorOrderMutation) => apiFetch<VendorOrder>(`/vendor/orders/${payload.orderId}/transition`, { method: 'PATCH', body: JSON.stringify(payload) }),
  vehicles: () => apiFetch<VendorVehicle[]>('/vendor/vehicles'),
  drivers: () => apiFetch<VendorDriver[]>('/vendor/drivers'),
  updateVehicle: (id: string, payload: { registrationNumber?: string; capacityLitres?: number; isActive?: boolean }) => apiFetch<VendorVehicle>(`/vendor/vehicles/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  updateDriver: (id: string, payload: { name?: string; mobileE164?: string; licenceNumber?: string; isActive?: boolean }) => apiFetch<VendorDriver>(`/vendor/drivers/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  attendance: (payload: { driverId: string; status: string; date: string }) => apiFetch<void>('/vendor/attendance', { method: 'POST', body: JSON.stringify(payload) }),
  location: (payload: { bookingId: string; latitude: number; longitude: number; accuracy?: number }) => apiFetch<unknown>('/vendor/location', { method: 'POST', body: JSON.stringify(payload) }),
  payouts: () => apiFetch<unknown[]>('/vendor/payouts'),
  services: () => apiFetch<unknown[]>('/vendor/services'),
  updateServiceAvailability: (code: string, enabled: boolean) => apiFetch<unknown>(`/vendor/services/${code}/availability`, { method: 'PATCH', body: JSON.stringify({ enabled }) }),
  complaints: () => apiFetch<VendorComplaint[]>('/vendor/complaints'),
  createComplaint: (payload: { subject: string; bookingId: string; message: string }) => apiFetch<VendorComplaint>('/vendor/complaints', { method: 'POST', body: JSON.stringify(payload) }),
  resolveComplaint: (id: string, payload: { status: string; resolution: string }) => apiFetch<VendorComplaint>(`/vendor/complaints/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  documents: () => apiFetch<VendorDocument[]>('/vendor/documents'),
  createDocument: (payload: { documentType: string; objectKey: string; expiresOn?: string }) => apiFetch<VendorDocument>('/vendor/documents', { method: 'POST', body: JSON.stringify(payload) }),
  updateDocument: (id: string, payload: { expiresOn?: string; verification?: 'pending' | 'approved' | 'rejected' }) => apiFetch<VendorDocument>(`/vendor/documents/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  requestPayout: (payload: { amount: number; periodStart?: string; periodEnd?: string }) => apiFetch<unknown>('/vendor/payouts/request', { method: 'POST', body: JSON.stringify(payload) }),
  notifications: () => apiFetch<VendorNotification[]>('/vendor/notifications'),
  markNotificationRead: (id: string) => apiFetch<unknown>(`/vendor/notifications/${id}/read`, { method: 'PATCH' }),
  verifyDelivery: async (id: string, payload: { otp: string; proofPath?: string }) => { const result = await apiFetch<VendorOrder>(`/vendor/orders/${id}/delivery/verify`, { method: 'POST', body: JSON.stringify(payload) }); await apiFetch<void>(`/vendor/orders/${id}/delivery/realtime`, { method: 'POST' }); return result },
}
