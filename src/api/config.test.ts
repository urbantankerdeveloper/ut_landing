import { describe, expect, it } from 'vitest'
import { parseFeatureFlags } from './config'

describe('parseFeatureFlags', () => {
  it('accepts a complete public boolean flag map', () => {
    const flags = {
      duplicate_phone_check_enabled: true,
      mpin_cooldown_enabled: true,
      multi_service_tasks_enabled: false,
      multi_service_orders_enabled: false,
      order_tracking_board_enabled: false,
      vendor_earnings_realtime_enabled: false,
      online_payment_enabled: false,
      manual_assignment_mode_enabled: false,
      admin_availability_toggle_enabled: false,
      admin_dashboard_v2_enabled: false,
      area_availability_enabled: false,
      partner_application_otp_enabled: false,
      admin_approval_required_enabled: false,
      address_geocoding_enabled: false,
      invoice_generation_enabled: false,
      wallet_enabled: false,
    }

    expect(parseFeatureFlags(flags)).toEqual(flags)
  })

  it('rejects responses with missing or non-boolean flags', () => {
    expect(() => parseFeatureFlags({ wallet_enabled: 'false' })).toThrow(
      'feature flags response was invalid',
    )
  })
})
