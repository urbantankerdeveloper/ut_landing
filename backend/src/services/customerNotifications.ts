import { supabase } from '../supabase.js'
import { emitRealtimeToUser } from './realtime.js'

type NotificationInput = { customerId: string; eventType: string; title: string; detail?: string; payload?: Record<string, unknown>; bookingId?: string }

export async function notifyCustomer(input: NotificationInput) {
  const { data: preferences } = await supabase.from('notification_preferences').select('booking_updates,payment_updates,marketing_updates').eq('customer_id', input.customerId).maybeSingle()
  if (preferences) { const event = input.eventType.toLowerCase(); if (event.includes('booking') && preferences.booking_updates === false) return null; if ((event.includes('payment') || event.includes('payout')) && preferences.payment_updates === false) return null; if ((event.includes('marketing') || event.includes('offer')) && preferences.marketing_updates === false) return null }
  const payload = { ...(input.payload ?? {}), ...(input.detail ? { detail: input.detail } : {}), ...(input.bookingId ? { bookingId: input.bookingId } : {}) }
  const { data, error } = await supabase.from('notifications').insert({ recipient_id: input.customerId, event_type: input.eventType, title: input.title, payload }).select().single()
  if (error) throw new Error(error.message)
  emitRealtimeToUser(input.customerId, 'notification.created', data)
  return data
}
