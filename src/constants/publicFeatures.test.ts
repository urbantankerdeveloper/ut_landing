import { describe, expect, it } from 'vitest'
import { parseBookingButtonSetting, shouldShowBookingButton } from './publicFeatures'

describe('booking button visibility', () => {
  it('defaults to hidden unless the environment value is exactly true', () => {
    expect(parseBookingButtonSetting(undefined)).toBe(false)
    expect(parseBookingButtonSetting('false')).toBe(false)
    expect(parseBookingButtonSetting('true')).toBe(true)
    expect(parseBookingButtonSetting('TRUE')).toBe(false)
  })

  it('shows the enabled button to customers, admins, and public visitors but not vendors', () => {
    expect(shouldShowBookingButton(undefined, true)).toBe(true)
    expect(shouldShowBookingButton('customer', true)).toBe(true)
    expect(shouldShowBookingButton('admin', true)).toBe(true)
    expect(shouldShowBookingButton('vendor', true)).toBe(false)
    expect(shouldShowBookingButton('dispatcher', true)).toBe(false)
    expect(shouldShowBookingButton('customer', false)).toBe(false)
  })
})
