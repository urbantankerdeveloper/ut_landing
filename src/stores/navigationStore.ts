import { create } from 'zustand'

export type ScreenId = 'home' | 'services' | 'subscriptions' | 'booking' | 'yearly-contract' | 'coupons' | 'tracking' | 'partner' | 'terms' | 'policy' | 'account' | 'login' | 'about' | 'customer-workspace' | 'vendor-workspace' | 'admin-workspace'
export type WorkspaceRole = 'customer' | 'vendor' | 'admin' | 'dispatcher'
type NavigationState = { activeScreen: ScreenId; previousScreen: ScreenId | null; history: ScreenId[]; activeRole: WorkspaceRole; mobileMenuOpen: boolean; navigate: (screen: ScreenId) => void; openWorkspace: (role: WorkspaceRole) => void; goBack: () => void; setMobileMenuOpen: (open: boolean) => void }

function resetNavigationView(screen: ScreenId) {
  if (typeof window === 'undefined') return
  if (screen !== 'booking') window.sessionStorage.removeItem('urban-tanker-booking-draft')
  window.scrollTo({ top: 0, left: 0, behavior: 'auto' })
}

export const useNavigationStore = create<NavigationState>((set) => ({
  activeScreen: 'home', previousScreen: null, history: ['home'], activeRole: 'customer', mobileMenuOpen: false,
  navigate: (screen) => set((state) => { resetNavigationView(screen); return { activeScreen: screen, previousScreen: state.activeScreen, history: [...state.history, screen].slice(-20), mobileMenuOpen: false } }),
  openWorkspace: (activeRole) => set((state) => { const screen = `${activeRole}-workspace` as ScreenId; resetNavigationView(screen); return { activeRole, activeScreen: screen, previousScreen: state.activeScreen, history: [...state.history, screen].slice(-20), mobileMenuOpen: false } }),
  goBack: () => set((state) => { const history = state.history.slice(0, -1); const activeScreen = history.at(-1) ?? 'home'; resetNavigationView(activeScreen); return { activeScreen, previousScreen: state.activeScreen, history } }),
  setMobileMenuOpen: (mobileMenuOpen) => set({ mobileMenuOpen }),
}))
