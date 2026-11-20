import { apiFetch } from './client'
import { feedbackContent } from '../content/feedback'
import type { WorkspaceRole } from '../stores/navigationStore'

export type AuthUser = { id?: string; username: string; email?: string; name: string; role: WorkspaceRole; phone?: string; phoneVerified?: boolean; themeMode?: string; selfieRequired?: boolean }
export type AuthResponse = { accessToken?: string; token?: string; user: AuthUser }
export type PhoneVerifyChallenge = { challengeId: string; channel: 'whatsapp' | 'sms'; expiresInSeconds: number; resendAfterSeconds: number }
export type PhoneVerifyResult = { verified: true; phone: string; phoneVerified: true; challengeId: string }
export type SignupResponse = { accessToken?: string; token?: string; requiresEmailVerification?: boolean; emailSent?: boolean; phoneOtpSent?: boolean; phoneOtpChannel?: 'whatsapp' | 'sms' | null; challengeId?: string; phoneChallengeId?: string | null; approvalPending?: boolean; userId?: string; user?: AuthResponse['user'] }
export type SignupVerificationResponse = { accessToken?: string; token?: string; approvalPending?: boolean; message?: string; user?: AuthResponse['user'] }
export const authApi = {
  login: (username: string, password: string) => apiFetch<AuthResponse>('/auth/login', { method: 'POST', successMessage: feedbackContent.success.signedIn, body: JSON.stringify(username.includes('@') ? { email: username, password } : { username, password }) }),
  me: () => apiFetch<AuthResponse>('/auth/me', { method: 'GET', silent: true }),
  requestPhoneVerification: (phone: string) => apiFetch<PhoneVerifyChallenge>('/auth/phone/verify/request', { method: 'POST', silent: true, body: JSON.stringify({ phone }) }),
  confirmPhoneVerification: (phone: string, code: string) => apiFetch<PhoneVerifyResult>('/auth/phone/verify/confirm', { method: 'POST', silent: true, body: JSON.stringify({ phone, code }) }),
  signup: (payload: { email: string; password: string; name: string; phone: string; role: 'customer' | 'vendor' | 'admin'; businessName?: string; serviceZone?: string; latitude?: number; longitude?: number; selfieJpegBase64?: string }) => apiFetch<SignupResponse>('/auth/signup', { method: 'POST', body: JSON.stringify(payload) }),
  requestSignupEmailCode: (email: string) => apiFetch<{ challengeId: string }>('/auth/email/request-otp', { method: 'POST', silent: true, body: JSON.stringify({ email }) }),
  verifySignupEmail: (payload: { email: string; challengeId: string; otp: string; name: string; phone?: string; phoneChallengeId?: string; phoneOtp?: string }) => apiFetch<SignupVerificationResponse>('/auth/email/verify-otp', { method: 'POST', silent: true, body: JSON.stringify(payload) }),
  passwordReset: (email: string) => apiFetch<{ accepted: boolean }>('/auth/password-reset', { method: 'POST', body: JSON.stringify({ email }) }),
  passwordUpdate: (accessToken: string, password: string) => apiFetch<{ updated: boolean }>('/auth/password-update', { method: 'POST', body: JSON.stringify({ accessToken, password }) }),
  refresh: () => apiFetch<AuthResponse>('/auth/refresh', { method: 'POST', silent: true }),
  logout: () => apiFetch<void>('/auth/logout', { method: 'POST', silent: true }),
}
