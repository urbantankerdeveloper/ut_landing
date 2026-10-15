import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, apiFetch } from './client'
import { useAuthStore } from '../stores/authStore'

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
