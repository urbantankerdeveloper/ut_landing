import { create } from 'zustand'

export type ScreenId = 'home' | 'services' | 'subscriptions' | 'booking' | 'account' | 'login' | 'about' | 'customer-workspace' | 'vendor-workspace' | 'admin-workspace'
export type WorkspaceRole = 'customer' | 'vendor' | 'admin'
type NavigationState = { activeScreen: ScreenId; previousScreen: ScreenId | null; history: ScreenId[]; activeRole: WorkspaceRole; mobileMenuOpen: boolean; navigate: (screen: ScreenId) => void; openWorkspace: (role: WorkspaceRole) => void; goBack: () => void; setMobileMenuOpen: (open: boolean) => void }

export const useNavigationStore = create<NavigationState>((set) => ({
  activeScreen: 'home', previousScreen: null, history: ['home'], activeRole: 'customer', mobileMenuOpen: false,
  navigate: (screen) => set((state) => ({ activeScreen: screen, previousScreen: state.activeScreen, history: [...state.history, screen].slice(-20), mobileMenuOpen: false })),
  openWorkspace: (activeRole) => set((state) => ({ activeRole, activeScreen: `${activeRole}-workspace` as ScreenId, previousScreen: state.activeScreen, history: [...state.history, `${activeRole}-workspace` as ScreenId].slice(-20), mobileMenuOpen: false })),
  goBack: () => set((state) => { const history = state.history.slice(0, -1); const activeScreen = history.at(-1) ?? 'home'; return { activeScreen, previousScreen: state.activeScreen, history } }),
  setMobileMenuOpen: (mobileMenuOpen) => set({ mobileMenuOpen }),
}))
