import { config } from '../config.js'
import { supabase } from '../supabase.js'

export async function sendPushNotification(input: {
  recipientId: string
  title: string
  body?: string
  data?: Record<string, unknown>
}) {
  if (!config.ONESIGNAL_APP_ID || !config.ONESIGNAL_REST_API_KEY) {
    return { delivered: 0, configured: false }
  }
  const { data: devices, error } = await supabase
    .from('device_tokens')
    .select('id,token')
    .eq('user_id', input.recipientId)
    .eq('is_active', true)
  if (error) throw new Error(`Push token lookup failed: ${error.message}`)
  if (!devices?.length) return { delivered: 0, configured: true }

  const response = await fetch('https://api.onesignal.com/notifications', {
    method: 'POST',
    headers: {
      Authorization: `Key ${config.ONESIGNAL_REST_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      app_id: config.ONESIGNAL_APP_ID,
      include_subscription_ids: devices.map((device) => device.token),
      headings: { en: input.title },
      contents: { en: input.body ?? input.title },
      data: input.data ?? {},
    }),
  })
  const result = await response.json() as {
    id?: string
    recipients?: number
    errors?: string[]
  }
  if (!response.ok) {
    throw new Error(`OneSignal push failed: ${result.errors?.join(', ') ?? response.statusText}`)
  }
  return { delivered: result.recipients ?? 0, configured: true, id: result.id }
}
