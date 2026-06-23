import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { createTable } from '../db/tables'
import { useIdentityStore } from '../store/identityStore'

function Landing() {
  const navigate = useNavigate()
  const { uid, name, setName } = useIdentityStore()
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')

  async function handleCreate() {
    if (!uid) return
    if (!name.trim()) {
      setError('Enter a display name first.')
      return
    }
    setError('')
    setCreating(true)
    try {
      const code = await createTable({
        name: `${name}'s table`,
        createdBy: uid,
        creatorName: name.trim(),
      })
      navigate(`/table/${code}`)
    } catch (err) {
      setError('Could not create table. Try again.')
      console.error(err)
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 px-4">
      <h1 className="text-3xl font-semibold text-gray-900">Poker Chips</h1>
      <p className="text-gray-500">Track stacks and the pot. Play poker in real life.</p>

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

        {error && <p className="text-sm text-red-600">{error}</p>}

        <button
          type="button"
          onClick={handleCreate}
          disabled={creating}
          className="w-full rounded-md bg-indigo-600 px-4 py-2 font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {creating ? 'Creating…' : 'Create table'}
        </button>

        <button
          type="button"
          onClick={() => navigate('/join')}
          className="w-full rounded-md border border-gray-300 px-4 py-2 font-medium text-gray-700 hover:bg-gray-100"
        >
          Join with code
        </button>
      </div>
    </div>
  )
}

export default Landing
