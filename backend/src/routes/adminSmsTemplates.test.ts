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
})
