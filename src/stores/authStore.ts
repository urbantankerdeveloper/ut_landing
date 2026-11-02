import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import type { WorkspaceRole } from './navigationStore'

type AuthUser = { username: string; role: WorkspaceRole; name: string }
type AuthState = { user: AuthUser | null; accessToken: string | null; hasHydrated: boolean; signIn: (user: AuthUser, accessToken?: string) => void; setAccessToken: (accessToken: string | null) => void; setHasHydrated: (hasHydrated: boolean) => void; signOut: () => void }

export const useAuthStore = create<AuthState>()(persist((set) => ({
  user: null, accessToken: null, hasHydrated: false,
  signIn: (user, accessToken) => set({ user, accessToken: accessToken ?? null }),
  setAccessToken: (accessToken) => set({ accessToken }),
  setHasHydrated: (hasHydrated) => set({ hasHydrated }),
  signOut: () => set({ user: null, accessToken: null }),
}), {
  name: 'urban-tanker-auth',
  storage: createJSONStorage(() => sessionStorage),
  partialize: (state) => ({ user: state.user }),
  onRehydrateStorage: () => (state) => state?.setHasHydrated(true),
}))
