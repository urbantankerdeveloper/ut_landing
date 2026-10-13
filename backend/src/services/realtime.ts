import type { Server } from 'socket.io'

let realtimeServer: Server | null = null

export function setRealtimeServer(server: Server) {
  realtimeServer = server
}

export function emitRealtime(event: string, payload: unknown = {}) {
  realtimeServer?.emit(event, payload)
}
export function emitRealtimeToUser(userId: string, event: string, payload: unknown = {}) {
  realtimeServer?.to(`customer:${userId}`).emit(event, payload)
}