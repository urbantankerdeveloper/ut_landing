import { io, type Socket } from 'socket.io-client'

export type RealtimeMessage = { type: string; payload: unknown }
export class VendorRealtimeClient {
  private socket: Socket | null = null
  private readonly url: string
  private readonly onMessage: (message: RealtimeMessage) => void
  constructor(url: string, onMessage: (message: RealtimeMessage) => void) { this.url = url; this.onMessage = onMessage }
  connect() {
    if (this.socket || !navigator.onLine) return
    const socket = io(this.url, {
      auth: (callback) => callback({ token: sessionStorage.getItem('urban-tanker-access-token') }),
      transports: ['polling', 'websocket'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelayMax: 10_000,
    })
    this.socket = socket
    socket.onAny((type, payload) => this.onMessage({ type, payload }))
    socket.on('connect_error', () => {
      if (!sessionStorage.getItem('urban-tanker-access-token')) this.disconnect()
    })
  }
  joinBooking(bookingId: string) { this.socket?.emit('booking:join', bookingId) }
  joinVendor(vendorId: string) { this.socket?.emit('vendor:join', vendorId) }
  disconnect() { this.socket?.disconnect(); this.socket = null }
}
