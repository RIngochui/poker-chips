import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  setPlayerReady,
  startGame,
  subscribeToPlayers,
  subscribeToTable,
  updateTableSettings,
} from '../db/tables'
import type { Player, Table } from '../db/types'
import { useIdentityStore } from '../store/identityStore'
import ActiveGame from './ActiveGame'
import Results from './Results'

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

  if (table.status === 'active') {
    return <ActiveGame code={id} table={table} players={players} uid={uid} />
  }

  return <Results table={table} players={players} />
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
  const isHost = uid === table.createdBy
  const nonHostPlayers = sorted.filter((p) => p.uid !== table.createdBy)
  const allReady = nonHostPlayers.length > 0 && nonHostPlayers.every((p) => p.ready)
  const you = sorted.find((p) => p.uid === uid)
  const startingDollar = (
    table.settings.defaultBuyIn * table.settings.chipToDollar
  ).toFixed(2)

  async function setSetting<K extends keyof Table['settings']>(
    key: K,
    value: Table['settings'][K],
  ) {
    if (!uid) return
    try {
      await updateTableSettings(code, { [key]: value } as Partial<Table['settings']>, uid)
    } catch (err) {
      alert((err as Error).message)
    }
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
              <div className="flex items-center gap-3">
                <span className="text-sm text-gray-400">Seat {p.seat}</span>
                {p.uid === table.createdBy ? (
                  <span className="rounded-full bg-indigo-100 px-3 py-1 text-xs font-medium text-indigo-700">
                    Host
                  </span>
                ) : (
                  <span
                    className={`rounded-full px-3 py-1 text-xs font-medium ${
                      p.ready
                        ? 'bg-emerald-100 text-emerald-700'
                        : 'bg-gray-100 text-gray-400'
                    }`}
                  >
                    {p.ready ? 'Ready' : 'Not ready'}
                  </span>
                )}
              </div>
            </li>
          ))}
          {sorted.length === 0 && (
            <li className="px-4 py-3 text-sm text-gray-400">Waiting for players…</li>
          )}
        </ul>
      </div>

      <div>
        <h2 className="mb-2 text-lg font-semibold text-gray-900">
          Settings {!isHost && <span className="text-sm text-gray-400">(host only)</span>}
        </h2>
        <div className="grid grid-cols-2 gap-4 rounded-md border border-gray-200 bg-white p-4">
          <Field
            label="Small blind"
            value={table.settings.smallBlind}
            onChange={(v) => setSetting('smallBlind', v)}
            disabled={!isHost}
          />
          <Field
            label="Big blind"
            value={table.settings.bigBlind}
            onChange={(v) => setSetting('bigBlind', v)}
            disabled={!isHost}
          />
          <Field
            label="Chip to dollar rate"
            value={table.settings.chipToDollar}
            step="0.01"
            onChange={(v) => setSetting('chipToDollar', v)}
            disabled={!isHost}
          />
          <Field
            label="Default buy-in (chips)"
            value={table.settings.defaultBuyIn}
            onChange={(v) => setSetting('defaultBuyIn', v)}
            disabled={!isHost}
          />

          <div className="col-span-2 flex items-center justify-between border-t border-gray-100 pt-4">
            <span className="text-sm font-medium text-gray-700">Blind increases</span>
            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={table.settings.blindIncrease !== null}
                disabled={!isHost}
                onChange={(e) =>
                  setSetting(
                    'blindIncrease',
                    e.target.checked ? { amount: 1, everyHands: 10 } : null,
                  )
                }
                className="h-4 w-4 disabled:opacity-50"
              />
              <span className="text-sm text-gray-500">
                {table.settings.blindIncrease !== null ? 'On' : 'Off (default)'}
              </span>
            </label>
          </div>

          {table.settings.blindIncrease !== null && (
            <>
              <Field
                label="Small blind increase"
                value={table.settings.blindIncrease.amount}
                onChange={(v) =>
                  setSetting('blindIncrease', {
                    ...table.settings.blindIncrease!,
                    amount: v,
                  })
                }
                disabled={!isHost}
              />
              <Field
                label="Hands between increases"
                value={table.settings.blindIncrease.everyHands}
                onChange={(v) =>
                  setSetting('blindIncrease', {
                    ...table.settings.blindIncrease!,
                    everyHands: v,
                  })
                }
                disabled={!isHost}
              />
            </>
          )}

          <div className="col-span-2 flex items-center justify-between border-t border-gray-100 pt-4">
            <span className="text-sm font-medium text-gray-700">Game structure</span>
            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={table.settings.raiseLimit !== null}
                disabled={!isHost}
                onChange={(e) =>
                  setSetting('raiseLimit', e.target.checked ? 4 : null)
                }
                className="h-4 w-4 disabled:opacity-50"
              />
              <span className="text-sm text-gray-500">
                {table.settings.raiseLimit !== null ? 'Limit' : 'No-Limit (default)'}
              </span>
            </label>
          </div>

          {table.settings.raiseLimit !== null && (
            <Field
              label="Max raises per hand"
              value={table.settings.raiseLimit}
              onChange={(v) => setSetting('raiseLimit', v)}
              disabled={!isHost}
            />
          )}

          <div className="col-span-2 flex items-center justify-between border-t border-gray-100 pt-4">
            <span className="text-sm font-medium text-gray-700">Hand limit</span>
            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={table.settings.handLimit !== null}
                disabled={!isHost}
                onChange={(e) => setSetting('handLimit', e.target.checked ? 20 : null)}
                className="h-4 w-4 disabled:opacity-50"
              />
              <span className="text-sm text-gray-500">
                {table.settings.handLimit !== null ? 'On' : 'Off (default)'}
              </span>
            </label>
          </div>

          {table.settings.handLimit !== null && (
            <Field
              label="Hands before check-in"
              value={table.settings.handLimit}
              onChange={(v) => setSetting('handLimit', v)}
              disabled={!isHost}
            />
          )}
        </div>
      </div>

      <div className="rounded-md border border-indigo-200 bg-indigo-50 p-4 text-center">
        <p className="text-sm text-indigo-700">Everyone starts with</p>
        <p className="text-2xl font-bold text-indigo-900">
          {table.settings.defaultBuyIn} chips
        </p>
        <p className="text-sm text-indigo-700">
          (${startingDollar} {table.settings.currency} at {table.settings.chipToDollar}{' '}
          per chip)
        </p>
      </div>

      {isHost ? (
        <button
          type="button"
          onClick={() => uid && startGame(code, uid)}
          disabled={!allReady}
          className="w-full rounded-md bg-indigo-600 px-4 py-3 text-lg font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {allReady ? 'Start Game' : 'Waiting for everyone to ready up…'}
        </button>
      ) : you ? (
        <button
          type="button"
          onClick={() => setPlayerReady(code, you.uid, !you.ready)}
          className={`w-full rounded-md px-4 py-3 text-lg font-semibold ${
            you.ready
              ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200'
              : 'bg-emerald-600 text-white hover:bg-emerald-700'
          }`}
        >
          {you.ready ? "You're ready — tap to undo" : 'Ready Up'}
        </button>
      ) : null}
    </div>
  )
}

function Field({
  label,
  value,
  onChange,
  step,
  disabled,
}: {
  label: string
  value: number
  onChange: (v: number) => void
  step?: string
  disabled?: boolean
}) {
  const [text, setText] = useState(String(value))
  const [focused, setFocused] = useState(false)

  useEffect(() => {
    if (!focused) setText(String(value))
  }, [value, focused])

  function commit() {
    const parsed = Number(text)
    if (text.trim() !== '' && !Number.isNaN(parsed)) {
      onChange(parsed)
    } else {
      setText(String(value))
    }
  }

  return (
    <div>
      <label className="block text-sm font-medium text-gray-700">{label}</label>
      <input
        type="number"
        step={step ?? '1'}
        value={text}
        disabled={disabled}
        onFocus={() => setFocused(true)}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          setFocused(false)
          commit()
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit()
        }}
        className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 focus:border-indigo-500 focus:outline-none disabled:bg-gray-50 disabled:opacity-60"
      />
    </div>
  )
}

export default TablePage
