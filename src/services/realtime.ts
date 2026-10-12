import { io, type Socket } from 'socket.io-client'

export type RealtimeMessage = { type: string; payload: unknown }
export class VendorRealtimeClient {
  private socket: Socket | null = null
  private readonly url: string
  private readonly onMessage: (message: RealtimeMessage) => void
  constructor(url: string, onMessage: (message: RealtimeMessage) => void) { this.url = url; this.onMessage = onMessage }
  connect() { if (this.socket || !navigator.onLine) return; const token = sessionStorage.getItem('urban-tanker-access-token'); if (!token) return; this.socket = io(this.url, { auth: { token }, transports: ['websocket'] }); this.socket.onAny((type, payload) => this.onMessage({ type, payload })) }
  joinBooking(bookingId: string) { this.socket?.emit('booking:join', bookingId) }
  joinVendor(vendorId: string) { this.socket?.emit('vendor:join', vendorId) }
  disconnect() { this.socket?.disconnect(); this.socket = null }
}
