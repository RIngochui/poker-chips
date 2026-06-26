import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getTable, joinTable } from '../db/tables'
import { useIdentityStore } from '../store/identityStore'

function Join() {
  const navigate = useNavigate()
  const { uid, name, setName } = useIdentityStore()
  const [code, setCode] = useState('')
  const [joining, setJoining] = useState(false)
  const [error, setError] = useState('')

  async function handleJoin() {
    if (!uid) return
    if (!name.trim()) {
      setError('Enter a display name first.')
      return
    }
    const upperCode = code.trim().toUpperCase()
    if (!upperCode) {
      setError('Enter a join code.')
      return
    }

    setError('')
    setJoining(true)
    try {
      const table = await getTable(upperCode)
      if (!table) {
        setError('No table found with that code.')
        return
      }
      if (table.status === 'ended') {
        setError('That table has ended.')
        return
      }

      await joinTable({ code: upperCode, uid, name: name.trim() })
      navigate(`/table/${upperCode}`)
    } catch (err) {
      setError('Could not join table. Try again.')
      console.error(err)
    } finally {
      setJoining(false)
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 px-4">
      <h1 className="text-3xl font-semibold text-gray-900">Join a table</h1>

      <div className="w-full max-w-sm space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700">
            Display name
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Your name"
            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 focus:border-indigo-500 focus:outline-none"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700">
            Join code
          </label>
          <input
            type="text"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="A4F2"
            maxLength={4}
            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-center font-mono text-lg uppercase tracking-widest focus:border-indigo-500 focus:outline-none"
          />
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <button
          type="button"
          onClick={handleJoin}
          disabled={joining}
          className="w-full rounded-md bg-indigo-600 px-4 py-2 font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {joining ? 'Joining…' : 'Join table'}
        </button>

        <button
          type="button"
          onClick={() => navigate('/')}
          className="w-full rounded-md border border-gray-300 px-4 py-2 font-medium text-gray-700 hover:bg-gray-100"
        >
          Back
        </button>
      </div>
    </div>
  )
}

export default Join
