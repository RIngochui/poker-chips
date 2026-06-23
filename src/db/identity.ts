import { onAuthStateChanged, signInAnonymously, type User } from 'firebase/auth'
import { auth } from './firebase'

const NAME_KEY = 'poker-chips:displayName'

export function getStoredName(): string {
  return localStorage.getItem(NAME_KEY) ?? ''
}

export function setStoredName(name: string): void {
  localStorage.setItem(NAME_KEY, name)
}

let authReadyPromise: Promise<User> | null = null

export function ensureSignedIn(): Promise<User> {
  if (authReadyPromise) return authReadyPromise

  authReadyPromise = new Promise((resolve, reject) => {
    const unsubscribe = onAuthStateChanged(
      auth,
      (user) => {
        if (user) {
          unsubscribe()
          resolve(user)
        } else {
          signInAnonymously(auth).catch((err) => {
            unsubscribe()
            reject(err)
          })
        }
      },
      reject,
    )
  })

  return authReadyPromise
}
