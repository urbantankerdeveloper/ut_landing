import { apiFetch } from './client'

export type AdminOrder = { id: string; service: string; vendor?: string; location: string; status: string; amount: number }
export type AdminVendor = { id: string; name: string; status: string; rating?: number }
export type AdminResource = { id: string; name?: string; status?: string; verification?: string }
export type AdminReportRequest = { type: string; from: string; to: string; status?: string; service?: string }
export type AdminReportResponse = { rows: unknown[]; generatedAt: string; total: number }
export type AdminCoupon = { id: string; code: string; label: string; discount: string; expires: string; active: boolean }
export const adminApi = {
  orders: () => apiFetch<AdminOrder[]>('/admin/orders'),
  vendors: () => apiFetch<AdminVendor[]>('/admin/vendors'),
  approveVendor: (id: string, status: 'approved' | 'rejected' | 'suspended') => apiFetch<AdminVendor>(`/admin/vendors/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }),
  updateVehicleStatus: (id: string, verification: 'pending' | 'approved' | 'rejected' | 'suspended', isActive?: boolean) => apiFetch<AdminResource>(`/admin/vehicles/${id}/status`, { method: 'PATCH', body: JSON.stringify({ verification, isActive }) }),
  updateDriverStatus: (id: string, verification: 'pending' | 'approved' | 'rejected' | 'suspended', isActive?: boolean) => apiFetch<AdminResource>(`/admin/drivers/${id}/status`, { method: 'PATCH', body: JSON.stringify({ verification, isActive }) }),
  assignOrder: (id: string, payload: { vendorId?: string; vehicleId?: string; driverId?: string }) => apiFetch<AdminOrder>(`/admin/orders/${id}/assignment`, { method: 'PATCH', body: JSON.stringify(payload) }),
  report: (payload: AdminReportRequest) => apiFetch<AdminReportResponse>('/admin/reports', { method: 'POST', body: JSON.stringify(payload) }),
  coupons: () => apiFetch<AdminCoupon[]>('/admin/coupons'),
  saveCoupon: (payload: Omit<AdminCoupon, 'id'>, id?: string) => apiFetch<AdminCoupon>(id ? `/admin/coupons/${id}` : '/admin/coupons', { method: id ? 'PATCH' : 'POST', body: JSON.stringify(payload) }),
  deleteCoupon: (id: string) => apiFetch<void>(`/admin/coupons/${id}`, { method: 'DELETE' }),
  auditLogs: () => apiFetch<unknown[]>('/admin/audit-logs'),
  featureFlags: () => apiFetch<Record<string, boolean>>('/admin/feature-flags'),
}
