import { ApiError, apiFetch } from './client'
import { feedbackContent } from '../content/feedback'

export type CustomerOrderItem = { id: string; serviceId: string; serviceName: string; status: string; details: BookingServiceDetails; amountPaise: number; location?: string; scheduledAt?: string; fulfilmentId?: string }
export type CustomerOrderFulfilment = { id: string; status: string; itemIds: string[]; amountPaise: number; location?: string; scheduledAt?: string; vendorName?: string }
export type MultiServiceOrderItemInput = { couponCode?: string; serviceId: string; quantity: number; quantityUnit?: string; location: string; deliveryDate: string; slot?: string; latitude?: number; longitude?: number; capacity?: string; waterType?: string; serviceType?: string; details?: Record<string, unknown> }
export type MultiServiceOrderResult = { id: string; order_group_reference?: string; reference?: string; legacyBookingId: string; total_paise?: number; quote?: { subtotalPaise: number; gstPaise: number; bundleDiscountPaise: number; deliveryChargesPaise: number; totalPaise: number }; quoted_amount_paise?: number; items: Record<string, unknown>[]; fulfilments: Record<string, unknown>[] }
export type CustomerBooking = { id: string; orderId?: string; reference?: string; orderGroupId?: string; orderGroupReference?: string; orderGroupSize?: number; service: string; services: BookingServiceDetails[]; orderItems?: CustomerOrderItem[]; fulfilments?: CustomerOrderFulfilment[]; location: string; status: string; amount: number; scheduledAt: string; phone?: string; notes?: string; paymentMethod?: BookingPaymentMethod; latitude?: number; longitude?: number }
export type CustomerBookingPage = { rows: CustomerBooking[]; nextOffset: number | null }
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
export type CreateBookingResult = { id: string; reference?: string; order_group_reference?: string; order_group_size?: number; tasks?: Record<string, unknown>[]; quoted_amount_paise?: number; quote?: { totalPaise: number } }
export type PaymentTarget = { bookingId: string }
export type PaymentReceipt = { status: 'pending' | 'paid' | 'failed' | 'refunded'; amountPaise: number; currency: string; method: string | null; cardNetwork: string | null; cardLast4: string | null; bank: string | null; wallet: string | null; vpa: string | null; capturedAt: string | null; feePaise: number | null; taxPaise: number | null; refundedPaise: number | null }
export type BookingPaymentMethod = 'wallet' | 'gateway' | 'cod'
export type BookingServiceDetails = { serviceId: string; capacity?: string; waterType?: string; tankerCount?: string; serviceType?: string; quantity?: string; depth?: string; grade?: string; pump?: string; pickupLocation?: string; materialType?: string; details: string; deliveryDate?: string; preferredTime?: string; location?: string; phone?: string; latitude?: number; longitude?: number; phoneVerificationChallengeId?: string }
export type CreateBookingPayload = { idempotencyKey: string; serviceId: string; services: BookingServiceDetails[]; capacity: string; location: string; deliveryDate: string; preferredTime?: string; notes?: string; couponCode?: string; phone?: string; phoneVerificationChallengeId?: string; latitude?: number; longitude?: number; paymentMethod?: BookingPaymentMethod }
export type GuestOtpChallenge = { challengeId: string; channel: 'whatsapp' | 'sms'; expiresInSeconds: number; resendAfterSeconds: number }
export type GuestSession = { accessToken: string; user: { username: string; name: string; role: 'customer' } }
export type CreateSupportRequestPayload = { subject: string; message: string; orderId?: string; priority?: string }
type ServiceEnquiryContact = { customerName: string; mobile: string; email?: string; location: string; requiredDate: string }
export type ServiceEnquiryCategory = 'empty_tanker' | 'rmc' | 'borewell'
export type CreateServiceEnquiryPayload = ServiceEnquiryContact & (
  | { serviceCategory: 'empty_tanker'; details: { capacityLitres: number; requirements: string } }
  | { serviceCategory: 'rmc'; details: { grade: string; quantityCubicMetres: number; pumpRequired: boolean; requirements?: string } }
  | { serviceCategory: 'borewell'; details: { proposedDepthMetres: number; siteRequirements: string } }
)
export type CreateServiceEnquiryResult = { id: string; subject: string; status: string; createdAt: string; notificationStatus: 'created' | 'unavailable' }
export type WalletTransaction = { id: string; amount: number; type: string; status: string; createdAt?: string }
export type CustomerContract = { id: string; property_type: string; service_plan: Record<string, unknown>; address: string; estimate: number; status: string; created_at: string }
export type CustomerOffer = { id: string; code: string; title: string; discount_type: string; discount_value: number; valid_until?: string }
export type CustomerService = { code: string; name: string; description?: string; base_price_paise: number; is_active: boolean; min_quantity?: number; max_quantity?: number; unit?: string; service_type?: { min_quantity?: number; max_quantity?: number; unit?: string }; config?: { capacityOptions?: string[]; detailOptions?: string[]; waterTypeOptions?: string[]; tankerCountOptions?: string[]; optionSurchargesPaise?: Record<string, Record<string, number>> } }
export type CustomerPhoneVerification = { phone: string; verified: boolean; phoneVerified?: boolean; challengeId?: string | null; required?: boolean }
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
  const orderItems = Array.isArray(item.items)
    ? item.items.flatMap((entry) => {
      if (!entry || typeof entry !== 'object') return []
      const line = entry as Record<string, unknown>
      const lineDetailsValue = line.service_details ?? line.serviceDetails ?? line.details
      const lineDetails = lineDetailsValue && typeof lineDetailsValue === 'object' && !Array.isArray(lineDetailsValue)
        ? lineDetailsValue as Record<string, unknown>
        : {}
      const serviceType = line.service_type && typeof line.service_type === 'object'
        ? line.service_type as Record<string, unknown>
        : {}
      const serviceId = String(line.service_type_id ?? line.serviceTypeId ?? line.service_id ?? line.serviceId ?? lineDetails.serviceId ?? '')
      if (!serviceId) return []
      const details: BookingServiceDetails = {
        serviceId,
        capacity: typeof lineDetails.capacity === 'string' ? lineDetails.capacity : typeof line.capacity === 'string' ? line.capacity : '',
        waterType: typeof lineDetails.waterType === 'string' ? lineDetails.waterType : undefined,
        tankerCount: typeof lineDetails.tankerCount === 'string' ? lineDetails.tankerCount : undefined,
        serviceType: typeof lineDetails.serviceType === 'string' ? lineDetails.serviceType : undefined,
        quantity: typeof lineDetails.quantity === 'string' ? lineDetails.quantity : typeof line.quantity === 'string' ? line.quantity : undefined,
        depth: typeof lineDetails.depth === 'string' ? lineDetails.depth : undefined,
        grade: typeof lineDetails.grade === 'string' ? lineDetails.grade : undefined,
        pump: typeof lineDetails.pump === 'string' ? lineDetails.pump : undefined,
        pickupLocation: typeof lineDetails.pickupLocation === 'string' ? lineDetails.pickupLocation : undefined,
        materialType: typeof lineDetails.materialType === 'string' ? lineDetails.materialType : undefined,
        details: typeof lineDetails.details === 'string' ? lineDetails.details : typeof line.details === 'string' ? line.details : '',
        deliveryDate: typeof line.scheduled_for === 'string' ? line.scheduled_for : typeof line.scheduledFor === 'string' ? line.scheduledFor : typeof lineDetails.deliveryDate === 'string' ? lineDetails.deliveryDate : undefined,
        preferredTime: typeof lineDetails.preferredTime === 'string' ? lineDetails.preferredTime : undefined,
        location: typeof line.address_text === 'string' ? line.address_text : typeof line.location === 'string' ? line.location : undefined,
        phone: typeof lineDetails.phone === 'string' ? lineDetails.phone : undefined,
        latitude: typeof line.latitude === 'number' ? line.latitude : undefined,
        longitude: typeof line.longitude === 'number' ? line.longitude : undefined,
      }
      return [{
        id: String(line.id ?? line.item_id ?? serviceId),
        serviceId,
        serviceName: String(line.service_type_name ?? line.serviceName ?? serviceType.name ?? serviceId),
        status: String(line.status ?? 'pending'),
        details,
        amountPaise: Number(line.price_paise ?? line.amount_paise ?? line.quoted_amount_paise ?? line.quotedAmountPaise ?? 0),
        location: details.location,
        scheduledAt: details.deliveryDate,
        fulfilmentId: typeof line.fulfilment_id === 'string' ? line.fulfilment_id : typeof line.fulfilmentId === 'string' ? line.fulfilmentId : undefined,
      }]
    })
    : []
  const services: BookingServiceDetails[] = Array.isArray(item.service_details)
    ? item.service_details.flatMap((entry) => {
      if (!entry || typeof entry !== 'object') return []
      const detail = entry as Record<string, unknown>
      if (typeof detail.serviceId !== 'string') return []
      return [{
        serviceId: detail.serviceId,
        capacity: typeof detail.capacity === 'string' ? detail.capacity : '',
        waterType: typeof detail.waterType === 'string' ? detail.waterType : undefined,
        tankerCount: typeof detail.tankerCount === 'string' ? detail.tankerCount : undefined,
        serviceType: typeof detail.serviceType === 'string' ? detail.serviceType : undefined,
        quantity: typeof detail.quantity === 'string' ? detail.quantity : undefined,
        depth: typeof detail.depth === 'string' ? detail.depth : undefined,
        grade: typeof detail.grade === 'string' ? detail.grade : undefined,
        pump: typeof detail.pump === 'string' ? detail.pump : undefined,
        pickupLocation: typeof detail.pickupLocation === 'string' ? detail.pickupLocation : undefined,
        materialType: typeof detail.materialType === 'string' ? detail.materialType : undefined,
        details: typeof detail.details === 'string' ? detail.details : '',
        deliveryDate: typeof detail.deliveryDate === 'string' ? detail.deliveryDate : undefined,
        preferredTime: typeof detail.preferredTime === 'string' ? detail.preferredTime : undefined,
        location: typeof detail.location === 'string' ? detail.location : undefined,
        phone: typeof detail.phone === 'string' ? detail.phone : undefined,
        latitude: typeof detail.latitude === 'number' ? detail.latitude : undefined,
        longitude: typeof detail.longitude === 'number' ? detail.longitude : undefined,
      }]
    })
    : []
  if (!services.length) services.push(...orderItems.map((orderItem) => orderItem.details))
  if (!services.length && typeof item.service_code === 'string') {
    services.push({
      serviceId: item.service_code,
      capacity: typeof item.capacity_litres === 'number' ? `${item.capacity_litres} litres` : '',
      waterType: undefined,
      tankerCount: undefined,
      serviceType: undefined,
      quantity: undefined,
      depth: undefined,
      grade: undefined,
      pump: undefined,
      pickupLocation: undefined,
      materialType: undefined,
      details: '',
      deliveryDate: typeof item.scheduled_for === 'string' ? item.scheduled_for : undefined,
      preferredTime: undefined,
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
  const fulfilmentsValue = item.fulfilments ?? item.fulfillments
  const fulfilments = Array.isArray(fulfilmentsValue)
    ? fulfilmentsValue.flatMap((entry) => {
      if (!entry || typeof entry !== 'object') return []
      const fulfilment = entry as Record<string, unknown>
      const linkedItems = fulfilment.item_ids ?? fulfilment.itemIds ?? fulfilment.items
      const itemIds = Array.isArray(linkedItems)
        ? linkedItems.flatMap((linkedItem) => {
          if (typeof linkedItem === 'string') return [linkedItem]
          if (!linkedItem || typeof linkedItem !== 'object') return []
          const linkedRecord = linkedItem as Record<string, unknown>
          return typeof linkedRecord.id === 'string' ? [linkedRecord.id] : []
        })
        : []
      return [{
        id: String(fulfilment.id ?? ''),
        status: String(fulfilment.status ?? 'pending_vendor'),
        itemIds,
        amountPaise: Number(fulfilment.amount_paise ?? fulfilment.amountPaise ?? fulfilment.quoted_amount_paise ?? 0),
        location: typeof fulfilment.address_text === 'string' ? fulfilment.address_text : typeof fulfilment.location === 'string' ? fulfilment.location : undefined,
        scheduledAt: typeof fulfilment.scheduled_for === 'string' ? fulfilment.scheduled_for : typeof fulfilment.scheduledFor === 'string' ? fulfilment.scheduledFor : undefined,
        vendorName: typeof fulfilment.vendor_name === 'string' ? fulfilment.vendor_name : typeof fulfilment.vendorName === 'string' ? fulfilment.vendorName : undefined,
      }]
    })
    : []
  const totalPaise = item.total_paise ?? item.totalPaise ?? item.quoted_amount_paise
  return {
    id: String(item.id ?? item.reference),
    orderId: typeof item.order_id === 'string' ? item.order_id : undefined,
    reference: typeof item.reference === 'string' ? item.reference : undefined,
    orderGroupId: typeof item.order_group_id === 'string' ? item.order_group_id : undefined,
    orderGroupReference: typeof item.order_group_reference === 'string' ? item.order_group_reference : undefined,
    orderGroupSize: typeof item.order_group_size === 'number' ? item.order_group_size : undefined,
    service: serviceNames.join(', ') || String(item.service ?? item.service_code ?? 'Service'),
    services,
    orderItems,
    fulfilments,
    location: String(item.location ?? item.address_text ?? ''),
    status: bookingStatusMap[String(item.status)] ?? String(item.status ?? 'pending_vendor'),
    amount: item.amount !== undefined
      ? Number(item.amount)
      : totalPaise !== undefined
        ? Number(totalPaise) / 100
        : 0,
    scheduledAt: String(item.scheduledAt ?? item.scheduled_for ?? item.scheduledFor ?? services[0]?.deliveryDate ?? ''),
    phone: typeof item.phone === 'string' ? item.phone : typeof item.customer_phone_e164 === 'string' ? item.customer_phone_e164 : undefined,
    notes: typeof item.notes === 'string' ? item.notes : typeof item.access_notes === 'string' ? item.access_notes : undefined,
    paymentMethod,
    latitude: typeof item.latitude === 'number' ? item.latitude : undefined,
    longitude: typeof item.longitude === 'number' ? item.longitude : undefined,
  }
}
function normalizeSubscription(item: Record<string, unknown>): CustomerSubscription { return { id: String(item.id), name: String(item.name ?? item.plan_id ?? 'Subscription'), status: item.status as CustomerSubscription['status'], nextDelivery: item.nextDelivery as string | undefined ?? item.next_delivery as string | undefined, amount: Number(item.amount ?? 0) } }

// A 409 "already been processed" means the webhook or an earlier verify already settled this payment, so it counts as success.
async function verifyRazorpayPayment(payload: { orderId: string; paymentId: string; signature: string }): Promise<PaymentVerification> {
  try {
    return await apiFetch<PaymentVerification>('/payment/razorpay/verify', { method: 'POST', body: JSON.stringify(payload) })
  } catch (error) {
    if (error instanceof ApiError && error.status === 409 && /already been processed/i.test(error.serverMessage ?? '')) return { verified: true, orderId: payload.orderId }
    throw error
  }
}

// Returns null when the booking has no payment row yet.
async function fetchPaymentReceipt(bookingId: string): Promise<PaymentReceipt | null> {
  try {
    return await apiFetch<PaymentReceipt>(`/customer/payments/${bookingId}`)
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null
    throw error
  }
}

export const customerApi = {
  requestGuestOtp: (phone: string) => apiFetch<GuestOtpChallenge>('/auth/guest/request-otp', { method: 'POST', body: JSON.stringify({ phone }) }),
  verifyGuestOtp: (payload: { challengeId: string; phone: string; otp: string; name?: string }) => apiFetch<GuestSession>('/auth/guest/verify-otp', { method: 'POST', body: JSON.stringify(payload) }),
  verifyContactPhoneOtp: (payload: { challengeId: string; phone: string; otp: string }) => apiFetch<{ verified: boolean }>('/auth/guest/verify-phone', { method: 'POST', successMessage: feedbackContent.success.phoneVerified, body: JSON.stringify(payload) }),
  bookings: async (offset = 0) => {
    const path = offset === 0 ? '/customer/orders' : `/customer/orders?offset=${offset}&pageSize=100`
    const page = await apiFetch<{ rows: Record<string, unknown>[]; nextOffset: number | null } | Record<string, unknown>[]>(path)
    if (Array.isArray(page)) return { rows: page.map(normalizeBooking), nextOffset: null }
    return { rows: page.rows.map(normalizeBooking), nextOffset: page.nextOffset }
  },
  phoneVerification: () => apiFetch<CustomerPhoneVerification>('/customer/phone-verification'),
  services: () => apiFetch<CustomerService[]>('/customer/services'),
  pricing: () => apiFetch<{ gstPercentage: number; gstRate: number; gstWaived?: boolean; testPricingPerServicePaise?: number | null }>('/customer/pricing'),
  pricingForCustomer: () => apiFetch<{ gstPercentage: number; gstRate: number; gstWaived: boolean; testPricingPerServicePaise?: number | null }>('/customer/pricing/me'),
  createBooking: (payload: CreateBookingPayload) => apiFetch<CreateBookingResult>('/customer/orders/quote', { method: 'POST', body: JSON.stringify(payload) }),
  createMultiServiceOrder: (payload: { couponCode?: string; idempotencyKey: string; paymentMethod: BookingPaymentMethod; phone?: string; phoneVerificationChallengeId?: string; items: MultiServiceOrderItemInput[] }) => apiFetch<MultiServiceOrderResult>('/customer/multi-service-orders', { method: 'POST', body: JSON.stringify(payload) }),
  cancelUnpaidMultiServiceOrder: (orderId: string, couponCode?: string) => apiFetch<void>(`/customer/multi-service-orders/${orderId}/cancel-online-payment`, { method: 'POST', body: JSON.stringify({ couponCode }) }),
  updateMultiServiceOrderItem: (orderId: string, itemId: string, payload: { location?: string; scheduledFor?: string; slot?: string; latitude?: number; longitude?: number }) => apiFetch<unknown>(`/customer/orders/${orderId}/items/${itemId}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  cancelMultiServiceOrderItem: (orderId: string, itemId: string) => apiFetch<unknown>(`/customer/orders/${orderId}/items/${itemId}`, { method: 'DELETE' }),
  requestMultiServiceDeliveryOtp: (orderId: string, fulfilmentId: string) => apiFetch<{ fulfilmentId: string; expiresAt: string; message: string }>(`/customer/orders/${orderId}/fulfilments/${fulfilmentId}/delivery-otp`, { method: 'POST' }),
  rateMultiServiceFulfilment: (fulfilmentId: string, rating: number, review?: string) => apiFetch<unknown>(`/customer/multi-service-fulfilments/${fulfilmentId}/ratings`, { method: 'POST', body: JSON.stringify({ rating, review }) }),
  tracking: (orderId: string) => apiFetch<TrackingSnapshot>(`/customer/orders/${orderId}/tracking`),
  publicTracking: (token: string) => apiFetch<PublicTracking>(`/public/tracking/${encodeURIComponent(token)}`),
  requestDeliveryOtp: (orderId: string) => apiFetch<{ otp: string; expiresAt: string; smsSent: boolean }>(`/customer/orders/${orderId}/delivery-otp`, { method: 'POST' }),
  rescheduleBooking: (orderId: string, scheduledFor: string) => apiFetch<CustomerBooking>(`/customer/orders/${orderId}/reschedule`, { method: 'PATCH', body: JSON.stringify({ scheduledFor }) }),
  cancelBooking: (orderId: string) => apiFetch<CustomerBooking>(`/customer/orders/${orderId}/status`, { method: 'PATCH', successMessage: feedbackContent.success.cancelled, body: JSON.stringify({ status: 'cancelled' }) }),
  rateBooking: (orderId: string, rating: number, review?: string) => apiFetch<unknown>(`/customer/orders/${orderId}/rating`, { method: 'POST', body: JSON.stringify({ rating, review }) }),
  createPaymentOrder: (payload: { amount: number } & PaymentTarget) => apiFetch<PaymentOrder>('/payment/razorpay/order', { method: 'POST', body: JSON.stringify(payload) }),
  cancelOnlinePayment: (bookingId: string, couponCode?: string) => apiFetch<void>(`/customer/bookings/${bookingId}/cancel-online-payment`, { method: 'POST', body: JSON.stringify({ couponCode }) }),
  verifyPayment: verifyRazorpayPayment,
  getPaymentReceipt: fetchPaymentReceipt,
  switchBookingToCashOnDelivery: (orderId: string) => apiFetch<unknown>(`/customer/orders/${orderId}/payment-method`, { method: 'POST', successMessage: 'Booking set to pay on delivery.', body: JSON.stringify({ paymentMethod: 'cod' }) }),
  switchBookingToOnline: (orderId: string) => apiFetch<unknown>(`/customer/orders/${orderId}/payment-method/online`, { method: 'POST' }),
  addresses: () => apiFetch<SavedAddress[]>('/customer/addresses'),
  createAddress: (payload: Omit<SavedAddress, 'id'>) => apiFetch<SavedAddress>('/customer/addresses', { method: 'POST', body: JSON.stringify(payload) }),
  deleteAddress: (id: string) => apiFetch<void>(`/customer/addresses/${id}`, { method: 'DELETE' }),
  subscriptions: async () => (await apiFetch<Record<string, unknown>[]>('/customer/subscriptions')).map(normalizeSubscription),
  invoices: () => apiFetch<CustomerInvoice[]>('/customer/invoices'),
  downloadInvoice: (id: string) => apiFetch<CustomerInvoice>(`/customer/invoices/${id}/download`),
  support: () => apiFetch<SupportRequest[]>('/support/requests'),
  usage: () => apiFetch<CustomerUsage>('/customer/usage'),
  createSupportRequest: (payload: CreateSupportRequestPayload) => apiFetch<SupportRequest>('/support/requests', { method: 'POST', body: JSON.stringify(payload) }),
  createServiceEnquiry: (payload: CreateServiceEnquiryPayload) => apiFetch<CreateServiceEnquiryResult>('/service-enquiries', { method: 'POST', silent: true, body: JSON.stringify(payload) }),
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
