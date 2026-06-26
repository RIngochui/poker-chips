import { useEffect, useRef, useState } from 'react'
import {
  cancelAward,
  computeBlindSeats,
  confirmAward,
  dealNextStreet,
  kickPlayer,
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
  undoLastHand,
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
  const sorted = [...players].sort((a, b) => a.seat - b.seat).filter((p) => p.status !== 'left')
  const active = sorted.filter((p) => p.status === 'active')
  const contenders = active.filter((p) => !p.folded)
  const maxCommitted = Math.max(0, ...contenders.map((p) => p.committed))
  const { sbSeat, bbSeat } = computeBlindSeats(active, table.buttonSeat)
  const raiseLimit = table.settings.raiseLimit
  const pending = table.pendingAward
  const awaitingNextStreet =
    table.handInProgress && table.actingSeat === null && table.street !== 'river'
  const isHost = uid !== null && uid === table.createdBy
  const you = sorted.find((p) => p.uid === uid)
  const isYourTurn = table.handInProgress && you !== undefined && you.seat === table.actingSeat

  const isIOS = typeof navigator !== 'undefined' && /iphone|ipad|ipod/i.test(navigator.userAgent)
  const isStandalone =
    typeof window !== 'undefined' &&
    (window.matchMedia('(display-mode: standalone)').matches ||
      (navigator as unknown as { standalone?: boolean }).standalone === true)

  const [alertsMuted, setAlertsMuted] = useState(
    () => localStorage.getItem('poker-chips:turnAlertsMuted') === '1',
  )
  function setMuted(muted: boolean) {
    localStorage.setItem('poker-chips:turnAlertsMuted', muted ? '1' : '0')
    setAlertsMuted(muted)
  }

  // Buzz + best-effort in-page notification when it becomes your turn.
  // Only fires while this tab is open/foregrounded — there's no backend
  // to deliver a true locked-screen push notification. Players can mute
  // this from the banner below without revoking browser permission.
  const wasYourTurn = useRef(false)
  useEffect(() => {
    if (isYourTurn && !wasYourTurn.current && !alertsMuted) {
      if ('vibrate' in navigator) navigator.vibrate(200)
      if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        new Notification('Your turn', { body: 'It’s your turn to act.' })
      }
    }
    wasYourTurn.current = isYourTurn
  }, [isYourTurn, alertsMuted])

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

  const [winnerUids, setWinnerUids] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [notifPermission, setNotifPermission] = useState<NotificationPermission | null>(
    typeof Notification !== 'undefined' ? Notification.permission : null,
  )

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

  function toggleWinner(uid: string) {
    setWinnerUids((cur) => (cur.includes(uid) ? cur.filter((u) => u !== uid) : [...cur, uid]))
  }

  const needed = Math.floor(active.length / 2) + 1
  const proposedPlayers = pending
    ? players.filter((p) => pending.winnerUids.includes(p.uid))
    : []
  const handLimit = table.settings.handLimit
  const checkInDue =
    !table.handInProgress && handLimit !== null && table.handNumber >= handLimit

  return (
    <div className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 px-4 py-10 pb-28">
      {isIOS && !isStandalone && (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          On iPhone, turn alerts only work if this page is added to your Home Screen
          (Share → Add to Home Screen) — a regular Safari/Chrome tab can't vibrate or
          send notifications.
        </p>
      )}
      {(!isIOS || isStandalone) && notifPermission === 'default' && (
        <button
          type="button"
          onClick={async () => {
            const result = await Notification.requestPermission()
            setNotifPermission(result)
          }}
          className="rounded-md border border-indigo-200 bg-indigo-50 px-3 py-2 text-sm text-indigo-700 hover:bg-indigo-100"
        >
          Turn on turn alerts (vibrate + notify while this tab is open)
        </button>
      )}
      {(!isIOS || isStandalone) && notifPermission === 'granted' && (
        <button
          type="button"
          onClick={() => setMuted(!alertsMuted)}
          className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-600 hover:bg-gray-100"
        >
          {alertsMuted ? 'Turn alerts muted — tap to unmute' : 'Mute turn alerts'}
        </button>
      )}
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
            isHost={isHost}
            onKick={() => run(() => kickPlayer(code, p.uid, uid!))}
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

      {!table.handInProgress && !checkInDue && active.length < 2 && (
        <p className="text-center text-sm text-amber-700">
          Waiting on busted players to rebuy or drop off before the next hand
          can start.
        </p>
      )}

      {table.handInProgress && !pending && table.street === 'river' && (
        <div className="space-y-2 rounded-md border border-gray-200 bg-white p-4">
          <p className="text-sm font-medium text-gray-700">
            Propose pot winner{contenders.length > 1 ? '(s)' : ''}
          </p>
          <div className="space-y-1">
            {contenders.map((p) => (
              <label
                key={p.uid}
                className="flex items-center gap-2 rounded-md border border-gray-200 px-3 py-2 text-sm text-gray-700"
              >
                <input
                  type="checkbox"
                  checked={winnerUids.includes(p.uid)}
                  onChange={() => toggleWinner(p.uid)}
                  className="h-4 w-4"
                />
                {p.name} (seat {p.seat})
              </label>
            ))}
          </div>
          <button
            type="button"
            onClick={() =>
              uid &&
              winnerUids.length > 0 &&
              run(async () => {
                await proposeAward(code, winnerUids, uid)
                setWinnerUids([])
              })
            }
            disabled={busy || winnerUids.length === 0}
            className="w-full rounded-md bg-emerald-600 px-4 py-2 font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            Propose{winnerUids.length > 1 ? ` (split ${winnerUids.length} ways)` : ''}
          </button>
        </div>
      )}

      {table.handInProgress && pending && (
        <div className="space-y-2 rounded-md border border-amber-300 bg-amber-50 p-4">
          <p className="text-sm text-amber-800">
            <span className="font-medium">
              {proposedPlayers.map((p) => p.name).join(' & ') || 'Someone'}
            </span>{' '}
            proposed as winner{proposedPlayers.length > 1 ? 's' : ''} —{' '}
            {pending.confirmedBy.length}/{needed} confirmations
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

      {isHost && !table.handInProgress && table.lastHandSnapshot && (
        <button
          type="button"
          onClick={() =>
            uid &&
            confirm('Undo the last hand? This restores every stack and the pot to before it started.') &&
            run(() => undoLastHand(code, uid))
          }
          disabled={busy}
          className="w-full rounded-md border border-rose-300 px-4 py-2 text-sm font-medium text-rose-600 hover:bg-rose-50 disabled:opacity-50"
        >
          Undo last hand
        </button>
      )}

      {((!table.handInProgress && !checkInDue) || awaitingNextStreet) && (
        <div className="fixed inset-x-0 bottom-0 border-t border-gray-200 bg-white/95 px-4 py-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] shadow-[0_-2px_10px_rgba(0,0,0,0.05)]">
          <div className="mx-auto max-w-2xl">
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
  isHost,
  onKick,
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
  isHost: boolean
  onKick: () => void
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

  const tint = player.folded
    ? 'border-rose-200 bg-rose-50'
    : isBusted
      ? 'border-amber-200 bg-amber-50'
      : isTurn
        ? 'border-emerald-200 bg-emerald-50'
        : 'border-gray-200 bg-white'

  return (
    <div className={`rounded-md border p-4 ${tint}`}>
      <div className="flex items-center justify-between">
        <div>
          <span className="font-medium text-gray-900">
            {player.name}
            {isYou && <span className="ml-2 text-xs text-indigo-500">(you)</span>}
            {isButton && <span className="ml-2 text-xs text-amber-600">D</span>}
            {isSB && <span className="ml-2 text-xs text-sky-600">SB</span>}
            {isBB && <span className="ml-2 text-xs text-sky-600">BB</span>}
            {player.folded && <span className="ml-2 text-xs text-rose-600">folded</span>}
            {player.status === 'busted' && (
              <span className="ml-2 text-xs text-amber-600">busted — rebuy to rejoin</span>
            )}
            {isTurn && <span className="ml-2 text-xs text-indigo-600">to act</span>}
          </span>
          <p className="text-xs text-gray-400">Seat {player.seat}</p>
        </div>
        <div className="flex items-center gap-3 text-right">
          <div>
            <p className="font-semibold text-gray-900">{player.stack} chips</p>
            {player.committed > 0 && (
              <p className="text-xs text-gray-400">committed {player.committed}</p>
            )}
          </div>
          {isHost && !isYou && (
            <button
              type="button"
              onClick={() => confirm(`Kick ${player.name} from the table?`) && onKick()}
              title="Kick player"
              className="rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-500 hover:bg-gray-100"
            >
              Kick
            </button>
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
