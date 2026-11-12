import { create } from 'zustand'

// 'assign' opens the fleet and driver dialog for an available order; 'reject' runs the decline flow with a reason.
export type VendorOrderIntent = 'assign' | 'reject'
type VendorOrderRequest = { orderId: string; intent: VendorOrderIntent }

type VendorOrderRequestState = {
  request: VendorOrderRequest | null
  requestOrder: (orderId: string, intent: VendorOrderIntent) => void
  clearRequest: () => void
}

// Lets a toast ask the operations panel to act on an order, even when the panel is not mounted yet.
export const useVendorOrderRequestStore = create<VendorOrderRequestState>((set) => ({
  request: null,
  requestOrder: (orderId, intent) => set({ request: { orderId, intent } }),
  clearRequest: () => set({ request: null }),
}))
