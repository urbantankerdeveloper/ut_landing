import type { Server } from 'socket.io'
import { supabase } from '../supabase.js'

let realtimeServer: Server | null = null

export function setRealtimeServer(server: Server) {
  realtimeServer = server
}

export function emitRealtime(event: string, payload: unknown = {}) {
  realtimeServer?.emit(event, payload)
  void persistAdminEvent(event, payload)
}
export function emitRealtimeToUser(userId: string, event: string, payload: unknown = {}) {
  realtimeServer?.to(`customer:${userId}`).emit(event, payload)
  void persistAdminEvent(event, payload)
}
export function emitRealtimeToVendor(vendorId: string, event: string, payload: unknown = {}) {
  realtimeServer?.to(`vendor:${vendorId}`).emit(event, payload)
  void persistAdminEvent(event, payload)
}
export function emitRealtimeToAdmins(event: string, payload: unknown = {}) {
  realtimeServer?.to('admins').emit(event, payload)
}
async function persistAdminEvent(event: string, payload: unknown) {
  const { data: admins, error: adminError } = await supabase.from('profiles').select('id').eq('role', 'admin')
  if (adminError || !admins?.length) {
    if (adminError) console.error(JSON.stringify({ event: 'admin.notification.persist_failed', sourceEvent: event, error: adminError.message }))
    return
  }
  const { error } = await supabase.from('notifications').insert(admins.map((admin) => ({ recipient_id: admin.id, event_type: event, title: event.replace(/[._]/g, ' '), payload: payload && typeof payload === 'object' ? payload : { value: payload } })))
  if (error) console.error(JSON.stringify({ event: 'admin.notification.persist_failed', sourceEvent: event, error: error.message }))
}
export function realtimeHealth() { return { configured: Boolean(realtimeServer), connected: realtimeServer?.engine.clientsCount ?? 0 } }