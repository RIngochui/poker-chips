import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  startGame,
  subscribeToPlayers,
  subscribeToTable,
  updateTableSettings,
} from '../db/tables'
import type { Player, Table } from '../db/types'
import { useIdentityStore } from '../store/identityStore'

function TablePage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const uid = useIdentityStore((s) => s.uid)
  const [table, setTable] = useState<Table | null>(null)
  const [players, setPlayers] = useState<Player[]>([])
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    if (!id) return
    const unsubTable = subscribeToTable(id, (t) => {
      setTable(t)
      setLoaded(true)
    })
    const unsubPlayers = subscribeToPlayers(id, setPlayers)
    return () => {
      unsubTable()
      unsubPlayers()
    }
  }, [id])

  if (!id) return null

  if (loaded && !table) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4">
        <p className="text-gray-600">No table found with code {id}.</p>
        <button
          type="button"
          onClick={() => navigate('/')}
          className="rounded-md border border-gray-300 px-4 py-2 text-gray-700 hover:bg-gray-100"
        >
          Back home
        </button>
      </div>
    )
  }

  if (!table) {
    return (
      <div className="flex min-h-screen items-center justify-center text-gray-500">
        Loading table…
      </div>
    )
  }

  if (table.status === 'lobby') {
    return <Lobby code={id} table={table} players={players} uid={uid} />
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-2">
      <p className="text-gray-600">
        Table {table.code} is {table.status}.
      </p>
      <p className="text-sm text-gray-400">
        Active-game play comes in a later phase.
      </p>
    </div>
  )
}

function Lobby({
  code,
  table,
  players,
  uid,
}: {
  code: string
  table: Table
  players: Player[]
  uid: string | null
}) {
  const sorted = [...players].sort((a, b) => a.seat - b.seat)

  async function setSetting<K extends keyof Table['settings']>(
    key: K,
    value: Table['settings'][K],
  ) {
    await updateTableSettings(code, { [key]: value } as Partial<Table['settings']>)
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-2xl flex-col gap-8 px-4 py-10">
      <div className="text-center">
        <p className="text-sm text-gray-500">Join code</p>
        <p className="font-mono text-5xl font-bold tracking-widest text-indigo-600">
          {table.code}
        </p>
      </div>

      <div>
        <h2 className="mb-2 text-lg font-semibold text-gray-900">
          Players ({sorted.length})
        </h2>
        <ul className="divide-y divide-gray-200 rounded-md border border-gray-200 bg-white">
          {sorted.map((p) => (
            <li key={p.uid} className="flex items-center justify-between px-4 py-3">
              <span className="font-medium text-gray-900">
                {p.name}
                {p.uid === uid && <span className="ml-2 text-xs text-indigo-500">(you)</span>}
                {p.uid === table.createdBy && (
                  <span className="ml-2 text-xs text-gray-400">host</span>
                )}
              </span>
              <span className="text-sm text-gray-400">Seat {p.seat}</span>
            </li>
          ))}
          {sorted.length === 0 && (
            <li className="px-4 py-3 text-sm text-gray-400">Waiting for players…</li>
          )}
        </ul>
      </div>

      <div>
        <h2 className="mb-2 text-lg font-semibold text-gray-900">Settings</h2>
        <div className="grid grid-cols-2 gap-4 rounded-md border border-gray-200 bg-white p-4">
          <Field
            label="Small blind"
            value={table.settings.smallBlind}
            onChange={(v) => setSetting('smallBlind', v)}
          />
          <Field
            label="Big blind"
            value={table.settings.bigBlind}
            onChange={(v) => setSetting('bigBlind', v)}
          />
          <Field
            label="Chip to dollar rate"
            value={table.settings.chipToDollar}
            step="0.01"
            onChange={(v) => setSetting('chipToDollar', v)}
          />
          <Field
            label="Default buy-in (chips)"
            value={table.settings.defaultBuyIn}
            onChange={(v) => setSetting('defaultBuyIn', v)}
          />

          <div className="col-span-2 flex items-center justify-between border-t border-gray-100 pt-4">
            <span className="text-sm font-medium text-gray-700">Blind timer</span>
            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={table.settings.blindTimer !== null}
                onChange={(e) =>
                  setSetting(
                    'blindTimer',
                    e.target.checked
                      ? { levels: [], startedAt: Date.now(), levelIndex: 0 }
                      : null,
                  )
                }
                className="h-4 w-4"
              />
              <span className="text-sm text-gray-500">
                {table.settings.blindTimer ? 'On' : 'Off (default)'}
              </span>
            </label>
          </div>
        </div>
      </div>

      <button
        type="button"
        onClick={() => startGame(code)}
        className="w-full rounded-md bg-indigo-600 px-4 py-3 text-lg font-semibold text-white hover:bg-indigo-700"
      >
        Start Game
      </button>
    </div>
  )
}

function Field({
  label,
  value,
  onChange,
  step,
}: {
  label: string
  value: number
  onChange: (v: number) => void
  step?: string
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700">{label}</label>
      <input
        type="number"
        step={step ?? '1'}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 focus:border-indigo-500 focus:outline-none"
      />
    </div>
  )
}

export default TablePage
