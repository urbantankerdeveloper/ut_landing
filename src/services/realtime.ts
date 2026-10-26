import { io, type Socket } from 'socket.io-client'
import { useAuthStore } from '../stores/authStore'

export type RealtimeMessage = { type: string; payload: unknown }
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
  joinVendor(vendorId: string) { this.socket?.emit('vendor:join', vendorId) }
  disconnect() { this.socket?.disconnect(); this.socket = null }
}
