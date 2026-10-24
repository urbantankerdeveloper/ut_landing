import { useAuthStore } from '../stores/authStore'

export class ApiError extends Error {
  status: number
  constructor(message: string, status: number) { super(message); this.name = 'ApiError'; this.status = status }
}

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '/api'

function authHeaders() {
  const token = useAuthStore.getState().accessToken
  return token ? { Authorization: `Bearer ${token}` } : {}
}

export async function apiFetch<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), 12_000)
  try {
    const headers = new Headers(init.headers)
    headers.set('Content-Type', 'application/json')
    const authorization = authHeaders().Authorization
    if (authorization) headers.set('Authorization', authorization)
    const response = await fetch(`${API_BASE_URL}${path}`, { ...init, headers, credentials: 'include', signal: init.signal ?? controller.signal })
    if (response.status === 401 && retry && path !== '/auth/refresh') {
      try {
        const refreshed = await fetch(`${API_BASE_URL}/auth/refresh`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' } })
        if (refreshed.ok) {
          const body = await refreshed.json() as { accessToken?: string; token?: string }
          const token = body.accessToken ?? body.token
          if (token) {
            useAuthStore.getState().setAccessToken(token)
            return apiFetch<T>(path, init, false)
          }
        }
      } catch { /* Let the original authorization error surface. */ }
    }
    if (!response.ok) {
      let message = `Request failed: ${response.status}`
      try {
        const body = await response.json() as { error?: unknown }
        if (typeof body.error === 'string' && body.error.trim()) message = body.error
      } catch {
        // Keep the HTTP status message when the server did not return JSON.
      }
      throw new ApiError(message, response.status)
    }
    if (response.status === 204) return undefined as T
    return response.json() as Promise<T>
  } finally { window.clearTimeout(timeout) }
}
