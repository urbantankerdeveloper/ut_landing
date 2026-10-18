import { create } from 'zustand'

export type ScreenId = 'home' | 'services' | 'subscriptions' | 'booking' | 'yearly-contract' | 'coupons' | 'tracking' | 'partner' | 'terms' | 'policy' | 'account' | 'login' | 'about' | 'customer-workspace' | 'vendor-workspace' | 'admin-workspace'
export type WorkspaceRole = 'customer' | 'vendor' | 'admin' | 'dispatcher'
type NavigationState = { activeScreen: ScreenId; previousScreen: ScreenId | null; history: ScreenId[]; activeRole: WorkspaceRole; mobileMenuOpen: boolean; navigate: (screen: ScreenId) => void; openWorkspace: (role: WorkspaceRole) => void; goBack: () => void; setMobileMenuOpen: (open: boolean) => void }

function resetNavigationView(screen: ScreenId) {
  if (typeof window === 'undefined') return
  if (screen !== 'booking') window.sessionStorage.removeItem('urban-tanker-booking-draft')
  window.scrollTo({ top: 0, left: 0, behavior: 'auto' })
}

function hasBookingActivity() {
  if (typeof window === 'undefined') return false
  const rawDraft = window.sessionStorage.getItem('urban-tanker-booking-draft')
  if (!rawDraft) return false
  try {
    const draft = JSON.parse(rawDraft) as {
      selectedServices?: unknown[]
      details?: { location?: string; deliveryDate?: string; notes?: string }
      locationAddress?: string
      phone?: string
      guestName?: string
      step?: string
    }
    return Boolean(
      (draft.selectedServices?.length ?? 0) > 0 ||
      draft.details?.location?.trim() ||
      draft.details?.deliveryDate ||
      draft.details?.notes?.trim() ||
      draft.locationAddress?.trim() ||
      draft.phone?.trim() ||
      draft.guestName?.trim() ||
      (draft.step && draft.step !== 'details'),
    )
  } catch {
    return true
  }
}

function confirmBookingReset(screen: ScreenId) {
  if (screen === 'booking' || !hasBookingActivity() || typeof window === 'undefined') return true
  return window.confirm('You have an unfinished booking. Leave this screen and reset the booking?')
}

export const useNavigationStore = create<NavigationState>((set) => ({
  activeScreen: 'home', previousScreen: null, history: ['home'], activeRole: 'customer', mobileMenuOpen: false,
  navigate: (screen) => set((state) => { if (!confirmBookingReset(screen)) return state; resetNavigationView(screen); return { activeScreen: screen, previousScreen: state.activeScreen, history: [...state.history, screen].slice(-20), mobileMenuOpen: false } }),
  openWorkspace: (activeRole) => set((state) => { const screen = `${activeRole}-workspace` as ScreenId; if (!confirmBookingReset(screen)) return state; resetNavigationView(screen); return { activeRole, activeScreen: screen, previousScreen: state.activeScreen, history: [...state.history, screen].slice(-20), mobileMenuOpen: false } }),
  goBack: () => set((state) => { const history = state.history.slice(0, -1); const activeScreen = history.at(-1) ?? 'home'; if (!confirmBookingReset(activeScreen)) return state; resetNavigationView(activeScreen); return { activeScreen, previousScreen: state.activeScreen, history } }),
  setMobileMenuOpen: (mobileMenuOpen) => set({ mobileMenuOpen }),
}))
