import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, apiFetch } from './client'
import { useAuthStore } from '../stores/authStore'
import { useServerStatusStore } from '../stores/serverStatusStore'
import { useToastStore } from '../stores/toastStore'
import { feedbackContent } from '../content/feedback'

describe('apiFetch', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.stubGlobal('window', globalThis)
    vi.stubGlobal('sessionStorage', {
      getItem: vi.fn(),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    })
    useAuthStore.setState({ user: null, accessToken: null })
  })

  it('refreshes an expired session and retries the original request', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ accessToken: 'refreshed-token' }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(apiFetch<{ ok: boolean }>('/customer/profile')).resolves.toEqual({ ok: true })
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(useAuthStore.getState().accessToken).toBe('refreshed-token')
  })

  it('exposes the response status through ApiError', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 422 })))

    await expect(apiFetch('/customer/profile')).rejects.toMatchObject(new ApiError('Request failed: 422', 422))
  })

  it('surfaces the backend error message', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'Email confirmation is unavailable.' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    })))

    await expect(apiFetch('/auth/signup')).rejects.toMatchObject(new ApiError('Email confirmation is unavailable.', 503, 'Email confirmation is unavailable.'))
  })

  it('adds the in-memory access token and preserves request options', async () => {
    useAuthStore.getState().setAccessToken('access-token')
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(apiFetch<{ ok: boolean }>('/customer/profile', {
      method: 'POST',
      body: JSON.stringify({ include: 'summary' }),
    })).resolves.toEqual({ ok: true })

    expect(fetchMock).toHaveBeenCalledWith('/api/customer/profile', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ include: 'summary' }),
      credentials: 'include',
    }))
    const requestHeaders = fetchMock.mock.calls[0][1].headers as Headers
    expect(requestHeaders.get('Authorization')).toBe('Bearer access-token')
    expect(requestHeaders.get('Content-Type')).toBe('application/json')
  })

  it('returns undefined for successful no-content responses', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 204 })))

    await expect(apiFetch('/customer/profile', { method: 'DELETE' })).resolves.toBeUndefined()
  })
})

describe('apiFetch retries and slow requests', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.stubGlobal('window', globalThis)
    useAuthStore.setState({ user: null, accessToken: null })
    useServerStatusStore.setState({ slowRequests: 0 })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('retries an idempotent GET after a network failure', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)

    const request = apiFetch<{ ok: boolean }>('/customer/profile')
    await vi.runAllTimersAsync()

    await expect(request).resolves.toEqual({ ok: true })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('gives up on a GET after three attempts', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
    vi.stubGlobal('fetch', fetchMock)

    const request = apiFetch('/customer/profile')
    const assertion = expect(request).rejects.toThrow(TypeError)
    await vi.runAllTimersAsync()

    await assertion
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('does not retry a POST after a network failure', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
    vi.stubGlobal('fetch', fetchMock)

    await expect(apiFetch('/customer/bookings', { method: 'POST', body: '{}' })).rejects.toThrow(TypeError)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('does not retry an HTTP error response', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 503 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(apiFetch('/customer/profile')).rejects.toMatchObject(new ApiError('Request failed: 503', 503))
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('flags a request that is still pending after three seconds, then clears it', async () => {
    vi.useFakeTimers()
    let resolveFetch: (response: Response) => void = () => undefined
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => { resolveFetch = resolve })))

    const request = apiFetch<{ ok: boolean }>('/customer/profile')
    await vi.advanceTimersByTimeAsync(2_999)
    expect(useServerStatusStore.getState().slowRequests).toBe(0)
    await vi.advanceTimersByTimeAsync(1)
    expect(useServerStatusStore.getState().slowRequests).toBe(1)

    resolveFetch(new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    await expect(request).resolves.toEqual({ ok: true })
    expect(useServerStatusStore.getState().slowRequests).toBe(0)
  })

  it('confirms successful writes with a toast and keeps reads quiet', async () => {
    useToastStore.setState({ toasts: [] })
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } }))))

    await apiFetch('/customer/profile')
    expect(useToastStore.getState().toasts).toHaveLength(0)

    await apiFetch('/customer/profile', { method: 'PATCH', body: '{}', successMessage: 'Profile updated for test.' })
    expect(useToastStore.getState().toasts.map((toast) => toast.message)).toEqual(['Profile updated for test.'])
  })

  it('uses a custom success message and skips the toast when silent', async () => {
    useToastStore.setState({ toasts: [] })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 204 })))

    await apiFetch('/auth/logout', { method: 'POST', silent: true })
    expect(useToastStore.getState().toasts).toHaveLength(0)

    await apiFetch('/auth/password-reset', { method: 'POST', successMessage: feedbackContent.success.passwordSent })
    expect(useToastStore.getState().toasts[0].message).toBe(feedbackContent.success.passwordSent)
  })
})
