import { create } from 'zustand'
import { persist } from 'zustand/middleware'

type FeatureFlagState = { flags: Record<string, boolean>; setFlag: (name: string, enabled: boolean) => void; can: (permission: string) => boolean }
export const useFeatureFlagStore = create<FeatureFlagState>()(persist((set, get) => ({ flags: {}, setFlag: (name, enabled) => set((state) => ({ flags: { ...state.flags, [name]: enabled } })), can: (permission) => get().flags[permission] !== false }), { name: 'urban-tanker-feature-flags' }))
