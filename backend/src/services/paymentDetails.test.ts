import { describe, expect, it } from 'vitest'
import { epochSecondsToIso, extractPaymentDetails } from './paymentDetails.js'

const base = { id: 'pay_1', order_id: 'order_1', status: 'captured', amount: 50000, currency: 'INR' }

describe('extractPaymentDetails', () => {
  it('maps card payments to masked card fields and drops anything else', () => {
    const details = extractPaymentDetails({
      ...base,
      method: 'card',
      international: false,
      fee: 1180,
      tax: 180,
      email: 'a@example.com',
      contact: '+919999999999',
      card: { last4: '4242', network: 'Visa', type: 'credit', issuer: 'HDFC', id: 'card_secret' } as never,
    })
    expect(details).toMatchObject({
      method: 'card',
      card_network: 'Visa',
      card_last4: '4242',
      card_type: 'credit',
      card_issuer: 'HDFC',
      international: false,
      fee_paise: 1180,
      tax_paise: 180,
      payer_email: 'a@example.com',
      payer_contact: '+919999999999',
      bank: null,
      vpa: null,
      wallet: null,
    })
    expect(Object.keys(details)).not.toContain('card_id')
  })

  it('maps UPI payments with the VPA and no card fields', () => {
    const details = extractPaymentDetails({ ...base, method: 'upi', vpa: 'user@okaxis', card: null })
    expect(details).toMatchObject({ method: 'upi', vpa: 'user@okaxis', card_last4: null, card_network: null })
  })

  it('maps netbanking payments to the bank name', () => {
    expect(extractPaymentDetails({ ...base, method: 'netbanking', bank: 'ICIC' })).toMatchObject({ method: 'netbanking', bank: 'ICIC' })
  })

  it('maps wallet payments to the wallet name', () => {
    expect(extractPaymentDetails({ ...base, method: 'wallet', wallet: 'freecharge' })).toMatchObject({ method: 'wallet', wallet: 'freecharge' })
  })

  it('keeps fee and tax null when Razorpay has not reported them, never zero', () => {
    const details = extractPaymentDetails({ ...base, method: 'upi', fee: null, tax: undefined })
    expect(details.fee_paise).toBeNull()
    expect(details.tax_paise).toBeNull()
  })

  it('handles an order with no payment method yet', () => {
    const details = extractPaymentDetails({ id: 'pay_2', status: 'created', method: null })
    expect(details.method).toBeNull()
    expect(details.card_last4).toBeNull()
  })

  it('captures error fields for a failed payment', () => {
    const details = extractPaymentDetails({
      ...base,
      status: 'failed',
      method: 'card',
      card: { last4: '0002', network: 'MasterCard', type: 'debit', issuer: null },
      error_code: 'BAD_REQUEST_ERROR',
      error_description: 'Payment processing failed because of incorrect OTP',
      error_source: 'customer',
      error_step: 'payment_authentication',
      error_reason: 'payment_verification_failed',
    })
    expect(details).toMatchObject({
      error_code: 'BAD_REQUEST_ERROR',
      error_source: 'customer',
      error_step: 'payment_authentication',
      error_reason: 'payment_verification_failed',
      card_issuer: null,
    })
  })

  it('treats a missing entity as all-null', () => {
    expect(Object.values(extractPaymentDetails(undefined)).every((value) => value === null)).toBe(true)
  })
})

describe('epochSecondsToIso', () => {
  it('converts Razorpay epoch seconds to ISO', () => {
    expect(epochSecondsToIso(1700000000)).toBe('2023-11-14T22:13:20.000Z')
  })

  it('returns null for missing or invalid values', () => {
    expect(epochSecondsToIso(undefined)).toBeNull()
    expect(epochSecondsToIso(0)).toBeNull()
  })
})
