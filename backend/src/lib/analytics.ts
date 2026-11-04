import { z } from 'zod'
import { supabase } from '../supabase.js'
import { logger } from '../lib/logger.js'

const maxPropertyKeyLength = 64
const maxPropertyValueLength = 200
const maxProperties = 20

export const analyticsEventSchema = z.object({
  eventName: z.string().regex(/^[a-z0-9._-]{2,80}$/),
  sessionId: z.string().regex(/^[a-zA-Z0-9._:-]{8,120}$/),
  // Public input is bounded rather than rejected: keys over 64 characters are dropped, string values are cut to 200 characters, and only the first 20 properties are kept.
  properties: z.record(z.string(), z.union([z.string(), z.number().finite(), z.boolean()])).default({}).transform((properties) => Object.fromEntries(
    Object.entries(properties)
      .filter(([key]) => key.length <= maxPropertyKeyLength)
      .slice(0, maxProperties)
      .map(([key, value]) => [key, typeof value === 'string' ? value.slice(0, maxPropertyValueLength) : value]),
  )),
})

export type AnalyticsEvent = z.infer<typeof analyticsEventSchema>

export async function recordAnalyticsEvent(eventName: string, properties: Record<string, string | number | boolean> = {}) {
  const { error } = await supabase.from('analytics_events').insert({
    event_name: eventName,
    session_id: 'server',
    properties,
  })
  if (error) logger.error('analytics.persist_failed', { eventName, error: error.message })
}

export const analyticsEventNames = {
  login: 'auth.login',
  bookingStarted: 'booking.started',
  bookingCreated: 'booking.created',
  vendorAccepted: 'booking.vendor_accepted',
  rejected: 'booking.rejected',
  delivered: 'booking.delivered',
} as const

export function summarizeAnalyticsEvents(events: Array<Pick<AnalyticsEvent, 'eventName' | 'properties'> & { createdAt?: string }>) {
  const byEvent: Record<string, number> = {}
  for (const event of events) byEvent[event.eventName] = (byEvent[event.eventName] ?? 0) + 1
  const unique = (name: string) => new Set(events.filter((event) => event.eventName === name).map((event) => String(event.properties.bookingId ?? event.properties.sessionId ?? `${name}:${events.indexOf(event)}`))).size
  const login = unique(analyticsEventNames.login)
  const bookingStarted = unique(analyticsEventNames.bookingStarted)
  const bookingCreated = unique(analyticsEventNames.bookingCreated)
  const vendorAccepted = unique(analyticsEventNames.vendorAccepted)
  const delivered = unique(analyticsEventNames.delivered)
  const rate = (numerator: number, denominator: number) => denominator ? Math.round((numerator / denominator) * 10000) / 100 : 0
  return {
    total: events.length,
    byEvent,
    funnel: {
      login,
      bookingStarted,
      bookingCreated,
      vendorAccepted,
      delivered,
      rates: {
        loginToBookingStarted: rate(bookingStarted, login),
        bookingStartedToCreated: rate(bookingCreated, bookingStarted),
        createdToVendorAccepted: rate(vendorAccepted, bookingCreated),
        acceptedToDelivered: rate(delivered, vendorAccepted),
      },
    },
  }
}
