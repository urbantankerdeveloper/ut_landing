import { z } from 'zod'

export const defaultFeatureFlags = {
  duplicate_phone_check_enabled: true,
  otp_sms_fallback_enabled: true,
  mpin_cooldown_enabled: true,
  multi_service_tasks_enabled: false,
  order_tracking_board_enabled: true,
  vendor_earnings_realtime_enabled: true,
  online_payment_enabled: true,
  manual_assignment_mode_enabled: false,
  admin_availability_toggle_enabled: true,
  admin_dashboard_v2_enabled: true,
  area_availability_enabled: true,
  partner_application_otp_enabled: true,
  address_geocoding_enabled: true,
  invoice_generation_enabled: false,
  wallet_enabled: false,
  AUTH_LOCAL_JWT_VERIFY: false,
  AUTH_PROFILE_CACHE: false,
  REALTIME_ROOM_ROUTING: false,
  RATE_LIMIT_BY_USER: false,
  AUTH_MOUNT_ONCE: false,
} as const

const overridesSchema = z.object({
  duplicate_phone_check_enabled: z.boolean().optional(),
  otp_sms_fallback_enabled: z.boolean().optional(),
  mpin_cooldown_enabled: z.boolean().optional(),
  multi_service_tasks_enabled: z.boolean().optional(),
  order_tracking_board_enabled: z.boolean().optional(),
  vendor_earnings_realtime_enabled: z.boolean().optional(),
  online_payment_enabled: z.boolean().optional(),
  manual_assignment_mode_enabled: z.boolean().optional(),
  admin_availability_toggle_enabled: z.boolean().optional(),
  admin_dashboard_v2_enabled: z.boolean().optional(),
  area_availability_enabled: z.boolean().optional(),
  partner_application_otp_enabled: z.boolean().optional(),
  address_geocoding_enabled: z.boolean().optional(),
  invoice_generation_enabled: z.boolean().optional(),
  wallet_enabled: z.boolean().optional(),
  AUTH_LOCAL_JWT_VERIFY: z.boolean().optional(),
  AUTH_PROFILE_CACHE: z.boolean().optional(),
  REALTIME_ROOM_ROUTING: z.boolean().optional(),
  RATE_LIMIT_BY_USER: z.boolean().optional(),
  AUTH_MOUNT_ONCE: z.boolean().optional(),
}).strict()

export type FeatureFlags = Record<keyof typeof defaultFeatureFlags, boolean>

export function resolveFeatureFlags(
  raw = '{}',
  walletEnabledOverride?: boolean,
): FeatureFlags {
  let decoded: unknown
  try {
    decoded = JSON.parse(raw)
  } catch {
    throw new Error('FEATURE_FLAGS_JSON must contain a valid JSON object.')
  }
  const parsed = overridesSchema.safeParse(decoded)
  if (!parsed.success) {
    throw new Error('FEATURE_FLAGS_JSON contains an unknown flag or non-boolean value.')
  }
  return {
    ...defaultFeatureFlags,
    ...parsed.data,
    ...(walletEnabledOverride === undefined
      ? {}
      : { wallet_enabled: walletEnabledOverride }),
  }
}
