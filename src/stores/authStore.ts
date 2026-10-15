import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import type { WorkspaceRole } from './navigationStore'

type AuthUser = { username: string; role: WorkspaceRole; name: string }
type AuthState = { user: AuthUser | null; accessToken: string | null; signIn: (user: AuthUser, accessToken?: string) => void; setAccessToken: (accessToken: string | null) => void; signOut: () => void }

export const useAuthStore = create<AuthState>()(persist((set) => ({
  user: null, accessToken: null,
  signIn: (user, accessToken) => set({ user, accessToken: accessToken ?? null }),
  setAccessToken: (accessToken) => set({ accessToken }),
  signOut: () => set({ user: null, accessToken: null }),
}), {
  name: 'urban-tanker-auth',
  storage: createJSONStorage(() => sessionStorage),
  partialize: (state) => ({ user: state.user }),
}))
