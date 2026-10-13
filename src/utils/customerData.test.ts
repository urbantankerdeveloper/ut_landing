import { describe, expect, it } from 'vitest'
import { isTrackingStale, normalizeInvoice, normalizeNotification } from './customerData'

describe('customer data normalization', () => {
  it('normalizes notification payloads from the API', () => {
    expect(normalizeNotification({ id: 'n1', event_type: 'vendor_assigned', payload: { detail: 'Driver assigned' } })).toEqual({ id: 'n1', title: 'vendor_assigned', detail: 'Driver assigned', unread: true })
  })

  it('normalizes invoice field variants', () => {
    expect(normalizeInvoice({ id: 'i1', invoice_number: 'INV-1', issued_at: '2026-10-13T10:00:00Z', service_code: 'water_tanker', address_text: 'Chennai', total_amount: 1850, status: 'Paid' })).toMatchObject({ number: 'INV-1', date: '2026-10-13', service: 'water_tanker', location: 'Chennai', amount: 1850, status: 'Paid' })
  })

  it('marks location stale after two minutes', () => {
    const now = Date.parse('2026-10-13T12:02:01Z')
    expect(isTrackingStale('2026-10-13T12:00:00Z', now)).toBe(true)
    expect(isTrackingStale('2026-10-13T12:01:30Z', now)).toBe(false)
  })
})
