import { describe, expect, it } from 'vitest'
import { whatsappPlaceholderError } from './adminWhatsAppTemplates.js'
describe('whatsappPlaceholderError', () => {
  it('allows built-in variables', () => expect(whatsappPlaceholderError('vendor_acceptance', 'Ref {{reference}} {{vehicle}} {{driver}} {{trackingUrl}}')).toBeNull())
  it('requires a tracking URL in the vendor acceptance message', () => expect(whatsappPlaceholderError('vendor_acceptance', 'Booking {{reference}} accepted')).toContain('{{trackingUrl}}'))
  it('rejects unsupported variables', () => expect(whatsappPlaceholderError('user_registration_otp', 'OTP {{otp}} {{name}}')).toContain('{{name}}'))
  it('requires OTP values', () => expect(whatsappPlaceholderError('delivery_otp', 'Delivery {{reference}}')).toContain('{{otp}}'))
  it('requires reference values for confirmations', () => expect(whatsappPlaceholderError('guest_booking_confirmation', 'Booking confirmed')).toContain('{{reference}}'))
  it('requires the tracking URL in booking confirmations', () => expect(whatsappPlaceholderError('guest_booking_confirmation', 'Booking {{reference}} confirmed')).toContain('{{trackingUrl}}'))
  it('allows custom non-OTP template placeholders', () => expect(whatsappPlaceholderError('custom_notice', 'Hi {{customer}}')).toBeNull())
})
