import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { authApi } from '../api/auth'
import { useAuthStore } from '../stores/authStore'
import { VendorRealtimeClient } from './realtime'

const socketHarness = vi.hoisted(() => {
  const handlers = new Map<string, (argument?: unknown) => void>()
  const socket = {
    active: false,
    connected: false,
    auth: null as unknown,
    on: vi.fn((event: string, handler: (argument?: unknown) => void) => {
      handlers.set(event, handler)
      return socket
    }),
    onAny: vi.fn(() => socket),
    emit: vi.fn(() => socket),
    connect: vi.fn(() => {
      socket.active = true
      return socket
    }),
    disconnect: vi.fn(() => {
      socket.active = false
      socket.connected = false
      return socket
    }),
  }
  const io = vi.fn(() => {
    socket.active = true
    return socket
  })
  return { handlers, socket, io }
})

vi.mock('socket.io-client', () => ({ io: socketHarness.io }))
vi.mock('../api/auth', () => ({ authApi: { refresh: vi.fn() } }))

const documentListeners = new Map<string, () => void>()
const browserDocument = {
  visibilityState: 'visible' as DocumentVisibilityState,
  addEventListener: vi.fn((event: string, listener: () => void) => documentListeners.set(event, listener)),
  removeEventListener: vi.fn((event: string) => documentListeners.delete(event)),
}
const browserWindow = {
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  setTimeout: (...args: Parameters<typeof globalThis.setTimeout>) => globalThis.setTimeout(...args),
  clearTimeout: (...args: Parameters<typeof globalThis.clearTimeout>) => globalThis.clearTimeout(...args),
}

describe('browser realtime connection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('VITE_SOCKET_TRANSPORTS', '')
    vi.stubGlobal('navigator', { onLine: true })
    vi.stubGlobal('window', browserWindow)
    vi.stubGlobal('document', browserDocument)
    documentListeners.clear()
    browserDocument.visibilityState = 'visible'
    socketHarness.socket.active = false
    socketHarness.socket.connected = false
    socketHarness.socket.auth = null
    socketHarness.handlers.clear()
    useAuthStore.setState({ user: null, accessToken: null })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('waits for an access token and defaults to polling without upgrades', async () => {
    const client = new VendorRealtimeClient('https://api.example.test', () => {})
    client.connect()
    expect(socketHarness.io).not.toHaveBeenCalled()

    useAuthStore.getState().setAccessToken('access-token')
    await vi.waitFor(() => expect(socketHarness.io).toHaveBeenCalledTimes(1))

    expect(socketHarness.io).toHaveBeenCalledWith('https://api.example.test', expect.objectContaining({
      transports: ['polling'],
      upgrade: false,
      reconnectionAttempts: 10,
      reconnectionDelayMax: 30_000,
    }))
    client.disconnect()
  })

  it('refreshes once after an auth error and reconnects with the refreshed token', async () => {
    useAuthStore.getState().setAccessToken('expired-token')
    vi.mocked(authApi.refresh).mockResolvedValue({
      accessToken: 'refreshed-token',
      user: { username: 'test', name: 'Test', role: 'customer' },
    })
    const client = new VendorRealtimeClient('https://api.example.test', () => {})
    client.connect()
    await vi.waitFor(() => expect(socketHarness.io).toHaveBeenCalledTimes(1))

    socketHarness.handlers.get('connect_error')?.(new Error('Invalid session'))
    await vi.waitFor(() => expect(authApi.refresh).toHaveBeenCalledTimes(1))
    await vi.waitFor(() => expect(useAuthStore.getState().accessToken).toBe('refreshed-token'))

    expect(socketHarness.socket.auth).toEqual({ token: 'refreshed-token' })
    expect(socketHarness.socket.connect).toHaveBeenCalledTimes(1)
    client.disconnect()
  })

  it('disconnects after refresh failure and waits for a new login token', async () => {
    useAuthStore.getState().setAccessToken('expired-token')
    vi.mocked(authApi.refresh).mockRejectedValue(new Error('Session expired'))
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const client = new VendorRealtimeClient('https://api.example.test', () => {})
    client.connect()
    await vi.waitFor(() => expect(socketHarness.io).toHaveBeenCalledTimes(1))

    socketHarness.handlers.get('connect_error')?.(new Error('Authentication required'))
    await vi.waitFor(() => expect(useAuthStore.getState().accessToken).toBeNull())
    expect(socketHarness.socket.disconnect).toHaveBeenCalled()

    useAuthStore.getState().setAccessToken('login-token')
    expect(socketHarness.socket.connect).toHaveBeenCalledTimes(1)
    client.disconnect()
  })

  it('disconnects after two hidden minutes and reconnects when visible', async () => {
    vi.useFakeTimers()
    useAuthStore.getState().setAccessToken('access-token')
    const client = new VendorRealtimeClient('https://api.example.test', () => {})
    client.connect()
    await vi.waitFor(() => expect(socketHarness.io).toHaveBeenCalledTimes(1))

    browserDocument.visibilityState = 'hidden'
    documentListeners.get('visibilitychange')?.()
    await vi.advanceTimersByTimeAsync(120_000)
    expect(socketHarness.socket.disconnect).toHaveBeenCalledTimes(1)

    browserDocument.visibilityState = 'visible'
    documentListeners.get('visibilitychange')?.()
    expect(socketHarness.socket.connect).toHaveBeenCalledTimes(1)
    client.disconnect()
  })
})
