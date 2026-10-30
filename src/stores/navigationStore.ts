import { create } from 'zustand'
import { BOOKING_DRAFT_KEY, REPEAT_BOOKING_KEY } from '../constants/bookingDraft'

export type ScreenId = 'home' | 'services' | 'subscriptions' | 'booking' | 'yearly-contract' | 'coupons' | 'tracking' | 'partner' | 'terms' | 'policy' | 'account' | 'login' | 'about' | 'customer-workspace' | 'vendor-workspace' | 'admin-workspace'
export type WorkspaceRole = 'customer' | 'vendor' | 'admin' | 'dispatcher'
type PendingNavigation = { screen: ScreenId; role?: WorkspaceRole; history?: ScreenId[] }
type NavigationState = { activeScreen: ScreenId; previousScreen: ScreenId | null; history: ScreenId[]; activeRole: WorkspaceRole; mobileMenuOpen: boolean; pendingNavigation: PendingNavigation | null; partnerFormDirty: boolean; navigate: (screen: ScreenId) => void; openWorkspace: (role: WorkspaceRole) => void; goBack: () => void; confirmNavigation: () => void; cancelNavigation: () => void; setPartnerFormDirty: (dirty: boolean) => void; setMobileMenuOpen: (open: boolean) => void }

function resetNavigationView(screen: ScreenId) {
  if (typeof window === 'undefined') return
  if (screen === 'booking') {
    window.sessionStorage.removeItem(BOOKING_DRAFT_KEY)
    window.sessionStorage.removeItem(REPEAT_BOOKING_KEY)
  } else {
    window.sessionStorage.removeItem(BOOKING_DRAFT_KEY)
  }
  window.scrollTo({ top: 0, left: 0, behavior: 'auto' })
}

function needsLeaveConfirmation(currentScreen: ScreenId, nextScreen: ScreenId, partnerFormDirty: boolean) {
  return (currentScreen === 'booking' && nextScreen !== 'booking') || (currentScreen === 'partner' && nextScreen !== 'partner' && partnerFormDirty)
}

function applyNavigation(state: NavigationState, navigation: PendingNavigation): Partial<NavigationState> {
  resetNavigationView(navigation.screen)
  return {
    ...(navigation.role ? { activeRole: navigation.role } : {}),
    activeScreen: navigation.screen,
    previousScreen: state.activeScreen,
    history: navigation.history ?? [...state.history, navigation.screen].slice(-20),
    mobileMenuOpen: false,
    pendingNavigation: null,
    ...(navigation.screen !== 'partner' ? { partnerFormDirty: false } : {}),
  }
}

export const useNavigationStore = create<NavigationState>((set) => ({
  activeScreen: 'home', previousScreen: null, history: ['home'], activeRole: 'customer', mobileMenuOpen: false, pendingNavigation: null, partnerFormDirty: false,
  navigate: (screen) => set((state) => {
    const navigation = { screen }
    if (needsLeaveConfirmation(state.activeScreen, screen, state.partnerFormDirty)) return { pendingNavigation: navigation }
    return applyNavigation(state, navigation)
  }),
  openWorkspace: (activeRole) => set((state) => {
    const navigation = { screen: `${activeRole}-workspace` as ScreenId, role: activeRole }
    if (needsLeaveConfirmation(state.activeScreen, navigation.screen, state.partnerFormDirty)) return { pendingNavigation: navigation }
    return applyNavigation(state, navigation)
  }),
  goBack: () => set((state) => {
    const history = state.history.slice(0, -1)
    const navigation = { screen: history.at(-1) ?? 'home', history }
    if (needsLeaveConfirmation(state.activeScreen, navigation.screen, state.partnerFormDirty)) return { pendingNavigation: navigation }
    return applyNavigation(state, navigation)
  }),
  confirmNavigation: () => set((state) => state.pendingNavigation ? applyNavigation(state, state.pendingNavigation) : state),
  cancelNavigation: () => set({ pendingNavigation: null }),
  setPartnerFormDirty: (partnerFormDirty) => set({ partnerFormDirty }),
  setMobileMenuOpen: (mobileMenuOpen) => set({ mobileMenuOpen }),
}))
