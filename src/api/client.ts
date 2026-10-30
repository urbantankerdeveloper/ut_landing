import { useAuthStore } from '../stores/authStore'

export class ApiError extends Error {
  status: number
  constructor(message: string, status: number) { super(message); this.name = 'ApiError'; this.status = status }
}

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '/api'
const REQUEST_TIMEOUT_MS = 12_000
let refreshInFlight: Promise<string | null> | null = null

function authHeaders() {
  const token = useAuthStore.getState().accessToken
  return token ? { Authorization: `Bearer ${token}` } : {}
}

function createTimedSignal(externalSignal?: AbortSignal | null) {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(new DOMException('Request timed out', 'TimeoutError')), REQUEST_TIMEOUT_MS)
  const relayAbort = () => controller.abort(externalSignal?.reason)
  if (externalSignal?.aborted) relayAbort()
  else externalSignal?.addEventListener('abort', relayAbort, { once: true })
  return {
    signal: controller.signal,
    dispose: () => {
      window.clearTimeout(timeout)
      externalSignal?.removeEventListener('abort', relayAbort)
    },
  }
}

async function refreshSession() {
  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      const timed = createTimedSignal()
      try {
        const refreshToken = useAuthStore.getState().refreshToken
        const response = await fetch(`${API_BASE_URL}/auth/refresh`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(refreshToken ? { refreshToken } : {}),
          signal: timed.signal,
        })
        if (!response.ok) return null
        const body = await response.json() as { accessToken?: string; token?: string; refreshToken?: string }
        const token = body.accessToken ?? body.token
        if (!token) return null
        useAuthStore.getState().setAccessToken(token)
        if (body.refreshToken) useAuthStore.getState().setRefreshToken(body.refreshToken)
        return token
      } finally {
        timed.dispose()
      }
    })().finally(() => { refreshInFlight = null })
  }
  return refreshInFlight
}

export async function apiFetch<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
  const timed = createTimedSignal(init.signal)
  try {
    const headers = new Headers(init.headers)
    if (typeof init.body === 'string' && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
    const authorization = authHeaders().Authorization
    if (authorization && !headers.has('Authorization')) headers.set('Authorization', authorization)
    const response = await fetch(`${API_BASE_URL}${path}`, { ...init, headers, credentials: 'include', signal: timed.signal })
    if (response.status === 401 && retry && path !== '/auth/refresh') {
      try {
        if (await refreshSession()) return await apiFetch<T>(path, init, false)
      } catch (error) {
        if (timed.signal.aborted) throw timed.signal.reason ?? error
        // Preserve the original authorization response if refresh fails.
      }
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
  } finally { timed.dispose() }
}
