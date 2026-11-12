import { describe, expect, it } from 'vitest'
import { deliveryVerificationMethod } from './deliveryVerification.js'

describe('delivery verification method', () => {
  it('uses the OTP when supplied', () => {
    expect(deliveryVerificationMethod({ otp: '123456', smsSent: false })).toBe('otp')
  })

  it('allows an uploaded photo instead of OTP only when SMS was not sent', () => {
    expect(
      deliveryVerificationMethod({
        smsSent: false,
        proofPath: 'vendor-1/delivery/photo.jpg',
      }),
    ).toBe('photo')
  })

  it.each([true, null])(
    'does not allow photo-only completion when SMS status is %s',
    (smsSent) => {
      expect(
        deliveryVerificationMethod({
          smsSent,
          proofPath: 'vendor-1/delivery/photo.jpg',
        }),
      ).toBeNull()
    },
  )

  it('requires a photo for the SMS-failure fallback', () => {
    expect(deliveryVerificationMethod({ smsSent: false })).toBeNull()
  })
})
