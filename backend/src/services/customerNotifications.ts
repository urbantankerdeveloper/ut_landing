import { supabase } from '../supabase.js'
import { emitRealtimeToUser } from './realtime.js'

type NotificationInput = { customerId: string; eventType: string; title: string; detail?: string; payload?: Record<string, unknown>; bookingId?: string }

export async function notifyCustomer(input: NotificationInput) {
  const payload = { ...(input.payload ?? {}), ...(input.detail ? { detail: input.detail } : {}), ...(input.bookingId ? { bookingId: input.bookingId } : {}) }
  const { data, error } = await supabase.from('notifications').insert({ recipient_id: input.customerId, event_type: input.eventType, title: input.title, payload }).select().single()
  if (error) throw new Error(error.message)
  emitRealtimeToUser(input.customerId, 'notification.created', data)
  return data
}
