import { describe, expect, it } from 'vitest'
import { analyticsEventSchema, summarizeAnalyticsEvents } from './analytics.js'

describe('analytics events', () => {
  it('accepts bounded privacy-safe event properties', () => {
    const parsed = analyticsEventSchema.safeParse({
      eventName: 'booking.created',
      sessionId: 'session-123456',
      properties: { service: 'water_tanker', capacity: 5000, returning: true },
    })
    expect(parsed.success).toBe(true)
  })

  it('rejects malformed event names and oversized property sets', () => {
    const parsed = analyticsEventSchema.safeParse({
      eventName: 'Booking Created',
      sessionId: 'short',
      properties: Object.fromEntries(Array.from({ length: 21 }, (_, index) => [`key${index}`, true])),
    })
    expect(parsed.success).toBe(false)
  })

  it('summarizes event counts', () => {
    expect(summarizeAnalyticsEvents([
      { eventName: 'page.view', properties: {} },
      { eventName: 'booking.created', properties: {} },
      { eventName: 'page.view', properties: {} },
    ])).toMatchObject({ total: 3, byEvent: { 'page.view': 2, 'booking.created': 1 } })
  })

  it('calculates the production conversion funnel', () => {
    const result = summarizeAnalyticsEvents([
      { eventName: 'auth.login', properties: { sessionId: 'a' } },
      { eventName: 'booking.started', properties: { sessionId: 'a' } },
      { eventName: 'booking.created', properties: { bookingId: 'b' } },
      { eventName: 'booking.vendor_accepted', properties: { bookingId: 'b' } },
      { eventName: 'booking.delivered', properties: { bookingId: 'b' } },
    ])
    expect(result.funnel.rates).toEqual({
      loginToBookingStarted: 100,
      bookingStartedToCreated: 100,
      createdToVendorAccepted: 100,
      acceptedToDelivered: 100,
    })
  })
})
