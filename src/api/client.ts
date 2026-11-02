import { useAuthStore } from '../stores/authStore'
import { useServerStatusStore } from '../stores/serverStatusStore'

export class ApiError extends Error {
  status: number
  constructor(message: string, status: number) { super(message); this.name = 'ApiError'; this.status = status }
}

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '/api'
const REQUEST_TIMEOUT_MS = 12_000
// Render's free tier sleeps between requests, so the first call after a sleep can fail or be slow. Only idempotent GETs are retried.
const MAX_GET_ATTEMPTS = 3
const RETRY_BASE_DELAY_MS = 800
// A request still pending after this long shows the "waking up the server" notice.
const SLOW_REQUEST_MS = 3_000
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
        const response = await fetch(`${API_BASE_URL}/auth/refresh`, {
          method: 'POST',
          credentials: 'include',
          signal: timed.signal,
        })
        if (!response.ok) return null
        const body = await response.json() as { accessToken?: string; token?: string }
        const token = body.accessToken ?? body.token
        if (!token) return null
        useAuthStore.getState().setAccessToken(token)
        return token
      } finally {
        timed.dispose()
      }
    })().finally(() => { refreshInFlight = null })
  }
  return refreshInFlight
}

function isNetworkFailure(error: unknown) {
  if (error instanceof ApiError) return false
  return error instanceof TypeError || (error instanceof DOMException && error.name === 'TimeoutError')
}

function waitBeforeRetry(delayMs: number, signal?: AbortSignal | null) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason)
    const onAbort = () => {
      window.clearTimeout(timer)
      reject(signal?.reason)
    }
    const timer = window.setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, delayMs)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

export async function apiFetch<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
  const isIdempotent = (init.method ?? 'GET').toUpperCase() === 'GET'
  let slow = false
  const slowTimer = window.setTimeout(() => {
    slow = true
    useServerStatusStore.getState().markSlow()
  }, SLOW_REQUEST_MS)
  try {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await apiFetchOnce<T>(path, init, retry)
      } catch (error) {
        const canRetry = isIdempotent && attempt < MAX_GET_ATTEMPTS && isNetworkFailure(error) && !init.signal?.aborted
        if (!canRetry) throw error
        await waitBeforeRetry(RETRY_BASE_DELAY_MS * 2 ** (attempt - 1), init.signal)
      }
    }
  } finally {
    window.clearTimeout(slowTimer)
    if (slow) useServerStatusStore.getState().markSettled()
  }
}

async function apiFetchOnce<T>(path: string, init: RequestInit, retry: boolean): Promise<T> {
  const timed = createTimedSignal(init.signal)
  try {
    const headers = new Headers(init.headers)
    if (typeof init.body === 'string' && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
    const authorization = authHeaders().Authorization
    if (authorization && !headers.has('Authorization')) headers.set('Authorization', authorization)
    const response = await fetch(`${API_BASE_URL}${path}`, { ...init, headers, credentials: 'include', signal: timed.signal })
    if (response.status === 401 && retry && !path.startsWith('/auth/')) {
      try {
        if (await refreshSession()) return await apiFetchOnce<T>(path, init, false)
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
