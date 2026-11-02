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
    signal: AbortSignal.timeout(8_000),
  })
  if (!response.ok) {
    throw new Error(`OneSignal push failed: ${response.status} ${response.statusText}`.trim())
  }
  const result = await response.json() as OneSignalResult
  const invalidTokens = invalidSubscriptionIds(result.errors)
  if (invalidTokens.length) {
    const { error: deactivateError } = await supabase
      .from('device_tokens')
      .update({ is_active: false })
      .eq('user_id', input.recipientId)
      .in('token', invalidTokens)
    if (deactivateError) console.warn(JSON.stringify({ event: 'push.deactivate_failed', error: deactivateError.message }))
  }
  return { delivered: result.recipients ?? 0, configured: true, id: result.id }
}

// Response fields relied on: `id` and `recipients` on success. Invalid or unsubscribed devices are listed in
// `errors` as an object with `invalid_player_ids` and/or `invalid_subscription_ids` arrays of subscription IDs.
type OneSignalResult = {
  id?: string
  recipients?: number
  errors?: string[] | { invalid_player_ids?: string[]; invalid_subscription_ids?: string[] }
}

function invalidSubscriptionIds(errors: OneSignalResult['errors']) {
  if (!errors || Array.isArray(errors)) return []
  return [...(errors.invalid_player_ids ?? []), ...(errors.invalid_subscription_ids ?? [])]
}
