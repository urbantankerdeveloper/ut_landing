import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import type { WorkspaceRole } from './navigationStore'

type AuthUser = { username: string; role: WorkspaceRole; name: string }
type AuthState = { user: AuthUser | null; accessToken: string | null; refreshToken: string | null; hasHydrated: boolean; signIn: (user: AuthUser, accessToken?: string, refreshToken?: string) => void; setAccessToken: (accessToken: string | null) => void; setRefreshToken: (refreshToken: string | null) => void; setHasHydrated: (hasHydrated: boolean) => void; signOut: () => void }

export const useAuthStore = create<AuthState>()(persist((set) => ({
  user: null, accessToken: null, refreshToken: null, hasHydrated: false,
  signIn: (user, accessToken, refreshToken) => set({ user, accessToken: accessToken ?? null, refreshToken: refreshToken ?? null }),
  setAccessToken: (accessToken) => set({ accessToken }),
  setRefreshToken: (refreshToken) => set({ refreshToken }),
  setHasHydrated: (hasHydrated) => set({ hasHydrated }),
  signOut: () => set({ user: null, accessToken: null, refreshToken: null }),
}), {
  name: 'urban-tanker-auth',
  storage: createJSONStorage(() => sessionStorage),
  partialize: (state) => ({ user: state.user, refreshToken: state.refreshToken }),
  onRehydrateStorage: () => (state) => state?.setHasHydrated(true),
}))
