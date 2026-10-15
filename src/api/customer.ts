import { apiFetch } from './client'

export type CustomerBooking = { id: string; service: string; location: string; status: string; amount: number; scheduledAt: string }
export type SavedAddress = { id: string; label: string; address: string; city: string; pincode: string; latitude?: number; longitude?: number }
export type CustomerSubscription = { id: string; name: string; status: 'active' | 'paused' | 'cancelled'; nextDelivery?: string; amount: number }
export type MembershipPlan = { id: string; name: string; description: string; amount: number; billing_period: string; benefits: string[] }
export type CustomerMembership = { id: string; plan_id: string; status: 'requested' | 'active' | 'paused' | 'cancelled'; plan?: MembershipPlan }
export type CustomerInvoice = { id?: string; number: string; date: string; customer: string; service: string; location: string; amount: number; status: string }
export type SupportRequest = { id: string; subject: string; message: string; response?: string; status: 'open' | 'in-progress' | 'resolved'; createdAt: string; updatedAt?: string }
export type CustomerUsage = { deliveries: number; totalSpend: number; averageAmount: number }
export type CustomerProfile = { name: string; email: string; phone: string }
export type TrackingSnapshot = { orderId: string; status: string; latitude?: number; longitude?: number; customerLatitude?: number; customerLongitude?: number; eta?: string; vehicle?: string; driver?: string; otpRequired?: boolean; recorded_at?: string; recordedAt?: string; trackingAvailable?: boolean }
export type PaymentOrder = { id: string; amount: number; currency: string; keyId?: string }
export type PaymentVerification = { verified: boolean; orderId: string }
export type CreateBookingPayload = { serviceId: string; capacity: string; location: string; deliveryDate: string; notes?: string; couponCode?: string; phone?: string; latitude?: number; longitude?: number }
export type GuestOtpChallenge = { challengeId: string; expiresInSeconds: number }
export type GuestSession = { accessToken: string; refreshToken: string; user: { username: string; name: string; role: 'customer' } }
export type CreateSupportRequestPayload = { subject: string; message: string; orderId?: string; priority?: string }
export type WalletTransaction = { id: string; amount: number; type: string; status: string; createdAt?: string }
export type CustomerContract = { id: string; property_type: string; service_plan: Record<string, unknown>; address: string; estimate: number; status: string; created_at: string }
export type CustomerOffer = { id: string; code: string; title: string; discount_type: string; discount_value: number; valid_until?: string }
export type CustomerService = { code: string; name: string; description?: string; base_price_paise: number; is_active: boolean }
const bookingStatusMap: Record<string, string> = { pending_vendor: 'pending_vendor', vendor_assigned: 'vendor_assigned', accepted: 'accepted', en_route: 'en_route', arrived: 'arrived', delivered: 'delivered', cancelled: 'cancelled' }
function normalizeBooking(item: Record<string, unknown>): CustomerBooking { return { id: String(item.id ?? item.reference), service: String(item.service ?? item.service_code ?? 'Service'), location: String(item.location ?? item.address_text ?? ''), status: bookingStatusMap[String(item.status)] ?? String(item.status ?? 'pending_vendor'), amount: Number(item.amount ?? item.quoted_amount_paise ?? 0) / (item.quoted_amount_paise !== undefined && item.amount === undefined ? 100 : 1), scheduledAt: String(item.scheduledAt ?? item.scheduled_for ?? '') } }
function normalizeSubscription(item: Record<string, unknown>): CustomerSubscription { return { id: String(item.id), name: String(item.name ?? item.plan_id ?? 'Subscription'), status: item.status as CustomerSubscription['status'], nextDelivery: item.nextDelivery as string | undefined ?? item.next_delivery as string | undefined, amount: Number(item.amount ?? 0) } }

export const customerApi = {
  requestGuestOtp: (phone: string) => apiFetch<GuestOtpChallenge>('/auth/guest/request-otp', { method: 'POST', body: JSON.stringify({ phone }) }),
  verifyGuestOtp: (payload: { challengeId: string; phone: string; otp: string; name?: string }) => apiFetch<GuestSession>('/auth/guest/verify-otp', { method: 'POST', body: JSON.stringify(payload) }),
  bookings: async () => (await apiFetch<Record<string, unknown>[]>('/customer/orders')).map(normalizeBooking),
  services: () => apiFetch<CustomerService[]>('/customer/services'),
  createBooking: (payload: CreateBookingPayload) => apiFetch<{ id: string; quotedAmountPaise?: number }>('/customer/orders/quote', { method: 'POST', body: JSON.stringify(payload) }),
  tracking: (orderId: string) => apiFetch<TrackingSnapshot>(`/customer/orders/${orderId}/tracking`),
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
  updateProfile: (payload: CustomerProfile) => apiFetch<CustomerProfile>('/customer/profile', { method: 'PATCH', body: JSON.stringify(payload) }),
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
