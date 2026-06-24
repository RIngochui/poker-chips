import { useEffect, useState } from 'react'
import {
  cancelAward,
  computeBlindSeats,
  confirmAward,
  dealNextStreet,
  leaveTable,
  proposeAward,
  recordAllIn,
  recordBuyIn,
  recordCall,
  recordCheck,
  recordContinueVote,
  recordFold,
  recordRaise,
  startHand,
} from '../db/game'
import type { Player, Table } from '../db/types'

const CHIP_INCREMENTS = [1, 5, 10, 25, 100]

const STREET_LABEL: Record<Table['street'], string> = {
  preflop: 'Preflop',
  flop: 'Flop',
  turn: 'Turn',
  river: 'River',
}

const NEXT_STREET_LABEL: Record<Table['street'], string> = {
  preflop: 'Deal the Flop',
  flop: 'Deal the Turn',
  turn: 'Deal the River',
  river: '',
}

function ActiveGame({
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
  const active = sorted.filter((p) => p.status === 'active')
  const contenders = active.filter((p) => !p.folded)
  const maxCommitted = Math.max(0, ...contenders.map((p) => p.committed))
  const { sbSeat, bbSeat } = computeBlindSeats(active, table.buttonSeat)
  const raiseLimit = table.settings.raiseLimit
  const pending = table.pendingAward
  const awaitingNextStreet =
    table.handInProgress && table.actingSeat === null && table.street !== 'river'

  // Keep the screen awake while playing — phones dimming/locking is the
  // most common cause of the realtime view falling behind on mobile.
  // The OS releases the lock whenever the tab is backgrounded, so
  // re-acquire it each time the tab becomes visible again too.
  useEffect(() => {
    if (!('wakeLock' in navigator)) return

    let lock: WakeLockSentinel | null = null
    async function acquire() {
      if (document.visibilityState !== 'visible') return
      try {
        lock = await navigator.wakeLock.request('screen')
      } catch {
        // Ignore — not critical if unsupported or denied.
      }
    }

    acquire()
    document.addEventListener('visibilitychange', acquire)
    return () => {
      document.removeEventListener('visibilitychange', acquire)
      lock?.release().catch(() => {})
    }
  }, [])

  const [winnerUid, setWinnerUid] = useState('')
  const [busy, setBusy] = useState(false)

  async function run(fn: () => Promise<void>) {
    setBusy(true)
    try {
      await fn()
    } catch (err) {
      console.error(err)
      alert((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const needed = Math.floor(active.length / 2) + 1
  const proposedPlayer = pending && players.find((p) => p.uid === pending.winnerUid)
  const handLimit = table.settings.handLimit
  const checkInDue =
    !table.handInProgress && handLimit !== null && table.handNumber >= handLimit

  return (
    <div className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 px-4 py-10">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-gray-500">Table {table.code}</p>
          <p className="text-sm text-gray-400">Hand #{table.handNumber}</p>
          <p className="text-xs text-gray-400">
            Blinds {table.currentSmallBlind}/{table.currentBigBlind}
          </p>
          {table.handInProgress && (
            <>
              <p className="text-sm font-medium text-gray-600">
                {STREET_LABEL[table.street]}
              </p>
              <p className="text-xs text-gray-400">
                Raises {table.raiseCount}
                {raiseLimit !== null ? ` / ${raiseLimit}` : ' (no limit)'}
              </p>
            </>
          )}
        </div>
        <div className="text-right">
          <p className="text-sm text-gray-500">Pot</p>
          <p className="text-2xl font-bold text-indigo-600">{table.pot}</p>
        </div>
      </div>

      <div className="space-y-3">
        {sorted.map((p) => (
          <PlayerRow
            key={p.uid}
            code={code}
            player={p}
            isButton={p.seat === table.buttonSeat}
            isSB={p.seat === sbSeat}
            isBB={p.seat === bbSeat}
            isYou={p.uid === uid}
            isTurn={table.handInProgress && p.seat === table.actingSeat}
            callAmount={Math.max(0, maxCommitted - p.committed)}
            handInProgress={table.handInProgress}
            raiseBlocked={raiseLimit !== null && table.raiseCount >= raiseLimit}
            actorUid={uid}
          />
        ))}
      </div>

      {checkInDue && (
        <div className="space-y-3 rounded-md border border-amber-300 bg-amber-50 p-4">
          <p className="text-sm text-amber-800">
            {handLimit} hands played. Everyone who wants to keep playing needs to tap
            Continue — anyone who'd rather stop can drop off and cash out instead.
          </p>
          <div className="space-y-2">
            {active.map((p) => {
              const voted = table.continueVotes.includes(p.uid)
              return (
                <div key={p.uid} className="flex items-center justify-between">
                  <span className="text-sm text-gray-700">
                    {p.name} ({p.stack} chips)
                  </span>
                  {p.uid === uid ? (
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => run(() => leaveTable(code, p.uid, p.uid))}
                        disabled={busy || voted}
                        className="rounded-md border border-gray-300 px-3 py-1 text-sm text-gray-600 hover:bg-gray-100 disabled:opacity-50"
                      >
                        Drop off
                      </button>
                      <button
                        type="button"
                        onClick={() => run(() => recordContinueVote(code, p.uid))}
                        disabled={busy || voted}
                        className="rounded-md bg-emerald-600 px-3 py-1 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                      >
                        {voted ? 'Continuing' : 'Continue'}
                      </button>
                    </div>
                  ) : (
                    <span
                      className={`rounded-full px-3 py-1 text-xs font-medium ${
                        voted
                          ? 'bg-emerald-100 text-emerald-700'
                          : 'bg-gray-100 text-gray-400'
                      }`}
                    >
                      {voted ? 'Continuing' : 'Deciding…'}
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {!table.handInProgress && !checkInDue && (
        <button
          type="button"
          onClick={() => uid && run(() => startHand(code, uid))}
          disabled={busy || active.length < 2}
          className="w-full rounded-md bg-indigo-600 px-4 py-3 text-lg font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          Start Hand
        </button>
      )}

      {awaitingNextStreet && (
        <button
          type="button"
          onClick={() => run(() => dealNextStreet(code))}
          disabled={busy}
          className="w-full rounded-md bg-amber-500 px-4 py-3 text-lg font-semibold text-white hover:bg-amber-600 disabled:opacity-50"
        >
          {NEXT_STREET_LABEL[table.street]}
        </button>
      )}

      {table.handInProgress && !pending && (
        <div className="space-y-2 rounded-md border border-gray-200 bg-white p-4">
          <p className="text-sm font-medium text-gray-700">Propose pot winner</p>
          <div className="flex gap-2">
            <select
              value={winnerUid}
              onChange={(e) => setWinnerUid(e.target.value)}
              className="flex-1 rounded-md border border-gray-300 px-3 py-2"
            >
              <option value="">Select winner…</option>
              {contenders.map((p) => (
                <option key={p.uid} value={p.uid}>
                  {p.name} (seat {p.seat})
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() =>
                uid &&
                winnerUid &&
                run(async () => {
                  await proposeAward(code, winnerUid, uid)
                  setWinnerUid('')
                })
              }
              disabled={busy || !winnerUid}
              className="rounded-md bg-emerald-600 px-4 py-2 font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              Propose
            </button>
          </div>
        </div>
      )}

      {table.handInProgress && pending && (
        <div className="space-y-2 rounded-md border border-amber-300 bg-amber-50 p-4">
          <p className="text-sm text-amber-800">
            <span className="font-medium">{proposedPlayer?.name ?? 'Someone'}</span>{' '}
            proposed as winner — {pending.confirmedBy.length}/{needed} confirmations
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => uid && run(() => confirmAward(code, uid))}
              disabled={busy || !uid || pending.confirmedBy.includes(uid)}
              className="flex-1 rounded-md bg-emerald-600 px-4 py-2 font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              {uid && pending.confirmedBy.includes(uid) ? 'Confirmed' : 'Confirm'}
            </button>
            <button
              type="button"
              onClick={() => run(() => cancelAward(code))}
              disabled={busy}
              className="rounded-md border border-gray-300 px-4 py-2 font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function PlayerRow({
  code,
  player,
  isButton,
  isSB,
  isBB,
  isYou,
  isTurn,
  callAmount,
  handInProgress,
  raiseBlocked,
  actorUid,
}: {
  code: string
  player: Player
  isButton: boolean
  isSB: boolean
  isBB: boolean
  isYou: boolean
  isTurn: boolean
  callAmount: number
  handInProgress: boolean
  raiseBlocked: boolean
  actorUid: string | null
}) {
  const [betAmount, setBetAmount] = useState(0)
  const [buyInAmount, setBuyInAmount] = useState(0)

  async function act(fn: () => Promise<void>) {
    if (!actorUid) return
    try {
      await fn()
    } catch (err) {
      console.error(err)
      alert((err as Error).message)
    }
  }

  const canAct =
    handInProgress && player.status === 'active' && !player.folded && isTurn && isYou
  const isBusted = player.status === 'busted'

  return (
    <div
      className={`rounded-md border bg-white p-4 ${
        isTurn ? 'border-indigo-400 ring-2 ring-indigo-100' : 'border-gray-200'
      }`}
    >
      <div className="flex items-center justify-between">
        <div>
          <span className="font-medium text-gray-900">
            {player.name}
            {isYou && <span className="ml-2 text-xs text-indigo-500">(you)</span>}
            {isButton && <span className="ml-2 text-xs text-amber-600">D</span>}
            {isSB && <span className="ml-2 text-xs text-sky-600">SB</span>}
            {isBB && <span className="ml-2 text-xs text-sky-600">BB</span>}
            {player.folded && <span className="ml-2 text-xs text-gray-400">folded</span>}
            {player.status === 'busted' && (
              <span className="ml-2 text-xs text-rose-500">busted — rebuy to rejoin</span>
            )}
            {player.status === 'left' && (
              <span className="ml-2 text-xs text-gray-400">left the game</span>
            )}
            {isTurn && <span className="ml-2 text-xs text-indigo-600">to act</span>}
          </span>
          <p className="text-xs text-gray-400">Seat {player.seat}</p>
        </div>
        <div className="text-right">
          <p className="font-semibold text-gray-900">{player.stack} chips</p>
          {player.committed > 0 && (
            <p className="text-xs text-gray-400">committed {player.committed}</p>
          )}
        </div>
      </div>

      {canAct && (
        <div className="mt-3 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            {CHIP_INCREMENTS.map((inc) => (
              <button
                key={inc}
                type="button"
                onClick={() => setBetAmount((v) => v + inc)}
                title={`+${inc}`}
                className="rounded-full p-1 hover:bg-indigo-50"
              >
                <img src={`/chips/${inc}.png`} alt={`+${inc} chip`} className="h-10 w-10" />
              </button>
            ))}
            <button
              type="button"
              onClick={() => setBetAmount(0)}
              className="rounded-full border border-gray-200 px-3 py-1 text-sm text-gray-500 hover:bg-gray-100"
            >
              Clear
            </button>
            <input
              type="number"
              value={betAmount}
              onChange={(e) => setBetAmount(Number(e.target.value))}
              className="w-20 rounded-md border border-gray-300 px-2 py-1 text-sm"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() =>
                act(async () => {
                  if (betAmount > 0) await recordRaise(code, player.uid, betAmount, actorUid!)
                  setBetAmount(0)
                })
              }
              disabled={raiseBlocked || betAmount <= 0}
              title={raiseBlocked ? 'Raise limit reached for this round' : undefined}
              className="rounded-md bg-indigo-600 px-3 py-1 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              Bet / Raise {betAmount > 0 ? betAmount : ''}
            </button>
            <button
              type="button"
              onClick={() => act(() => recordCall(code, player.uid, callAmount, actorUid!))}
              disabled={callAmount <= 0}
              className="rounded-md bg-indigo-100 px-3 py-1 text-sm font-medium text-indigo-700 hover:bg-indigo-200 disabled:opacity-50"
            >
              Call {callAmount > 0 ? callAmount : ''}
            </button>
            <button
              type="button"
              onClick={() => act(() => recordCheck(code, player.uid, actorUid!))}
              disabled={callAmount > 0}
              title={callAmount > 0 ? 'There is a bet to you — call, raise, or fold' : undefined}
              className="rounded-md border border-gray-300 px-3 py-1 text-sm font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-50"
            >
              Check
            </button>
            <button
              type="button"
              onClick={() => act(() => recordAllIn(code, player.uid, actorUid!))}
              className="rounded-md bg-rose-600 px-3 py-1 text-sm font-medium text-white hover:bg-rose-700"
            >
              All In ({player.stack})
            </button>
            <button
              type="button"
              onClick={() => act(() => recordFold(code, player.uid, actorUid!))}
              className="rounded-md border border-red-300 px-3 py-1 text-sm font-medium text-red-600 hover:bg-red-50"
            >
              Fold
            </button>
          </div>
        </div>
      )}

      {isBusted && isYou && (
        <div className="mt-3 space-y-2 border-t border-gray-100 pt-3">
          <div className="flex flex-wrap items-center gap-2">
            {CHIP_INCREMENTS.map((inc) => (
              <button
                key={inc}
                type="button"
                onClick={() => setBuyInAmount((v) => v + inc)}
                className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-sm font-medium text-emerald-700 hover:bg-emerald-100"
              >
                +{inc}
              </button>
            ))}
            <input
              type="number"
              value={buyInAmount}
              onChange={(e) => setBuyInAmount(Number(e.target.value))}
              className="w-24 rounded-md border border-gray-300 px-2 py-1 text-sm"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() =>
                act(async () => {
                  if (buyInAmount > 0) {
                    await recordBuyIn(code, player.uid, buyInAmount, actorUid!, 'rebuy')
                  }
                  setBuyInAmount(0)
                })
              }
              disabled={buyInAmount <= 0}
              className="rounded-md border border-emerald-300 px-3 py-1 text-sm font-medium text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
            >
              Rebuy {buyInAmount > 0 ? buyInAmount : ''}
            </button>
            <button
              type="button"
              onClick={() => act(() => leaveTable(code, player.uid, player.uid))}
              disabled={handInProgress}
              title={handInProgress ? 'Finish the current hand first' : undefined}
              className="rounded-md border border-gray-300 px-3 py-1 text-sm text-gray-600 hover:bg-gray-100 disabled:opacity-50"
            >
              Drop off
            </button>
          </div>
        </div>
      )}

      {isBusted && !isYou && (
        <div className="mt-3 border-t border-gray-100 pt-3">
          <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-400">
            Inactive — waiting on rebuy
          </span>
        </div>
      )}
    </div>
  )
}

export default ActiveGame
