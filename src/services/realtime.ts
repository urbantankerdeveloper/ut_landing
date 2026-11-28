import type { Socket } from 'socket.io-client'
import { authApi } from '../api/auth'
import { useAuthStore } from '../stores/authStore'
import { useRealtimeStore } from '../stores/realtimeStore'

export type RealtimeMessage = { type: string; payload: unknown }
type RealtimeListener = (message: RealtimeMessage) => void
type SocketTransport = 'polling' | 'websocket'
// Emitted locally (never by the server) after the socket reconnects. payload.since is when the connection dropped.
export const SOCKET_RECONNECTED = 'socket.reconnected'
const HIDDEN_DISCONNECT_DELAY_MS = 120_000
const MAX_RECONNECTION_ATTEMPTS = 10
const MAX_RECONNECTION_DELAY_MS = 30_000
const realtimeListeners = new Set<RealtimeListener>()
const sharedBookingConsumers = new Map<string, number>()
let sharedInvalidationClient: VendorRealtimeClient | null = null
let invalidationClientConsumers = 0

function configuredSocketTransports(): SocketTransport[] {
  const configured: string = import.meta.env.VITE_SOCKET_TRANSPORTS?.trim() || 'polling'
  const transports: SocketTransport[] = configured.split(',').map((value) => {
    const transport = value.trim()
    if (transport !== 'polling' && transport !== 'websocket') throw new Error('VITE_SOCKET_TRANSPORTS must contain polling and/or websocket')
    return transport
  })
  if (new Set(transports).size !== transports.length) {
    throw new Error('VITE_SOCKET_TRANSPORTS must not contain duplicates')
  }
  return transports
}

export function subscribeToRealtime(url: string, listener: RealtimeListener, bookingId?: string) {
  realtimeListeners.add(listener)
  invalidationClientConsumers += 1
  if (!sharedInvalidationClient) {
    sharedInvalidationClient = new VendorRealtimeClient(url, (message) => {
      realtimeListeners.forEach((subscriber) => subscriber(message))
    })
  }
  sharedInvalidationClient.connect()
  if (bookingId) {
    const count = sharedBookingConsumers.get(bookingId) ?? 0
    sharedBookingConsumers.set(bookingId, count + 1)
    if (count === 0) sharedInvalidationClient.joinBooking(bookingId)
  }
  return () => {
    realtimeListeners.delete(listener)
    invalidationClientConsumers = Math.max(0, invalidationClientConsumers - 1)
    if (bookingId) {
      const count = sharedBookingConsumers.get(bookingId) ?? 0
      if (count <= 1) {
        sharedBookingConsumers.delete(bookingId)
        sharedInvalidationClient?.leaveBooking(bookingId)
      } else sharedBookingConsumers.set(bookingId, count - 1)
    }
    if (invalidationClientConsumers === 0) {
      sharedInvalidationClient?.disconnect()
      sharedInvalidationClient = null
      realtimeListeners.clear()
      sharedBookingConsumers.clear()
    }
  }
}

export class VendorRealtimeClient {
  private socket: Socket | null = null
  private readonly url: string
  private readonly onMessage: (message: RealtimeMessage) => void
  private readonly bookingIds = new Set<string>()
  private readonly handleOnline = () => {
    if (this.disposed || this.authBlocked || !useAuthStore.getState().accessToken) return
    if (this.socket) this.socket.connect()
    else this.connect()
  }
  private readonly handleVisibilityChange = () => {
    if (document.visibilityState === 'hidden') {
      if (this.hiddenDisconnectTimer !== null) return
      this.hiddenDisconnectTimer = window.setTimeout(() => {
        this.hiddenDisconnectTimer = null
        if (document.visibilityState !== 'hidden') return
        this.pausedForVisibility = true
        this.socket?.disconnect()
        useRealtimeStore.getState().setConnected(false)
      }, HIDDEN_DISCONNECT_DELAY_MS)
      return
    }

    if (this.hiddenDisconnectTimer !== null) {
      window.clearTimeout(this.hiddenDisconnectTimer)
      this.hiddenDisconnectTimer = null
    }
    if (!this.pausedForVisibility) return
    this.pausedForVisibility = false
    const token = useAuthStore.getState().accessToken
    if (!token || this.authBlocked) return
    if (this.socket) {
      this.socket.auth = { token }
      this.socket.connect()
    } else this.connect()
  }
  private disconnectedAt: number | null = null
  private hiddenDisconnectTimer: number | null = null
  private pausedForVisibility = false
  private authRefreshAttempted = false
  private authRefreshInFlight = false
  private authBlocked = false
  private disposed = false
  private readonly unsubscribeAuth: () => void

  constructor(url: string, onMessage: (message: RealtimeMessage) => void) {
    this.url = url
    this.onMessage = onMessage
    this.unsubscribeAuth = useAuthStore.subscribe((state, previousState) => {
      if (state.accessToken === previousState.accessToken) return
      if (!state.accessToken) {
        this.socket?.disconnect()
        useRealtimeStore.getState().setConnected(false)
        return
      }
      if (previousState.accessToken === null) {
        this.authBlocked = false
        this.authRefreshAttempted = false
      }
      if (this.authBlocked) return
      if (this.socket) {
        this.socket.auth = { token: state.accessToken }
        if (!this.socket.connected) this.socket.connect()
      } else this.connect()
    })
    document.addEventListener('visibilitychange', this.handleVisibilityChange)
  }

  connect() {
    if (this.socket || this.disposed || this.authBlocked || !useAuthStore.getState().accessToken) return
    // Starting offline must not leave the client dead: wait for the browser to come back online.
    if (!navigator.onLine) {
      window.addEventListener('online', this.handleOnline, { once: true })
      return
    }
    window.removeEventListener('online', this.handleOnline)
    void import('socket.io-client').then(({ io }) => {
      if (this.socket || this.disposed || this.authBlocked || !useAuthStore.getState().accessToken) return
      const transports = configuredSocketTransports()
      const socket = io(this.url, {
        auth: (callback) => callback({ token: useAuthStore.getState().accessToken }),
        transports,
        upgrade: transports.includes('websocket'),
        reconnection: true,
        reconnectionAttempts: MAX_RECONNECTION_ATTEMPTS,
        reconnectionDelayMax: MAX_RECONNECTION_DELAY_MS,
      })
      this.socket = socket
      socket.onAny((type, payload) => this.onMessage({ type, payload }))
      socket.on('connect', () => {
        this.authRefreshAttempted = false
        this.authBlocked = false
        useRealtimeStore.getState().setConnected(true)
        this.bookingIds.forEach((bookingId) => socket.emit('booking:join', bookingId))
        if (this.disconnectedAt !== null) {
          this.onMessage({ type: SOCKET_RECONNECTED, payload: { since: this.disconnectedAt } })
          this.disconnectedAt = null
        }
      })
      socket.on('disconnect', () => {
        this.disconnectedAt = Date.now()
        useRealtimeStore.getState().setConnected(false)
      })
      socket.on('connect_error', (error) => {
        void this.handleConnectError(socket, error)
      })
    }).catch((error) => {
      if (!this.disposed) console.warn('Realtime Socket.IO client could not be loaded.', error)
    })
  }

  private async handleConnectError(socket: Socket, error: Error) {
    if (error.message !== 'Authentication required' && error.message !== 'Invalid session') return
    if (this.authRefreshInFlight) return
    if (this.authRefreshAttempted) {
      this.authBlocked = true
      socket.disconnect()
      useAuthStore.getState().signOut()
      return
    }

    const attemptedToken = useAuthStore.getState().accessToken
    if (!attemptedToken) {
      socket.disconnect()
      return
    }
    this.authRefreshAttempted = true
    this.authRefreshInFlight = true
    socket.disconnect()
    try {
      const refreshed = await authApi.refresh()
      const token = refreshed.accessToken ?? refreshed.token
      if (!token) throw new Error('The session refresh response did not contain an access token')
      if (this.disposed || this.socket !== socket || useAuthStore.getState().accessToken !== attemptedToken) return
      useAuthStore.getState().setAccessToken(token)
      socket.auth = { token }
      if (!socket.connected && !socket.active) socket.connect()
    } catch (refreshError) {
      if (this.disposed || this.socket !== socket || useAuthStore.getState().accessToken !== attemptedToken) return
      this.authBlocked = true
      socket.disconnect()
      useAuthStore.getState().signOut()
      console.warn('Realtime authentication refresh failed; waiting for a new login.', refreshError)
    } finally {
      this.authRefreshInFlight = false
    }
  }

  joinBooking(bookingId: string) { this.bookingIds.add(bookingId); this.socket?.emit('booking:join', bookingId) }
  leaveBooking(bookingId: string) { this.bookingIds.delete(bookingId); this.socket?.emit('booking:leave', bookingId) }
  joinVendor(vendorId: string) { this.socket?.emit('vendor:join', vendorId) }
  disconnect() {
    this.disposed = true
    this.unsubscribeAuth()
    document.removeEventListener('visibilitychange', this.handleVisibilityChange)
    if (this.hiddenDisconnectTimer !== null) {
      window.clearTimeout(this.hiddenDisconnectTimer)
      this.hiddenDisconnectTimer = null
    }
    window.removeEventListener('online', this.handleOnline)
    this.socket?.disconnect()
    this.socket = null
    useRealtimeStore.getState().setConnected(false)
  }
}
