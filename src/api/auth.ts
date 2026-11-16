import { apiFetch } from './client'
import { feedbackContent } from '../content/feedback'
import type { WorkspaceRole } from '../stores/navigationStore'

export type AuthResponse = { accessToken?: string; token?: string; user: { id?: string; username?: string; email?: string; name?: string; role?: WorkspaceRole } }
export type SignupResponse = { accessToken?: string; token?: string; requiresEmailVerification?: boolean; emailSent?: boolean; phoneOtpSent?: boolean; challengeId?: string; phoneChallengeId?: string | null; approvalPending?: boolean; userId?: string; user?: AuthResponse['user'] }
export type SignupVerificationResponse = { accessToken?: string; token?: string; approvalPending?: boolean; message?: string; user?: AuthResponse['user'] }
export const authApi = {
  login: (username: string, password: string) => apiFetch<AuthResponse>('/auth/login', { method: 'POST', successMessage: feedbackContent.success.signedIn, body: JSON.stringify(username.includes('@') ? { email: username, password } : { username, password }) }),
  signup: (payload: { email: string; password: string; name: string; phone: string; role: 'customer' | 'vendor' | 'admin'; businessName?: string; serviceZone?: string; latitude?: number; longitude?: number; selfieJpegBase64?: string }) => apiFetch<SignupResponse>('/auth/signup', { method: 'POST', body: JSON.stringify(payload) }),
  requestSignupEmailCode: (email: string) => apiFetch<{ challengeId: string }>('/auth/email/request-otp', { method: 'POST', silent: true, body: JSON.stringify({ email }) }),
  verifySignupEmail: (payload: { email: string; challengeId: string; otp: string; name: string; phone?: string; phoneChallengeId?: string; phoneOtp?: string }) => apiFetch<SignupVerificationResponse>('/auth/email/verify-otp', { method: 'POST', silent: true, body: JSON.stringify(payload) }),
  passwordReset: (email: string) => apiFetch<{ accepted: boolean }>('/auth/password-reset', { method: 'POST', body: JSON.stringify({ email }) }),
  passwordUpdate: (accessToken: string, password: string) => apiFetch<{ updated: boolean }>('/auth/password-update', { method: 'POST', body: JSON.stringify({ accessToken, password }) }),
  refresh: () => apiFetch<AuthResponse>('/auth/refresh', { method: 'POST', silent: true }),
  logout: () => apiFetch<void>('/auth/logout', { method: 'POST', silent: true }),
}
