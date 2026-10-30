import { io, type Socket } from 'socket.io-client'
import { useAuthStore } from '../stores/authStore'

export type RealtimeMessage = { type: string; payload: unknown }
type RealtimeListener = (message: RealtimeMessage) => void
const realtimeListeners = new Set<RealtimeListener>()
const sharedBookingConsumers = new Map<string, number>()
let sharedInvalidationClient: VendorRealtimeClient | null = null
let invalidationClientConsumers = 0

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
  constructor(url: string, onMessage: (message: RealtimeMessage) => void) { this.url = url; this.onMessage = onMessage }
  connect() {
    if (this.socket || !navigator.onLine) return
    const socket = io(this.url, {
      auth: (callback) => callback({ token: useAuthStore.getState().accessToken }),
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelayMax: 10_000,
    })
    this.socket = socket
    socket.onAny((type, payload) => this.onMessage({ type, payload }))
    socket.on('connect', () => this.bookingIds.forEach((bookingId) => socket.emit('booking:join', bookingId)))
    socket.on('connect_error', () => {
      if (!useAuthStore.getState().accessToken) this.disconnect()
    })
  }
  joinBooking(bookingId: string) { this.bookingIds.add(bookingId); this.socket?.emit('booking:join', bookingId) }
  leaveBooking(bookingId: string) { this.bookingIds.delete(bookingId); this.socket?.emit('booking:leave', bookingId) }
  joinVendor(vendorId: string) { this.socket?.emit('vendor:join', vendorId) }
  disconnect() { this.socket?.disconnect(); this.socket = null }
}
