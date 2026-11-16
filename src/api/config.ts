import { apiFetch } from './client'

const featureFlagNames = [
  'duplicate_phone_check_enabled',
  'mpin_cooldown_enabled',
  'multi_service_tasks_enabled',
  'order_tracking_board_enabled',
  'vendor_earnings_realtime_enabled',
  'online_payment_enabled',
  'manual_assignment_mode_enabled',
  'admin_availability_toggle_enabled',
  'admin_dashboard_v2_enabled',
  'area_availability_enabled',
  'partner_application_otp_enabled',
  'address_geocoding_enabled',
  'invoice_generation_enabled',
  'wallet_enabled',
] as const

export type FeatureFlags = Record<(typeof featureFlagNames)[number], boolean>

export function parseFeatureFlags(value: unknown): FeatureFlags {
  if (
    typeof value !== 'object' ||
    value === null ||
    featureFlagNames.some((name) => typeof (value as Record<string, unknown>)[name] !== 'boolean')
  ) {
    throw new TypeError('The feature flags response was invalid.')
  }
  return Object.fromEntries(
    featureFlagNames.map((name) => [name, (value as Record<string, boolean>)[name]]),
  ) as FeatureFlags
}

export const configApi = {
  featureFlags: async () => parseFeatureFlags(await apiFetch<unknown>('/config/flags')),
}
