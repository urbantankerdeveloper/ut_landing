import { create } from 'zustand'

// Screens map to URLs in routing/paths.ts. The store keeps only UI state that is not part of the URL.
export type ScreenId = 'home' | 'services' | 'subscriptions' | 'booking' | 'yearly-contract' | 'coupons' | 'tracking' | 'partner' | 'terms' | 'policy' | 'account' | 'login' | 'about' | 'customer-workspace' | 'vendor-workspace' | 'admin-workspace' | 'dispatcher-workspace'
export type WorkspaceRole = 'customer' | 'vendor' | 'admin' | 'dispatcher'
type NavigationState = { mobileMenuOpen: boolean; partnerFormDirty: boolean; bookingCompleted: boolean; setMobileMenuOpen: (open: boolean) => void; setPartnerFormDirty: (dirty: boolean) => void; setBookingCompleted: (completed: boolean) => void }

export const useNavigationStore = create<NavigationState>((set) => ({
  mobileMenuOpen: false,
  partnerFormDirty: false,
  bookingCompleted: false,
  setMobileMenuOpen: (mobileMenuOpen) => set({ mobileMenuOpen }),
  setPartnerFormDirty: (partnerFormDirty) => set({ partnerFormDirty }),
  setBookingCompleted: (bookingCompleted) => set({ bookingCompleted }),
}))
