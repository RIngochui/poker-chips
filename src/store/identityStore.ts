import { create } from 'zustand'
import { getStoredName, setStoredName } from '../db/identity'

interface IdentityState {
  uid: string | null
  name: string
  setUid: (uid: string) => void
  setName: (name: string) => void
}

export const useIdentityStore = create<IdentityState>((set) => ({
  uid: null,
  name: getStoredName(),
  setUid: (uid) => set({ uid }),
  setName: (name) => {
    setStoredName(name)
    set({ name })
  },
}))
