import { config } from '../config.js'
import { supabase } from '../supabase.js'

export type OrderGroupTask = {
  id: string
  reference: string
  status: string
  payment_method: string
  quoted_amount_paise: number | string | null
  created_at: string
}

export async function loadOrderGroup(bookingId: string, customerId: string) {
  if (!config.featureFlags.multi_service_tasks_enabled) {
    return { data: null, error: null }
  }
  const { data: booking, error: bookingError } = await supabase
    .from('bookings')
    .select('id,order_group_id,reference,status,payment_method,quoted_amount_paise,created_at')
    .eq('id', bookingId)
    .eq('customer_id', customerId)
    .maybeSingle()
  if (bookingError || !booking) return { data: null, error: bookingError }
  if (!booking.order_group_id) {
    return {
      data: {
        grouped: false,
        tasks: [booking as OrderGroupTask],
        leadId: booking.id,
        totalPaise: Number(booking.quoted_amount_paise ?? 0),
      },
      error: null,
    }
  }
  const { data: tasks, error } = await supabase
    .from('bookings')
    .select('id,reference,status,payment_method,quoted_amount_paise,created_at')
    .eq('customer_id', customerId)
    .eq('order_group_id', booking.order_group_id)
    .order('reference', { ascending: true })
  if (error || !tasks?.length) return { data: null, error }
  return {
    data: {
      grouped: true,
      tasks: tasks as OrderGroupTask[],
      leadId: tasks[0]!.id,
      totalPaise: tasks.reduce((sum, task) => sum + Number(task.quoted_amount_paise ?? 0), 0),
    },
    error: null,
  }
}
