import type { Server } from 'socket.io'
import { supabase } from '../supabase.js'
import { logger } from '../lib/logger.js'

let realtimeServer: Server | null = null

export function setRealtimeServer(server: Server) {
  realtimeServer = server
}

// Frequent location pings are pushed live but are not written to the admin notification feed.
const transientRealtimeEvents = new Set(['booking.location.updated'])

export function emitRealtime(event: string, payload: unknown = {}) {
  if (event === 'booking.updated') emitBookingUpdated(payload)
  else realtimeServer?.emit(event, payload)
  persistUnlessTransient(event, payload)
}
export function emitRealtimeToUser(userId: string, event: string, payload: unknown = {}) {
  realtimeServer?.to(`customer:${userId}`).emit(event, payload)
  persistUnlessTransient(event, payload)
}
export function emitRealtimeToVendor(vendorId: string, event: string, payload: unknown = {}) {
  realtimeServer?.to(`vendor:${vendorId}`).emit(event, payload)
  persistUnlessTransient(event, payload)
}
export function emitRealtimeToBooking(bookingId: string, event: string, payload: unknown = {}) {
  realtimeServer?.to(`booking:${bookingId}`).emit(event, payload)
  persistUnlessTransient(event, payload)
}
export function emitRealtimeToAdmins(event: string, payload: unknown = {}) {
  realtimeServer?.to('admins').emit(event, payload)
}
// Booking updates reach the people following that booking and the admins, not every connected socket.
function emitBookingUpdated(payload: unknown) {
  const bookingId = payload && typeof payload === 'object' ? (payload as { bookingId?: unknown }).bookingId : undefined
  if (typeof bookingId !== 'string') {
    logger.error('realtime.booking_updated_dropped', { reason: 'bookingId missing' })
    return
  }
  realtimeServer?.to([`booking:${bookingId}`, 'admins']).emit('booking.updated', payload)
}
function persistUnlessTransient(event: string, payload: unknown) {
  if (!transientRealtimeEvents.has(event)) void persistAdminEvent(event, payload)
}
async function persistAdminEvent(event: string, payload: unknown) {
  const { data: admins, error: adminError } = await supabase.from('profiles').select('id').eq('role', 'admin')
  if (adminError || !admins?.length) {
    if (adminError) logger.error('admin.notification.persist_failed', { sourceEvent: event, error: adminError.message })
    return
  }
  const { error } = await supabase.from('notifications').insert(admins.map((admin) => ({ recipient_id: admin.id, event_type: event, title: event.replace(/[._]/g, ' '), payload: payload && typeof payload === 'object' ? payload : { value: payload } })))
  if (error) logger.error('admin.notification.persist_failed', { sourceEvent: event, error: error.message })
}
export function realtimeHealth() { return { configured: Boolean(realtimeServer), connected: realtimeServer?.engine.clientsCount ?? 0 } }