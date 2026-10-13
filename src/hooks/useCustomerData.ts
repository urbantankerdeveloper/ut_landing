import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { customerApi, type CreateBookingPayload, type CreateSupportRequestPayload, type CustomerProfile } from '../api/customer'
import { demoDataEnabled } from '../constants/demo'
import { useRealtimeInvalidation } from './useRealtimeInvalidation'

const customerQueryOptions = { enabled: !demoDataEnabled, staleTime: 60_000 }
export const customerQueryKeys = { bookings: ['customer', 'bookings'], addresses: ['customer', 'addresses'], subscriptions: ['customer', 'subscriptions'], invoices: ['customer', 'invoices'], support: ['customer', 'support'], profile: ['customer', 'profile'], wallet: ['customer', 'wallet'], contracts: ['customer', 'contracts'], offers: ['customer', 'offers'], membershipPlans: ['customer', 'membership-plans'], membership: ['customer', 'membership'], notifications: ['customer', 'notifications'], tracking: (orderId: string) => ['customer', 'tracking', orderId] } as const

export function useCustomerBookings() { return useQuery({ queryKey: customerQueryKeys.bookings, queryFn: customerApi.bookings, ...customerQueryOptions }) }
export function useCustomerAddresses() { return useQuery({ queryKey: customerQueryKeys.addresses, queryFn: customerApi.addresses, ...customerQueryOptions }) }
export function useCreateCustomerAddress() { const queryClient = useQueryClient(); return useMutation({ mutationFn: (payload: Parameters<typeof customerApi.createAddress>[0]) => customerApi.createAddress(payload), onSuccess: () => queryClient.invalidateQueries({ queryKey: customerQueryKeys.addresses }) }) }
export function useDeleteCustomerAddress() { const queryClient = useQueryClient(); return useMutation({ mutationFn: (id: string) => customerApi.deleteAddress(id), onSuccess: () => queryClient.invalidateQueries({ queryKey: customerQueryKeys.addresses }) }) }
export function useCustomerSubscriptions() { return useQuery({ queryKey: customerQueryKeys.subscriptions, queryFn: customerApi.subscriptions, ...customerQueryOptions }) }
export function useCustomerInvoices() { return useQuery({ queryKey: customerQueryKeys.invoices, queryFn: customerApi.invoices, ...customerQueryOptions }) }
export function useCustomerTracking(orderId: string | null) { return useQuery({ queryKey: orderId ? customerQueryKeys.tracking(orderId) : ['customer', 'tracking', 'empty'], queryFn: () => customerApi.tracking(orderId as string), enabled: Boolean(orderId) && !demoDataEnabled, staleTime: 10_000, refetchInterval: 15_000 }) }
export function useCustomerDeliveryOtp() { return useMutation({ mutationFn: (orderId: string) => customerApi.requestDeliveryOtp(orderId) }) }
export function useCustomerSupportRequests() { return useQuery({ queryKey: customerQueryKeys.support, queryFn: customerApi.support, ...customerQueryOptions }) }
export function useCustomerProfile() { return useQuery({ queryKey: customerQueryKeys.profile, queryFn: customerApi.profile, ...customerQueryOptions }) }
export function useCustomerWallet() { return useQuery({ queryKey: customerQueryKeys.wallet, queryFn: customerApi.wallet, ...customerQueryOptions }) }
export function useCustomerContracts() { return useQuery({ queryKey: customerQueryKeys.contracts, queryFn: customerApi.contracts, ...customerQueryOptions }) }
export function useCreateCustomerContract() { const queryClient = useQueryClient(); return useMutation({ mutationFn: (payload: Parameters<typeof customerApi.createContract>[0]) => customerApi.createContract(payload), onSuccess: () => queryClient.invalidateQueries({ queryKey: customerQueryKeys.contracts }) }) }
export function useCustomerOffers() { return useQuery({ queryKey: customerQueryKeys.offers, queryFn: customerApi.offers, ...customerQueryOptions }) }
export function useMembershipPlans() { return useQuery({ queryKey: customerQueryKeys.membershipPlans, queryFn: customerApi.membershipPlans, ...customerQueryOptions }) }
export function useCustomerMembership() { return useQuery({ queryKey: customerQueryKeys.membership, queryFn: customerApi.membership, ...customerQueryOptions }) }
export function useRequestMembership() { const queryClient = useQueryClient(); return useMutation({ mutationFn: (planId: string) => customerApi.requestMembership(planId), onSuccess: () => queryClient.invalidateQueries({ queryKey: customerQueryKeys.membership }) }) }
export function useCustomerNotifications() { const query = useQuery({ queryKey: customerQueryKeys.notifications, queryFn: customerApi.notifications, ...customerQueryOptions }); useRealtimeInvalidation(customerQueryKeys.notifications); return query }

export function useCreateCustomerBooking() { const queryClient = useQueryClient(); return useMutation({ mutationFn: (payload: CreateBookingPayload) => customerApi.createBooking(payload), onSuccess: () => queryClient.invalidateQueries({ queryKey: customerQueryKeys.bookings }) }) }
export function useCreatePaymentOrder() { return useMutation({ mutationFn: (payload: { amount: number; bookingId: string }) => customerApi.createPaymentOrder(payload) }) }
export function useVerifyPayment() { const queryClient = useQueryClient(); return useMutation({ mutationFn: (payload: { orderId: string; paymentId: string; signature: string }) => customerApi.verifyPayment(payload), onSuccess: () => queryClient.invalidateQueries({ queryKey: customerQueryKeys.bookings }) }) }
export function useCreateSupportRequest() { const queryClient = useQueryClient(); return useMutation({ mutationFn: (payload: CreateSupportRequestPayload) => customerApi.createSupportRequest(payload), onSuccess: () => queryClient.invalidateQueries({ queryKey: customerQueryKeys.support }) }) }
export function useUpdateCustomerProfile() { const queryClient = useQueryClient(); return useMutation({ mutationFn: (payload: CustomerProfile) => customerApi.updateProfile(payload), onSuccess: () => queryClient.invalidateQueries({ queryKey: customerQueryKeys.profile }) }) }
export function useCustomerReschedule() { const queryClient = useQueryClient(); return useMutation({ mutationFn: (payload: { orderId: string; scheduledFor: string }) => customerApi.rescheduleBooking(payload.orderId, payload.scheduledFor), onSuccess: () => queryClient.invalidateQueries({ queryKey: customerQueryKeys.bookings }) }) }
export function useCustomerCancel() { const queryClient = useQueryClient(); return useMutation({ mutationFn: (orderId: string) => customerApi.cancelBooking(orderId), onSuccess: () => queryClient.invalidateQueries({ queryKey: customerQueryKeys.bookings }) }) }
export function useCustomerRating() { return useMutation({ mutationFn: (payload: { orderId: string; rating: number; review?: string }) => customerApi.rateBooking(payload.orderId, payload.rating, payload.review) }) }
export function useWalletTopUp() { const queryClient = useQueryClient(); return useMutation({ mutationFn: (amount: number) => customerApi.topUpWallet(amount), onSuccess: () => queryClient.invalidateQueries({ queryKey: customerQueryKeys.wallet }) }) }
export function useSubscriptionStatus() { const queryClient = useQueryClient(); return useMutation({ mutationFn: (payload: { id: string; status: 'active' | 'paused' | 'cancelled' }) => customerApi.updateSubscription(payload.id, payload.status), onSuccess: () => queryClient.invalidateQueries({ queryKey: customerQueryKeys.subscriptions }) }) }
export function useMarkNotificationRead() { const queryClient = useQueryClient(); return useMutation({ mutationFn: (id: string) => customerApi.markNotificationRead(id), onSuccess: () => queryClient.invalidateQueries({ queryKey: customerQueryKeys.notifications }) }) }
