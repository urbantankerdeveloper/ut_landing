import { apiFetch } from './client'

export type AdminUserRecord = {
  id: string
  kind: 'admin' | 'request'
  name: string
  email: string
  phone_e164: string | null
  reason: string | null
  status: 'pending' | 'approved' | 'rejected'
  is_active: boolean | null
  requested_at: string
  reviewed_by: string | null
  reviewed_at: string | null
}

export const adminAccessApi = {
  submit: (payload: { name: string; email: string; phone: string; reason: string; phoneChallengeId: string }) =>
    apiFetch<{ accepted: boolean; message: string }>('/admin-access/requests', {
      method: 'POST',
      silent: true,
      body: JSON.stringify(payload),
    }),
  admins: () => apiFetch<AdminUserRecord[]>('/admin-access/admins', { silent: true }),
  review: (id: string, decision: 'approved' | 'rejected') =>
    apiFetch<{ id: string; status: string }>(`/admin-access/requests/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      silent: true,
      body: JSON.stringify({ decision }),
    }),
  setActive: (id: string, isActive: boolean) =>
    apiFetch<{ id: string; is_active: boolean }>(`/admin-access/admins/${encodeURIComponent(id)}/status`, {
      method: 'PATCH',
      silent: true,
      body: JSON.stringify({ isActive }),
    }),
}
