import { describe, expect, it } from 'vitest'
import { placeholderError } from './adminSmsTemplates.js'

describe('placeholderError', () => {
  it('accepts placeholders the code path sends', () => {
    expect(placeholderError('vendor_acceptance', 'Booking {{reference}} {{vehicle}} {{driver}} {{trackingUrl}}')).toBeNull()
  })

  it('rejects placeholders the code path does not send', () => {
    const message = placeholderError('user_registration_otp', 'Code {{otp}} for {{name}}')
    expect(message).toContain('{{name}}')
    expect(message).toContain('{{otp}}')
  })

  it('allows any placeholder on a custom template key', () => {
    expect(placeholderError('custom_promo_sms', 'Hi {{name}}')).toBeNull()
  })

  it('rejects an OTP body that drops the code', () => {
    expect(placeholderError('user_registration_otp', 'Welcome to Urban Tanker')).toContain('{{otp}}')
    expect(placeholderError('delivery_otp', 'Ref {{reference}}')).toContain('{{otp}}')
  })

  it('requires the OTP placeholder on custom OTP keys too', () => {
    expect(placeholderError('custom_login_otp', 'Hi there')).toContain('{{otp}}')
    expect(placeholderError('custom_login_otp', 'Code {{otp}}')).toBeNull()
  })

  it('requires the reference on built-in confirmations', () => {
    expect(placeholderError('guest_booking_confirmation', 'Thank you')).toContain('{{reference}}')
  })
})
