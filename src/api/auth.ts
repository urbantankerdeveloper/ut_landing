import { apiFetch } from './client'
import type { WorkspaceRole } from '../stores/navigationStore'

export type AuthResponse = { accessToken?: string; token?: string; refreshToken?: string; user: { id?: string; username?: string; email?: string; name?: string; role?: WorkspaceRole } }
export type SignupResponse = { accessToken?: string; token?: string; refreshToken?: string; requiresEmailVerification?: boolean; emailSent?: boolean; userId?: string; user?: AuthResponse['user'] }
export const authApi = {
  login: (username: string, password: string) => apiFetch<AuthResponse>('/auth/login', { method: 'POST', body: JSON.stringify(username.includes('@') ? { email: username, password } : { username, password }) }),
  signup: (payload: { email: string; password: string; name: string; phone: string; role: 'customer' | 'vendor' | 'admin'; adminKey?: string; selfieJpegBase64?: string }) => apiFetch<SignupResponse>('/auth/signup', { method: 'POST', body: JSON.stringify(payload) }),
  passwordReset: (email: string) => apiFetch<{ accepted: boolean }>('/auth/password-reset', { method: 'POST', body: JSON.stringify({ email }) }),
  passwordUpdate: (accessToken: string, password: string) => apiFetch<{ updated: boolean }>('/auth/password-update', { method: 'POST', body: JSON.stringify({ accessToken, password }) }),
  refresh: () => apiFetch<AuthResponse>('/auth/refresh', { method: 'POST' }),
  logout: () => apiFetch<void>('/auth/logout', { method: 'POST' }),
}
