import { describe, expect, it } from 'vitest'
import { isTrackingStale, normalizeInvoice, normalizeNotification } from './customerData'

describe('customer data normalization', () => {
  it('normalizes notification payloads from the API', () => {
    expect(normalizeNotification({ id: 'n1', event_type: 'vendor_assigned', payload: { detail: 'Driver assigned' } })).toEqual({ id: 'n1', title: 'vendor_assigned', detail: 'Driver assigned', unread: true })
  })

  it('normalizes invoice field variants', () => {
    expect(normalizeInvoice({ id: 'i1', invoice_number: 'INV-1', issued_at: '2026-10-13T10:00:00Z', service_code: 'water_tanker', address_text: 'Chennai', total_amount: 1850, status: 'Paid' })).toMatchObject({ number: 'INV-1', date: '2026-10-13', service: 'water_tanker', location: 'Chennai', amount: 1850, status: 'Paid' })
  })

  it('normalizes itemized invoice snapshots from paise without losing tax or discount', () => {
    expect(normalizeInvoice({
      number: 'INV-UT-1',
      total_paise: 285000,
      subtotal_paise: 250000,
      tax_paise: 45000,
      discount_paise: 10000,
      payment_status: 'partially_refunded',
      line_items: [{ description: 'Water tanker · 5000 litres', quantity: 2, subtotalPaise: 250000, taxPaise: 45000, taxRate: 0.18, discountPaise: 10000, totalPaise: 285000 }],
    })).toMatchObject({
      amount: 2850,
      status: 'partially_refunded',
      subtotalPaise: 250000,
      taxPaise: 45000,
      discountPaise: 10000,
      lineItems: [{ description: 'Water tanker · 5000 litres', quantity: 2, totalPaise: 285000 }],
    })
  })

  it('marks location stale after two minutes', () => {
    const now = Date.parse('2026-10-13T12:02:01Z')
    expect(isTrackingStale('2026-10-13T12:00:00Z', now)).toBe(true)
    expect(isTrackingStale('2026-10-13T12:01:30Z', now)).toBe(false)
  })
})
