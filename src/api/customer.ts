import { apiFetch } from './client'

export type CustomerBooking = { id: string; service: string; services: BookingServiceDetails[]; location: string; status: string; amount: number; scheduledAt: string; phone?: string; notes?: string; paymentMethod?: BookingPaymentMethod; latitude?: number; longitude?: number }
export type SavedAddress = { id: string; label: string; address: string; city: string; pincode: string; latitude?: number; longitude?: number }
export type CustomerSubscription = { id: string; name: string; status: 'active' | 'paused' | 'cancelled'; nextDelivery?: string; amount: number }
export type MembershipPlan = { id: string; name: string; description: string; amount: number; billing_period: string; benefits: string[] }
export type CustomerMembership = { id: string; plan_id: string; status: 'requested' | 'active' | 'paused' | 'cancelled'; plan?: MembershipPlan }
export type CustomerInvoice = { id?: string; number: string; date: string; customer: string; service: string; location: string; amount: number; status: string }
export type SupportRequest = { id: string; subject: string; message: string; response?: string; status: 'open' | 'in-progress' | 'resolved'; createdAt: string; updatedAt?: string }
export type CustomerUsage = { deliveries: number; totalSpend: number; averageAmount: number }
export type CustomerProfile = { name: string; email: string; phone: string }
export type CustomerProfileUpdate = Pick<CustomerProfile, 'name' | 'email'> & { phone?: string }
export type TrackingSnapshot = { orderId: string; status: string; latitude?: number; longitude?: number; customerLatitude?: number; customerLongitude?: number; eta?: string; vehicle?: string; driver?: string; otpRequired?: boolean; recorded_at?: string; recordedAt?: string; trackingAvailable?: boolean }
export type PaymentOrder = { id: string; amount: number; currency: string; keyId?: string }
export type PaymentVerification = { verified: boolean; orderId: string }
export type BookingPaymentMethod = 'wallet' | 'gateway' | 'cod'
export type BookingServiceDetails = { serviceId: string; capacity?: string; details: string; deliveryDate?: string; location?: string; phone?: string; latitude?: number; longitude?: number; phoneVerificationChallengeId?: string }
export type CreateBookingPayload = { serviceId: string; services: BookingServiceDetails[]; capacity: string; location: string; deliveryDate: string; notes?: string; couponCode?: string; phone?: string; phoneVerificationChallengeId?: string; latitude?: number; longitude?: number; paymentMethod?: BookingPaymentMethod }
export type GuestOtpChallenge = { challengeId: string; expiresInSeconds: number }
export type GuestSession = { accessToken: string; user: { username: string; name: string; role: 'customer' } }
export type CreateSupportRequestPayload = { subject: string; message: string; orderId?: string; priority?: string }
export type WalletTransaction = { id: string; amount: number; type: string; status: string; createdAt?: string }
export type CustomerContract = { id: string; property_type: string; service_plan: Record<string, unknown>; address: string; estimate: number; status: string; created_at: string }
export type CustomerOffer = { id: string; code: string; title: string; discount_type: string; discount_value: number; valid_until?: string }
export type CustomerService = { code: string; name: string; description?: string; base_price_paise: number; is_active: boolean }
export type CustomerPhoneVerification = { phone: string; verified: boolean }
export type PublicTracking = {
  bookingReference: string
  status: string
  expectedDelivery?: string | null
  vehicle?: string | null
  driver?: string | null
  lastLocation?: { latitude: number; longitude: number; accuracy?: number | null; recordedAt?: string | null } | null
  events: { status: string; note?: string | null; createdAt: string }[]
  trackingAvailable: boolean
}
const bookingStatusMap: Record<string, string> = { pending_vendor: 'pending_vendor', vendor_assigned: 'vendor_assigned', accepted: 'accepted', en_route: 'en_route', arrived: 'arrived', delivered: 'delivered', cancelled: 'cancelled' }
function normalizeBooking(item: Record<string, unknown>): CustomerBooking {
  const services = Array.isArray(item.service_details)
    ? item.service_details.flatMap((entry) => {
      if (!entry || typeof entry !== 'object') return []
      const detail = entry as Record<string, unknown>
      if (typeof detail.serviceId !== 'string') return []
      return [{
        serviceId: detail.serviceId,
        capacity: typeof detail.capacity === 'string' ? detail.capacity : '',
        details: typeof detail.details === 'string' ? detail.details : '',
        deliveryDate: typeof detail.deliveryDate === 'string' ? detail.deliveryDate : undefined,
        location: typeof detail.location === 'string' ? detail.location : undefined,
        phone: typeof detail.phone === 'string' ? detail.phone : undefined,
        latitude: typeof detail.latitude === 'number' ? detail.latitude : undefined,
        longitude: typeof detail.longitude === 'number' ? detail.longitude : undefined,
      }]
    })
    : []
  if (!services.length && typeof item.service_code === 'string') {
    services.push({
      serviceId: item.service_code,
      capacity: typeof item.capacity_litres === 'number' ? `${item.capacity_litres} litres` : '',
      details: '',
      deliveryDate: typeof item.scheduled_for === 'string' ? item.scheduled_for : undefined,
      location: typeof item.address_text === 'string' ? item.address_text : undefined,
      phone: typeof item.customer_phone_e164 === 'string' ? item.customer_phone_e164.replace(/^\+91/, '') : undefined,
      latitude: typeof item.latitude === 'number' ? item.latitude : undefined,
      longitude: typeof item.longitude === 'number' ? item.longitude : undefined,
    })
  }
  const serviceNames = services.map((service) => service.serviceId).filter(Boolean)
  const paymentMethod = ['wallet', 'gateway', 'cod'].includes(String(item.payment_method))
    ? item.payment_method as BookingPaymentMethod
    : undefined
  return {
    id: String(item.id ?? item.reference),
    service: serviceNames.join(', ') || String(item.service ?? item.service_code ?? 'Service'),
    services,
    location: String(item.location ?? item.address_text ?? ''),
    status: bookingStatusMap[String(item.status)] ?? String(item.status ?? 'pending_vendor'),
    amount: Number(item.amount ?? item.quoted_amount_paise ?? 0) / (item.quoted_amount_paise !== undefined && item.amount === undefined ? 100 : 1),
    scheduledAt: String(item.scheduledAt ?? item.scheduled_for ?? services[0]?.deliveryDate ?? ''),
    phone: typeof item.phone === 'string' ? item.phone : typeof item.customer_phone_e164 === 'string' ? item.customer_phone_e164 : undefined,
    notes: typeof item.notes === 'string' ? item.notes : typeof item.access_notes === 'string' ? item.access_notes : undefined,
    paymentMethod,
    latitude: typeof item.latitude === 'number' ? item.latitude : undefined,
    longitude: typeof item.longitude === 'number' ? item.longitude : undefined,
  }
}
function normalizeSubscription(item: Record<string, unknown>): CustomerSubscription { return { id: String(item.id), name: String(item.name ?? item.plan_id ?? 'Subscription'), status: item.status as CustomerSubscription['status'], nextDelivery: item.nextDelivery as string | undefined ?? item.next_delivery as string | undefined, amount: Number(item.amount ?? 0) } }

export const customerApi = {
  requestGuestOtp: (phone: string) => apiFetch<GuestOtpChallenge>('/auth/guest/request-otp', { method: 'POST', body: JSON.stringify({ phone }) }),
  verifyGuestOtp: (payload: { challengeId: string; phone: string; otp: string; name?: string }) => apiFetch<GuestSession>('/auth/guest/verify-otp', { method: 'POST', body: JSON.stringify(payload) }),
  verifyContactPhoneOtp: (payload: { challengeId: string; phone: string; otp: string }) => apiFetch<{ verified: boolean }>('/auth/guest/verify-phone', { method: 'POST', body: JSON.stringify(payload) }),
  bookings: async () => (await apiFetch<Record<string, unknown>[]>('/customer/orders')).map(normalizeBooking),
  phoneVerification: () => apiFetch<CustomerPhoneVerification>('/customer/phone-verification'),
  services: () => apiFetch<CustomerService[]>('/customer/services'),
  createBooking: (payload: CreateBookingPayload) => apiFetch<{ id: string; quotedAmountPaise?: number }>('/customer/orders/quote', { method: 'POST', body: JSON.stringify(payload) }),
  tracking: (orderId: string) => apiFetch<TrackingSnapshot>(`/customer/orders/${orderId}/tracking`),
  publicTracking: (token: string) => apiFetch<PublicTracking>(`/public/tracking/${encodeURIComponent(token)}`),
  requestDeliveryOtp: (orderId: string) => apiFetch<{ expiresAt: string }>(`/customer/orders/${orderId}/delivery-otp`, { method: 'POST' }),
  rescheduleBooking: (orderId: string, scheduledFor: string) => apiFetch<CustomerBooking>(`/customer/orders/${orderId}/reschedule`, { method: 'PATCH', body: JSON.stringify({ scheduledFor }) }),
  cancelBooking: (orderId: string) => apiFetch<CustomerBooking>(`/customer/orders/${orderId}/status`, { method: 'PATCH', body: JSON.stringify({ status: 'cancelled' }) }),
  rateBooking: (orderId: string, rating: number, review?: string) => apiFetch<unknown>(`/customer/orders/${orderId}/rating`, { method: 'POST', body: JSON.stringify({ rating, review }) }),
  createPaymentOrder: (payload: { amount: number; bookingId: string }) => apiFetch<PaymentOrder>('/payment/razorpay/order', { method: 'POST', body: JSON.stringify(payload) }),
  verifyPayment: (payload: { orderId: string; paymentId: string; signature: string }) => apiFetch<PaymentVerification>('/payment/razorpay/verify', { method: 'POST', body: JSON.stringify(payload) }),
  addresses: () => apiFetch<SavedAddress[]>('/customer/addresses'),
  createAddress: (payload: Omit<SavedAddress, 'id'>) => apiFetch<SavedAddress>('/customer/addresses', { method: 'POST', body: JSON.stringify(payload) }),
  deleteAddress: (id: string) => apiFetch<void>(`/customer/addresses/${id}`, { method: 'DELETE' }),
  subscriptions: async () => (await apiFetch<Record<string, unknown>[]>('/customer/subscriptions')).map(normalizeSubscription),
  invoices: () => apiFetch<CustomerInvoice[]>('/customer/invoices'),
  downloadInvoice: (id: string) => apiFetch<CustomerInvoice>(`/customer/invoices/${id}/download`),
  support: () => apiFetch<SupportRequest[]>('/support/requests'),
  usage: () => apiFetch<CustomerUsage>('/customer/usage'),
  createSupportRequest: (payload: CreateSupportRequestPayload) => apiFetch<SupportRequest>('/support/requests', { method: 'POST', body: JSON.stringify(payload) }),
  profile: () => apiFetch<CustomerProfile>('/customer/profile'),
  updateProfile: (payload: CustomerProfileUpdate) => apiFetch<CustomerProfile>('/customer/profile', { method: 'PATCH', body: JSON.stringify(payload) }),
  wallet: () => apiFetch<WalletTransaction[]>('/customer/wallet'),
  topUpWallet: (amount: number) => apiFetch<WalletTransaction>('/customer/wallet/top-up', { method: 'POST', body: JSON.stringify({ amount }) }),
  createWalletTopUpOrder: (amount: number) => apiFetch<PaymentOrder>('/customer/wallet/top-up/order', { method: 'POST', body: JSON.stringify({ amount }) }),
  verifyWalletTopUp: (payload: { orderId: string; paymentId: string; signature: string }) => apiFetch<{ verified: boolean; transactionId: string }>('/customer/wallet/top-up/verify', { method: 'POST', body: JSON.stringify(payload) }),
  updateSubscription: (id: string, status: CustomerSubscription['status']) => apiFetch<CustomerSubscription>(`/customer/subscriptions/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }),
  contracts: () => apiFetch<CustomerContract[]>('/customer/contracts'),
  createContract: (payload: { propertyType: string; servicePlan: Record<string, unknown>; address: string; estimate: number }) => apiFetch<CustomerContract>('/customer/contracts', { method: 'POST', body: JSON.stringify(payload) }),
  offers: () => apiFetch<CustomerOffer[]>('/customer/offers'),
  membershipPlans: () => apiFetch<MembershipPlan[]>('/customer/membership-plans'),
  membership: () => apiFetch<CustomerMembership | null>('/customer/membership'),
  requestMembership: (planId: string) => apiFetch<CustomerMembership>('/customer/membership', { method: 'POST', body: JSON.stringify({ planId }) }),
  updateMembership: (status: CustomerMembership['status']) => apiFetch<CustomerMembership>('/customer/membership', { method: 'PATCH', body: JSON.stringify({ status }) }),
  savePushSubscription: (subscription: PushSubscriptionJSON) => apiFetch<void>('/customer/push-subscription', { method: 'POST', body: JSON.stringify(subscription) }),
  removePushSubscription: (endpoint: string) => apiFetch<void>('/customer/push-subscription', { method: 'DELETE', body: JSON.stringify({ endpoint }) }),
  notifications: () => apiFetch<unknown[]>('/customer/notifications'),
  markNotificationRead: (id: string) => apiFetch<unknown>(`/customer/notifications/${id}/read`, { method: 'PATCH' }),
}
