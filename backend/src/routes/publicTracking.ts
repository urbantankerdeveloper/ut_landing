import { Router } from 'express'
import { supabase } from '../supabase.js'
import { hashTrackingToken } from '../services/trackingTokens.js'

const router = Router()

// The driver is named only while the delivery is in progress.
const driverVisibleStatuses = ['vendor_assigned', 'accepted', 'en_route', 'arrived']
// After arrival the location is rounded to about 110 m.
const coarseLocationStatuses = ['arrived', 'delivered']

export function publicDriverName(status: string, name: string | null | undefined) {
  if (!driverVisibleStatuses.includes(status)) return null
  return name?.trim().split(/\s+/)[0] || null
}

export function publicCoordinate(value: number, status: string) {
  return coarseLocationStatuses.includes(status) ? Math.round(value * 1000) / 1000 : value
}

router.get('/tracking/:token', async (request, response) => {
  const token = request.params.token
  if (!/^[A-Za-z0-9_-]{40,60}$/.test(token)) return response.status(404).json({ error: 'Tracking link not found' })

  const { data: booking, error: bookingError } = await supabase
    .from('bookings')
    .select('id,reference,status,scheduled_for,vehicle_id,driver_id,tracking_token_expires_at')
    .eq('tracking_token_hash', hashTrackingToken(token))
    .maybeSingle()
  if (bookingError) return response.status(500).json({ error: bookingError.message })
  if (!booking || !booking.tracking_token_expires_at || new Date(booking.tracking_token_expires_at).getTime() <= Date.now()) {
    return response.status(404).json({ error: 'Tracking link not found or expired' })
  }

  const [eventsResult, locationResult, vehicleResult, driverResult] = await Promise.all([
    supabase.from('booking_events').select('from_status,to_status,note,created_at').eq('booking_id', booking.id).order('created_at', { ascending: true }),
    supabase.from('vendor_location_updates').select('latitude,longitude,accuracy_metres,recorded_at').eq('booking_id', booking.id).order('recorded_at', { ascending: false }).limit(1).maybeSingle(),
    booking.vehicle_id ? supabase.from('vehicles').select('registration_number').eq('id', booking.vehicle_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
    booking.driver_id && driverVisibleStatuses.includes(booking.status) ? supabase.from('drivers').select('name').eq('id', booking.driver_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
  ])
  const queryError = eventsResult.error ?? locationResult.error ?? vehicleResult.error ?? driverResult.error
  if (queryError) return response.status(500).json({ error: queryError.message })

  response.json({
    bookingReference: booking.reference,
    status: booking.status,
    expectedDelivery: booking.scheduled_for,
    vehicle: vehicleResult.data?.registration_number ?? null,
    driver: publicDriverName(booking.status, driverResult.data?.name),
    lastLocation: locationResult.data ? {
      latitude: publicCoordinate(locationResult.data.latitude, booking.status),
      longitude: publicCoordinate(locationResult.data.longitude, booking.status),
      accuracy: locationResult.data.accuracy_metres,
      recordedAt: locationResult.data.recorded_at,
    } : null,
    events: (eventsResult.data ?? []).map((event) => ({
      status: event.to_status,
      note: event.note,
      createdAt: event.created_at,
    })),
    trackingAvailable: Boolean(locationResult.data),
  })
})

export default router
