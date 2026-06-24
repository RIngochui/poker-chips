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
    // backgrounded (screen lock, app switch). Firestore's own reconnect
    // backoff can leave the view stale for a while after coming back —
    // force an immediate reconnect instead of waiting for it.
    async function nudgeReconnect() {
      if (document.visibilityState !== 'visible') return
      await disableNetwork(db)
      await enableNetwork(db)
    }

    document.addEventListener('visibilitychange', nudgeReconnect)
    return () => document.removeEventListener('visibilitychange', nudgeReconnect)
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
