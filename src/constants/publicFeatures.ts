export function parseBookingButtonSetting(value: string | undefined) {
  return value === 'true'
}

export const bookingButtonEnabled = parseBookingButtonSetting(import.meta.env.VITE_SHOW_BOOKING_BUTTON)

export function shouldShowBookingButton(role: string | null | undefined, enabled = bookingButtonEnabled) {
  return enabled && (!role || role === 'customer' || role === 'admin')
}
