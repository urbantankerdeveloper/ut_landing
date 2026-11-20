import { describe, expect, it } from 'vitest'
import { canSkipPhoneVerification, pastedOtpDigits, phoneOtpDeliveryCopy } from './phoneVerification'

describe('phone verification dialog helpers', () => {
  it('only allows skipping when account verification is explicitly optional', () => {
    expect(canSkipPhoneVerification(false)).toBe(true)
    expect(canSkipPhoneVerification(true)).toBe(false)
    expect(canSkipPhoneVerification(undefined)).toBe(false)
  })

  it('uses the selected delivery channel in the OTP message', () => {
    expect(phoneOtpDeliveryCopy('whatsapp', '9876543210')).toContain('WhatsApp')
    expect(phoneOtpDeliveryCopy('sms', '9876543210')).toContain('SMS')
    expect(phoneOtpDeliveryCopy('sms', '9876543210')).toContain('+91 9876543210')
  })

  it('extracts at most six digits when pasting an OTP', () => {
    expect(pastedOtpDigits('12a 34-56 78')).toBe('123456')
    expect(pastedOtpDigits('no code')).toBe('')
  })
})
