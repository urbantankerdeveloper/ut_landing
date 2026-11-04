import { feedbackContent } from './feedback'

type WriteRule = { method: string; route: string; message: string | 'silent' }

const rules: WriteRule[] = [
  { method: 'POST', route: '/admin/customers', message: 'Customer added.' },
  { method: 'PATCH', route: '/admin/customers/:id', message: 'Customer updated.' },
  { method: 'DELETE', route: '/admin/customers/:id', message: 'Customer deleted.' },
  { method: 'POST', route: '/admin/vendors', message: 'Vendor added.' },
  { method: 'POST', route: '/admin/vendors/:id/provision', message: 'Vendor login created.' },
  { method: 'PATCH', route: '/admin/vendors/:id', message: 'Vendor updated.' },
  { method: 'PATCH', route: '/admin/vendors/:id/status', message: 'Vendor status updated.' },
  { method: 'DELETE', route: '/admin/vendors/:id', message: 'Vendor deleted.' },
  { method: 'POST', route: '/admin/vehicles', message: 'Vehicle added.' },
  { method: 'PATCH', route: '/admin/vehicles/:id', message: 'Vehicle updated.' },
  { method: 'PATCH', route: '/admin/vehicles/:id/status', message: 'Vehicle status updated.' },
  { method: 'DELETE', route: '/admin/vehicles/:id', message: 'Vehicle deleted.' },
  { method: 'POST', route: '/admin/drivers', message: 'Driver added.' },
  { method: 'PATCH', route: '/admin/drivers/:id', message: 'Driver updated.' },
  { method: 'PATCH', route: '/admin/drivers/:id/status', message: 'Driver status updated.' },
  { method: 'DELETE', route: '/admin/drivers/:id', message: 'Driver deleted.' },
  { method: 'PATCH', route: '/admin/orders/:id/assignment', message: 'Order assignment updated.' },
  { method: 'PATCH', route: '/admin/orders/:id/status', message: 'Order status updated.' },
  { method: 'POST', route: '/admin/orders/:id/cancel', message: 'Order cancelled.' },
  { method: 'POST', route: '/admin/reports', message: 'Report created.' },
  { method: 'DELETE', route: '/admin/coupons/:id', message: 'Coupon deleted.' },
  { method: 'PATCH', route: '/admin/services/:id/pricing', message: 'Pricing updated.' },
  { method: 'PATCH', route: '/admin/subscriptions/:id', message: 'Subscription updated.' },
  { method: 'PATCH', route: '/admin/contracts/:id', message: 'Contract updated.' },
  { method: 'PATCH', route: '/admin/enquiries/:id', message: 'Enquiry updated.' },
  { method: 'POST', route: '/admin/payouts/settle', message: 'Payout settled.' },
  { method: 'PATCH', route: '/admin/complaints/:id', message: 'Complaint updated.' },
  { method: 'POST', route: '/admin/sms-templates', message: 'SMS template created.' },
  { method: 'PATCH', route: '/admin/sms-templates/:key', message: 'SMS template updated.' },
  { method: 'POST', route: '/payment/payments/:id/refund', message: 'Refund issued.' },
  { method: 'PATCH', route: '/admin/notifications/:id/read', message: 'Notification marked as read.' },

  { method: 'POST', route: '/auth/guest/verify-otp', message: feedbackContent.success.signedIn },
  { method: 'POST', route: '/customer/orders/quote', message: 'silent' },
  { method: 'POST', route: '/orders', message: feedbackContent.success.booked },
  { method: 'POST', route: '/customer/orders/:id/delivery-otp', message: 'Delivery code sent.' },
  { method: 'PATCH', route: '/customer/orders/:id/reschedule', message: 'Booking rescheduled.' },
  { method: 'PATCH', route: '/customer/orders/:id/status', message: 'Booking updated.' },
  { method: 'POST', route: '/customer/orders/:id/rating', message: 'Thanks for your rating.' },
  { method: 'POST', route: '/payment/razorpay/order', message: 'silent' },
  { method: 'POST', route: '/payment/razorpay/verify', message: 'Payment received.' },
  { method: 'POST', route: '/customer/addresses', message: 'Address saved.' },
  { method: 'DELETE', route: '/customer/addresses/:id', message: 'Address deleted.' },
  { method: 'POST', route: '/support/requests', message: 'Your request is sent. We will be in touch.' },
  { method: 'PATCH', route: '/customer/profile', message: 'Profile updated.' },
  { method: 'POST', route: '/customer/wallet/top-up', message: 'Wallet topped up.' },
  { method: 'POST', route: '/customer/wallet/top-up/order', message: 'silent' },
  { method: 'POST', route: '/customer/wallet/top-up/verify', message: 'Wallet topped up.' },
  { method: 'PATCH', route: '/customer/subscriptions/:id/status', message: 'Subscription updated.' },
  { method: 'POST', route: '/customer/contracts', message: 'Contract created.' },
  { method: 'POST', route: '/customer/membership', message: 'Membership updated.' },
  { method: 'PATCH', route: '/customer/membership', message: 'Membership updated.' },
  { method: 'POST', route: '/customer/push-subscription', message: 'Notifications turned on.' },
  { method: 'DELETE', route: '/customer/push-subscription', message: 'Notifications turned off.' },
  { method: 'PATCH', route: '/customer/notifications/:id/read', message: 'Notification marked as read.' },

  { method: 'PATCH', route: '/vendor/profile/location', message: 'Location updated.' },
  { method: 'PATCH', route: '/vendor/orders/:id/transition', message: 'Order status updated.' },
  { method: 'POST', route: '/vendor/vehicles', message: 'Vehicle added.' },
  { method: 'PATCH', route: '/vendor/vehicles/:id', message: 'Vehicle updated.' },
  { method: 'POST', route: '/vendor/drivers', message: 'Driver added.' },
  { method: 'PATCH', route: '/vendor/drivers/:id', message: 'Driver updated.' },
  { method: 'POST', route: '/vendor/attendance', message: 'Attendance marked.' },
  { method: 'POST', route: '/vendor/location', message: 'silent' },
  { method: 'POST', route: '/vendor/services', message: 'Service added.' },
  { method: 'PATCH', route: '/vendor/services/:code/availability', message: 'Service availability updated.' },
  { method: 'POST', route: '/vendor/complaints', message: 'Complaint submitted.' },
  { method: 'PATCH', route: '/vendor/complaints/:id', message: 'Complaint updated.' },
  { method: 'POST', route: '/vendor/documents', message: 'Document uploaded.' },
  { method: 'PATCH', route: '/vendor/documents/:id', message: 'Document updated.' },
  { method: 'POST', route: '/vendor/payouts/request', message: 'Payout requested.' },
  { method: 'PATCH', route: '/vendor/notifications/:id/read', message: 'Notification marked as read.' },
  { method: 'POST', route: '/vendor/orders/:id/delivery/verify', message: 'Delivery verified.' },
  { method: 'POST', route: '/vendor/offline-mutations', message: 'Change queued. It will sync when you are online.' },
  { method: 'POST', route: '/vendor/offline-mutations/:id/retry', message: 'Retrying sync.' },
  { method: 'DELETE', route: '/vendor/offline-mutations/:id', message: 'Queued change discarded.' },
]

// Turns a route template such as /admin/vendors/:id into an anchored regex.
function toPattern(route: string): RegExp {
  const source = route
    .split('/')
    .map((segment) => (segment.startsWith(':') ? '[^/]+' : segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    .join('/')
  return new RegExp(`^${source}$`)
}

const compiled = rules.map((rule) => ({ ...rule, pattern: toPattern(rule.route) }))

// Returns the confirmation for a successful write. Unlisted routes fall back to the generic saved text.
export function resolveWriteMessage(method: string, path: string): { message: string; silent: boolean } {
  const bare = path.split('?')[0]
  const rule = compiled.find((item) => item.method === method && item.pattern.test(bare))
  if (rule?.message === 'silent') return { message: '', silent: true }
  return { message: rule?.message ?? feedbackContent.success.saved, silent: false }
}
