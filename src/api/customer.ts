import { apiFetch } from './client'

export type CustomerBooking = { id: string; service: string; location: string; status: string; amount: number; scheduledAt: string }
export type SavedAddress = { id: string; label: string; address: string; city: string; pincode: string; latitude?: number; longitude?: number }
export type CustomerSubscription = { id: string; name: string; status: 'active' | 'paused' | 'cancelled'; nextDelivery?: string; amount: number }
export type CustomerInvoice = { number: string; date: string; customer: string; service: string; location: string; amount: number; status: string }
export type SupportRequest = { id: string; subject: string; message: string; status: 'open' | 'in-progress' | 'resolved'; createdAt: string }
export type CustomerProfile = { name: string; email: string; phone: string }
export type TrackingSnapshot = { orderId: string; status: string; latitude?: number; longitude?: number; eta?: string; vehicle?: string; driver?: string; otpRequired?: boolean }
export type PaymentOrder = { id: string; amount: number; currency: string; keyId?: string }
export type PaymentVerification = { verified: boolean; orderId: string }
export type CreateBookingPayload = { serviceId: string; capacity: string; location: string; deliveryDate: string; notes?: string }
export type CreateSupportRequestPayload = { subject: string; message: string; orderId?: string; priority?: string }
export type WalletTransaction = { id: string; amount: number; type: string; status: string; createdAt?: string }

export const customerApi = {
  bookings: () => apiFetch<CustomerBooking[]>('/customer/orders'),
  createBooking: (payload: CreateBookingPayload) => apiFetch<{ id: string }>('/customer/orders', { method: 'POST', body: JSON.stringify(payload) }),
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
  subscriptions: () => apiFetch<CustomerSubscription[]>('/customer/subscriptions'),
  invoices: () => apiFetch<CustomerInvoice[]>('/customer/invoices'),
  support: () => apiFetch<SupportRequest[]>('/support/requests'),
  createSupportRequest: (payload: CreateSupportRequestPayload) => apiFetch<SupportRequest>('/support/requests', { method: 'POST', body: JSON.stringify(payload) }),
  profile: () => apiFetch<CustomerProfile>('/customer/profile'),
  updateProfile: (payload: CustomerProfile) => apiFetch<CustomerProfile>('/customer/profile', { method: 'PATCH', body: JSON.stringify(payload) }),
  wallet: () => apiFetch<WalletTransaction[]>('/customer/wallet'),
  topUpWallet: (amount: number) => apiFetch<WalletTransaction>('/customer/wallet/top-up', { method: 'POST', body: JSON.stringify({ amount }) }),
  updateSubscription: (id: string, status: CustomerSubscription['status']) => apiFetch<CustomerSubscription>(`/customer/subscriptions/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }),
  notifications: () => apiFetch<unknown[]>('/customer/notifications'),
  markNotificationRead: (id: string) => apiFetch<unknown>(`/customer/notifications/${id}/read`, { method: 'PATCH' }),
}
