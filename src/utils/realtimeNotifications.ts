import type { WorkspaceRole } from '../stores/navigationStore'
import type { RealtimeMessage } from '../services/realtime'
import { customerContent } from '../content/customer'

export function getRealtimeToastMessage(role: WorkspaceRole | null, message: RealtimeMessage) {
  if (role !== 'customer' || message.type !== 'booking.updated') return null
  const payload = message.payload
  if (typeof payload !== 'object' || payload === null) return null
  if (!('bookingId' in payload) || typeof payload.bookingId !== 'string') return null
  if (!('status' in payload) || payload.status !== 'accepted') return null
  return customerContent.bookings.acceptedRealtimeUpdate
}
