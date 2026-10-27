import { supabase } from '../supabase.js'

export type BookingStatus = 'pending_vendor' | 'vendor_assigned' | 'accepted' | 'en_route' | 'arrived' | 'delivered' | 'cancelled'

const allowedTransitions: Record<BookingStatus, BookingStatus[]> = {
  pending_vendor: ['vendor_assigned', 'accepted', 'cancelled'],
  vendor_assigned: ['accepted', 'cancelled'],
  accepted: ['en_route', 'cancelled'],
  en_route: ['arrived'],
  arrived: ['delivered'],
  delivered: [],
  cancelled: [],
}

export function isBookingTransitionAllowed(current: BookingStatus, next: BookingStatus) {
  return allowedTransitions[current].includes(next)
}

export async function transitionBooking(input: { bookingId: string; actorId: string; status: BookingStatus; cancellationReason?: string; vendorId?: string; vehicleId?: string; driverId?: string }) {
  return supabase.rpc('transition_booking', {
    p_booking_id: input.bookingId,
    p_actor_id: input.actorId,
    p_next_status: input.status,
    p_vendor_id: input.vendorId ?? null,
    p_vehicle_id: input.vehicleId ?? null,
    p_driver_id: input.driverId ?? null,
    p_cancellation_reason: input.cancellationReason ?? null,
  })
}