import { describe, expect, it } from 'vitest'
import { whatsappPlaceholderError } from './adminWhatsAppTemplates.js'
describe('whatsappPlaceholderError', () => {
  it('allows built-in variables', () => expect(whatsappPlaceholderError('vendor_acceptance', 'Ref {{reference}} {{vehicle}} {{driver}} {{trackingUrl}}')).toBeNull())
  it('rejects unsupported variables', () => expect(whatsappPlaceholderError('user_registration_otp', 'OTP {{otp}} {{name}}')).toContain('{{name}}'))
  it('requires OTP values', () => expect(whatsappPlaceholderError('delivery_otp', 'Delivery {{reference}}')).toContain('{{otp}}'))
  it('requires reference values for confirmations', () => expect(whatsappPlaceholderError('guest_booking_confirmation', 'Booking confirmed')).toContain('{{reference}}'))
  it('allows custom non-OTP template placeholders', () => expect(whatsappPlaceholderError('custom_notice', 'Hi {{customer}}')).toBeNull())
})
