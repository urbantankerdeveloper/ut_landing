import { apiFetch } from './client'
import type { WorkspaceRole } from '../stores/navigationStore'

export type AuthResponse = { accessToken?: string; token?: string; refreshToken?: string; user: { id?: string; username?: string; email?: string; name?: string; role?: WorkspaceRole } }
export type SignupResponse = { accessToken?: string; token?: string; refreshToken?: string; requiresEmailVerification?: boolean; userId?: string; user?: AuthResponse['user'] }
export const authApi = {
  login: (username: string, password: string) => apiFetch<AuthResponse>('/auth/login', { method: 'POST', body: JSON.stringify({ username, email: username, password }) }),
  signup: (payload: { email: string; password: string; name: string; phone: string; role: 'customer' | 'vendor' | 'admin'; adminKey?: string }) => apiFetch<SignupResponse>('/auth/signup', { method: 'POST', body: JSON.stringify(payload) }),
  refresh: () => apiFetch<AuthResponse>('/auth/refresh', { method: 'POST' }),
  logout: () => apiFetch<void>('/auth/logout', { method: 'POST' }),
}
