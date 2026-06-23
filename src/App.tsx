import { useEffect, useState } from 'react'
import { Outlet } from 'react-router-dom'
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
