import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import type { WorkspaceRole } from './navigationStore'

type AuthUser = { username: string; role: WorkspaceRole; name: string }
type AuthState = { user: AuthUser | null; accessToken: string | null; refreshToken: string | null; signIn: (user: AuthUser, accessToken?: string, refreshToken?: string) => void; signOut: () => void }

export const useAuthStore = create<AuthState>()(persist((set) => ({
  user: null, accessToken: null, refreshToken: null,
  signIn: (user, accessToken, refreshToken) => { if (accessToken) sessionStorage.setItem('urban-tanker-access-token', accessToken); if (refreshToken) sessionStorage.setItem('urban-tanker-refresh-token', refreshToken); set({ user, accessToken: accessToken ?? null, refreshToken: refreshToken ?? null }) },
  signOut: () => { sessionStorage.removeItem('urban-tanker-access-token'); sessionStorage.removeItem('urban-tanker-refresh-token'); set({ user: null, accessToken: null, refreshToken: null }) },
}), {
  name: 'urban-tanker-auth',
  storage: createJSONStorage(() => sessionStorage),
  partialize: (state) => ({ user: state.user, accessToken: state.accessToken, refreshToken: state.refreshToken }),
}))
