import { describe, expect, it } from 'vitest'
import { buildMsg91FlowPayload, renderSmsTemplate, toMsg91Mobile } from './sms.js'

describe('buildMsg91FlowPayload', () => {
  it('puts variables on the recipient and omits the sender', () => {
    const payload = buildMsg91FlowPayload('tpl-1', '+919876543210', {
      vendorName: 'Acme',
      trackingUrl: 'https://app.example.com/track/abc',
    })
    expect(payload).toEqual({
      template_id: 'tpl-1',
      short_url: '0',
      recipients: [
        {
          mobiles: '919876543210',
          vendorName: 'Acme',
          trackingUrl: 'https://app.example.com/track/abc',
        },
      ],
    })
    expect(payload).not.toHaveProperty('sender')
  })
})

describe('renderSmsTemplate', () => {
  it('fills the OTP placeholder', () => {
    expect(renderSmsTemplate('Your code is {{otp}}.', { otp: '123456' })).toBe('Your code is 123456.')
  })

  it('throws when a variable is missing', () => {
    expect(() => renderSmsTemplate('Booking {{reference}} for {{driver}}', { reference: 'UT1' })).toThrow(/missing variable driver/)
  })
})

describe('toMsg91Mobile', () => {
  it('strips the plus sign and keeps the country code digits', () => {
    expect(toMsg91Mobile('+919876543210')).toBe('919876543210')
  })
})
