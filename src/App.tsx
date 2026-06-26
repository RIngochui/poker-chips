import { useEffect, useState } from 'react'
import { Outlet } from 'react-router-dom'
import { disableNetwork, enableNetwork } from 'firebase/firestore'
import { db } from './db/firebase'
import { ensureSignedIn } from './db/identity'
import { useIdentityStore } from './store/identityStore'

function App() {
  const [ready, setReady] = useState(false)
  const setUid = useIdentityStore((s) => s.setUid)

  useEffect(() => {
    ensureSignedIn().then((user) => {
      setUid(user.uid)
      setReady(true)
    })
  }, [setUid])

  useEffect(() => {
    // Mobile browsers throttle/suspend network activity when the tab is
    // backgrounded (screen lock, app switch), or when switching between
    // WiFi and cellular. Firestore's own reconnect backoff can leave the
    // view stale for a while after either case — force an immediate
    // reconnect instead of waiting for it.
    async function nudgeReconnect() {
      if (document.visibilityState !== 'visible') return
      await disableNetwork(db)
      await enableNetwork(db)
    }

    document.addEventListener('visibilitychange', nudgeReconnect)
    window.addEventListener('online', nudgeReconnect)

    // Mobile signal can also degrade gradually (e.g. weak/spotty
    // cellular) without ever firing 'offline'/'online' or a visibility
    // change — the exact case players reported needing a manual page
    // refresh to fix. Periodically force the same reconnect cycle a
    // refresh would do, so a stuck listener can't go unnoticed for long.
    const interval = window.setInterval(nudgeReconnect, 15000)

    return () => {
      document.removeEventListener('visibilitychange', nudgeReconnect)
      window.removeEventListener('online', nudgeReconnect)
      window.clearInterval(interval)
    }
  }, [])

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center text-gray-500">
        Connecting…
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Outlet />
    </div>
  )
}

export default App
