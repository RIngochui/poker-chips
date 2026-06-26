import {
  collection,
  doc,
  getDoc,
  getDocs,
  runTransaction,
  serverTimestamp,
  updateDoc,
  writeBatch,
  type Transaction,
} from 'firebase/firestore'
import { db } from './firebase'
import type {
  HandSnapshot,
  LedgerEntry,
  PendingAward,
  Player,
  Street,
  Table,
} from './types'

const STREET_ORDER: Street[] = ['preflop', 'flop', 'turn', 'river']

function activeSeats(players: Player[]): number[] {
  return players
    .filter((p) => p.status === 'active')
    .map((p) => p.seat)
    .sort((a, b) => a - b)
}

// Players still contesting the pot (not folded, not sitting out/busted/left).
function contenderSeats(players: Player[]): number[] {
  return players
    .filter((p) => p.status === 'active' && !p.folded)
    .map((p) => p.seat)
    .sort((a, b) => a - b)
}

// Contenders who still have chips behind and can therefore act.
function actorSeats(players: Player[]): number[] {
  return players
    .filter((p) => p.status === 'active' && !p.folded && p.stack > 0)
    .map((p) => p.seat)
    .sort((a, b) => a - b)
}

function nextActiveSeat(seats: number[], fromSeat: number): number {
  if (seats.length === 0) return fromSeat
  const above = seats.filter((s) => s > fromSeat)
  return above.length > 0 ? above[0] : seats[0]
}

function seatBefore(seats: number[], fromSeat: number): number {
  if (seats.length === 0) return fromSeat
  const below = seats.filter((s) => s < fromSeat)
  return below.length > 0 ? below[below.length - 1] : seats[seats.length - 1]
}

export function computeBlindSeats(
  players: Player[],
  buttonSeat: number,
): { sbSeat: number; bbSeat: number } {
  const seats = activeSeats(players)
  if (seats.length < 2) return { sbSeat: buttonSeat, bbSeat: buttonSeat }

  // The seat that held the button might belong to someone who's since
  // busted out or dropped off — fall back to the first remaining seat.
  const effectiveButton = seats.includes(buttonSeat) ? buttonSeat : seats[0]

  if (seats.length === 2) {
    // Heads-up: the button posts the small blind.
    const other = seats.find((s) => s !== effectiveButton) ?? effectiveButton
    return { sbSeat: effectiveButton, bbSeat: other }
  }

  const sbSeat = nextActiveSeat(seats, effectiveButton)
  const bbSeat = nextActiveSeat(seats, sbSeat)
  return { sbSeat, bbSeat }
}

// Decide who acts next (if anyone) after `actorSeat` takes an action.
// `players` must already reflect the action just taken (folded/stack/committed).
// `isRaise` means the action reopens the betting round for everyone else.
//
// Walks the table's stable seat order starting after the actor, skipping
// anyone who can't act (folded, or all-in with stack 0). If it reaches the
// closer's seat before finding someone who can still act, the round is over
// — this is what lets an all-in player's opponents still get a turn instead
// of the round closing the instant the all-in player runs out of chips.
function resolveTurn(
  players: Player[],
  actorSeat: number,
  prevCloserSeat: number | null,
  isRaise: boolean,
): { actingSeat: number | null; closerSeat: number | null; handDecided: boolean } {
  const contenders = contenderSeats(players)
  if (contenders.length <= 1) {
    return { actingSeat: null, closerSeat: null, handDecided: true }
  }

  const closerSeat = isRaise ? actorSeat : prevCloserSeat

  if (!isRaise && actorSeat === closerSeat) {
    // Action has come back around to whoever closes the round.
    return { actingSeat: null, closerSeat, handDecided: false }
  }

  const order = activeSeats(players)
  const contenderSet = new Set(contenders)
  const stackBySeat = new Map(players.map((p) => [p.seat, p.stack]))
  const startIdx = order.indexOf(actorSeat)

  for (let step = 1; step <= order.length; step++) {
    const seat = order[(startIdx + step) % order.length]
    if (!contenderSet.has(seat)) continue // folded — skip

    if ((stackBySeat.get(seat) ?? 0) > 0) {
      return { actingSeat: seat, closerSeat, handDecided: false }
    }
    if (seat === closerSeat) {
      // Reached the closer's seat and they're all-in — nobody left to act.
      return { actingSeat: null, closerSeat, handDecided: false }
    }
  }

  return { actingSeat: null, closerSeat, handDecided: false }
}

// When a betting round closes, if the last raise wasn't fully matched by
// anyone (e.g. an all-in for more than the rest of the table can call), the
// unmatched excess must go back to whoever put it in — they were never
// actually contesting it for the pot. Returns the corrected pot total.
function refundUncalledBet(
  tx: Transaction,
  tableId: string,
  players: Player[],
  pot: number,
): number {
  const contenders = players.filter((p) => p.status === 'active' && !p.folded)
  if (contenders.length < 2) return pot

  const sorted = [...contenders].sort((a, b) => b.committed - a.committed)
  const top = sorted[0]
  const second = sorted[1]
  const excess = top.committed - second.committed
  if (excess <= 0) return pot

  tx.update(playerRef(tableId, top.uid), {
    stack: top.stack + excess,
    committed: top.committed - excess,
  })
  return pot - excess
}

function playerRef(tableId: string, uid: string) {
  return doc(db, 'tables', tableId, 'players', uid)
}

function tableRef(tableId: string) {
  return doc(db, 'tables', tableId)
}

function logLedger(
  tx: Transaction,
  tableId: string,
  entry: Omit<LedgerEntry, 'at'>,
) {
  const ref = doc(collection(db, 'tables', tableId, 'ledger'))
  tx.set(ref, { ...entry, at: serverTimestamp() })
}

async function loadPlayers(tableId: string): Promise<Player[]> {
  const snap = await getDocs(collection(db, 'tables', tableId, 'players'))
  return snap.docs.map((d) => d.data() as Player)
}

// Just the uids — used to know which docs to re-read transactionally for a
// consistent snapshot, since seat/uid never change after joining.
async function loadPlayerIds(tableId: string): Promise<string[]> {
  return (await loadPlayers(tableId)).map((p) => p.uid)
}

async function assertTurn(
  tx: Transaction,
  tableId: string,
  uid: string,
  by: string,
): Promise<{ table: Table; player: Player }> {
  if (uid !== by) throw new Error('You can only act for yourself')

  const [tSnap, pSnap] = await Promise.all([
    tx.get(tableRef(tableId)),
    tx.get(playerRef(tableId, uid)),
  ])
  if (!tSnap.exists() || !pSnap.exists()) throw new Error('Not found')
  const table = tSnap.data() as Table
  const player = pSnap.data() as Player

  if (!table.handInProgress) throw new Error('No hand in progress')
  if (table.actingSeat !== player.seat) throw new Error("It is not this player's turn")

  return { table, player }
}

export async function startHand(tableId: string, by: string): Promise<void> {
  const players = await loadPlayers(tableId)
  const active = players.filter((p) => p.status === 'active')
  if (active.length < 2) throw new Error('Need at least 2 active players')

  // Clear leftover hand state from any prior hand.
  const toReset = players.filter((p) => p.committed !== 0 || p.folded)
  if (toReset.length > 0) {
    const batch = writeBatch(db)
    for (const p of toReset) {
      batch.update(playerRef(tableId, p.uid), { committed: 0, folded: false })
    }
    await batch.commit()
  }
  // Reflect that cleanup in-memory too, so the undo snapshot below (and
  // the blind seat computation) reflect the actual pre-blind state rather
  // than whatever was left over from before the reset.
  const cleaned = players.map((p) =>
    p.committed !== 0 || p.folded ? { ...p, committed: 0, folded: false } : p,
  )

  await runTransaction(db, async (tx) => {
    const tSnap = await tx.get(tableRef(tableId))
    if (!tSnap.exists()) throw new Error('Table not found')
    const table = tSnap.data() as Table
    if (table.handInProgress) return

    // Snapshot pre-hand state so the host can undo this hand once it
    // finishes. Each new hand overwrites the previous snapshot, so only
    // the most recently completed hand is ever undoable.
    const snapshot: HandSnapshot = {
      players: Object.fromEntries(
        cleaned.map((p) => [
          p.uid,
          {
            stack: p.stack,
            totalBuyIn: p.totalBuyIn,
            committed: p.committed,
            folded: p.folded,
            status: p.status,
          },
        ]),
      ),
      pot: table.pot,
      handNumber: table.handNumber,
      buttonSeat: table.buttonSeat,
      currentSmallBlind: table.currentSmallBlind,
      currentBigBlind: table.currentBigBlind,
      street: table.street,
    }

    const { sbSeat, bbSeat } = computeBlindSeats(active, table.buttonSeat)
    const sbUid = active.find((p) => p.seat === sbSeat)!.uid
    const bbUid = active.find((p) => p.seat === bbSeat)!.uid

    const [sbSnap, bbSnap] = await Promise.all([
      tx.get(playerRef(tableId, sbUid)),
      tx.get(playerRef(tableId, bbUid)),
    ])
    const sbPlayer = sbSnap.data() as Player
    const bbPlayer = bbSnap.data() as Player

    const newHandNumber = table.handNumber + 1
    const increase = table.settings.blindIncrease
    const shouldEscalate =
      increase !== null && newHandNumber > 1 && (newHandNumber - 1) % increase.everyHands === 0
    const smallBlind = shouldEscalate ? table.currentSmallBlind + increase!.amount : table.currentSmallBlind
    const bigBlind = shouldEscalate ? table.currentBigBlind + increase!.amount * 2 : table.currentBigBlind

    let pot = 0
    const sbAmount = Math.min(smallBlind, sbPlayer.stack)
    const sbStackAfter = sbPlayer.stack - sbAmount
    pot += sbAmount
    tx.update(playerRef(tableId, sbPlayer.uid), {
      stack: sbStackAfter,
      committed: sbAmount,
    })
    logLedger(tx, tableId, {
      type: 'blind',
      uid: sbPlayer.uid,
      amount: -sbAmount,
      stackAfter: sbStackAfter,
      potAfter: pot,
      by,
    })

    const bbAmount = Math.min(bigBlind, bbPlayer.stack)
    const bbStackAfter = bbPlayer.stack - bbAmount
    pot += bbAmount
    tx.update(playerRef(tableId, bbPlayer.uid), {
      stack: bbStackAfter,
      committed: bbAmount,
    })
    logLedger(tx, tableId, {
      type: 'blind',
      uid: bbPlayer.uid,
      amount: -bbAmount,
      stackAfter: bbStackAfter,
      potAfter: pot,
      by,
    })

    // Simulate post-blind state to see who can still act.
    const postBlind = active.map((p) => {
      if (p.uid === sbPlayer.uid) return { ...p, stack: sbStackAfter, committed: sbAmount }
      if (p.uid === bbPlayer.uid) return { ...p, stack: bbStackAfter, committed: bbAmount }
      return p
    })
    const actors = actorSeats(postBlind)
    // Action starts left of the big blind (heads-up: the button/SB acts first).
    const actingSeat = actors.length >= 2 ? nextActiveSeat(actors, bbSeat) : null

    tx.update(tableRef(tableId), {
      pot,
      handNumber: newHandNumber,
      currentSmallBlind: smallBlind,
      currentBigBlind: bigBlind,
      handInProgress: true,
      actingSeat,
      closerSeat: bbSeat,
      raiseCount: 0,
      pendingAward: null,
      street: 'preflop',
      continueVotes: [],
      lastHandSnapshot: snapshot,
    })
  })
}

// Records that a player wants to keep playing past the hand-limit check-in.
// Starts the next hand automatically once every still-active player has
// voted to continue (players who dropped off don't count).
export async function recordContinueVote(tableId: string, by: string): Promise<void> {
  const tSnap = await getDoc(tableRef(tableId))
  if (!tSnap.exists()) throw new Error('Table not found')
  const table = tSnap.data() as Table
  if (table.handInProgress) return

  const votes = table.continueVotes.includes(by)
    ? table.continueVotes
    : [...table.continueVotes, by]

  const players = await loadPlayers(tableId)
  const active = players.filter((p) => p.status === 'active')
  const allVoted = active.length >= 2 && active.every((p) => votes.includes(p.uid))

  if (allVoted) {
    await startHand(tableId, by)
  } else {
    await updateDoc(tableRef(tableId), { continueVotes: votes })
  }
}

export async function recordRaise(
  tableId: string,
  uid: string,
  amount: number,
  by: string,
): Promise<void> {
  if (amount <= 0) throw new Error('Enter an amount')
  const playerIds = await loadPlayerIds(tableId)

  await runTransaction(db, async (tx) => {
    const { table, player } = await assertTurn(tx, tableId, uid, by)

    const limit = table.settings.raiseLimit
    if (limit !== null && table.raiseCount >= limit) {
      throw new Error('Raise limit reached for this round')
    }

    const freshSnaps = await Promise.all(playerIds.map((id) => tx.get(playerRef(tableId, id))))
    const players = freshSnaps.map((s) => s.data() as Player)

    const chips = Math.min(amount, player.stack)
    const stackAfter = player.stack - chips
    const potAfter = table.pot + chips

    const simulated = players.map((p) =>
      p.uid === uid ? { ...p, stack: stackAfter, committed: p.committed + chips } : p,
    )
    const turn = resolveTurn(simulated, player.seat, table.closerSeat, true)

    tx.update(playerRef(tableId, uid), {
      stack: stackAfter,
      committed: player.committed + chips,
    })
    const finalPot =
      turn.actingSeat === null && !turn.handDecided
        ? refundUncalledBet(tx, tableId, simulated, potAfter)
        : potAfter
    tx.update(tableRef(tableId), {
      pot: finalPot,
      raiseCount: table.raiseCount + 1,
      actingSeat: turn.actingSeat,
      closerSeat: turn.closerSeat,
    })
    logLedger(tx, tableId, {
      type: 'bet',
      uid,
      amount: -chips,
      stackAfter,
      potAfter: finalPot,
      by,
    })
  })
}

export async function recordAllIn(tableId: string, uid: string, by: string): Promise<void> {
  const playerIds = await loadPlayerIds(tableId)

  await runTransaction(db, async (tx) => {
    const { table, player } = await assertTurn(tx, tableId, uid, by)
    const chips = player.stack
    if (chips <= 0) throw new Error('No chips left to push all-in')

    const freshSnaps = await Promise.all(playerIds.map((id) => tx.get(playerRef(tableId, id))))
    const players = freshSnaps.map((s) => s.data() as Player)

    const maxOtherCommitted = Math.max(
      0,
      ...players
        .filter((p) => p.status === 'active' && !p.folded && p.uid !== uid)
        .map((p) => p.committed),
    )
    const newCommitted = player.committed + chips
    const isRaise = newCommitted > maxOtherCommitted

    const stackAfter = 0
    const potAfter = table.pot + chips

    const simulated = players.map((p) =>
      p.uid === uid ? { ...p, stack: stackAfter, committed: newCommitted } : p,
    )
    const turn = resolveTurn(simulated, player.seat, table.closerSeat, isRaise)

    tx.update(playerRef(tableId, uid), { stack: stackAfter, committed: newCommitted })
    const finalPot =
      turn.actingSeat === null && !turn.handDecided
        ? refundUncalledBet(tx, tableId, simulated, potAfter)
        : potAfter
    tx.update(tableRef(tableId), {
      pot: finalPot,
      raiseCount: isRaise ? table.raiseCount + 1 : table.raiseCount,
      actingSeat: turn.actingSeat,
      closerSeat: turn.closerSeat,
    })
    logLedger(tx, tableId, {
      type: 'bet',
      uid,
      amount: -chips,
      stackAfter,
      potAfter: finalPot,
      by,
    })
  })
}

export async function recordCall(
  tableId: string,
  uid: string,
  amount: number,
  by: string,
): Promise<void> {
  const playerIds = await loadPlayerIds(tableId)

  await runTransaction(db, async (tx) => {
    const { table, player } = await assertTurn(tx, tableId, uid, by)

    const freshSnaps = await Promise.all(playerIds.map((id) => tx.get(playerRef(tableId, id))))
    const players = freshSnaps.map((s) => s.data() as Player)

    const chips = Math.min(Math.max(amount, 0), player.stack)
    const stackAfter = player.stack - chips
    const potAfter = table.pot + chips

    const simulated = players.map((p) =>
      p.uid === uid ? { ...p, stack: stackAfter, committed: p.committed + chips } : p,
    )
    const turn = resolveTurn(simulated, player.seat, table.closerSeat, false)

    tx.update(playerRef(tableId, uid), {
      stack: stackAfter,
      committed: player.committed + chips,
    })
    const finalPot =
      turn.actingSeat === null && !turn.handDecided
        ? refundUncalledBet(tx, tableId, simulated, potAfter)
        : potAfter
    tx.update(tableRef(tableId), {
      pot: finalPot,
      actingSeat: turn.actingSeat,
      closerSeat: turn.closerSeat,
    })
    logLedger(tx, tableId, {
      type: 'bet',
      uid,
      amount: -chips,
      stackAfter,
      potAfter: finalPot,
      by,
    })
  })
}

export async function recordCheck(
  tableId: string,
  uid: string,
  by: string,
): Promise<void> {
  const playerIds = await loadPlayerIds(tableId)

  await runTransaction(db, async (tx) => {
    const { table, player } = await assertTurn(tx, tableId, uid, by)

    const freshSnaps = await Promise.all(playerIds.map((id) => tx.get(playerRef(tableId, id))))
    const players = freshSnaps.map((s) => s.data() as Player)

    const maxOtherCommitted = Math.max(
      0,
      ...players
        .filter((p) => p.status === 'active' && !p.folded && p.uid !== uid)
        .map((p) => p.committed),
    )
    if (player.committed < maxOtherCommitted) {
      throw new Error('There is a bet to you — call, raise, or fold')
    }

    const turn = resolveTurn(players, player.seat, table.closerSeat, false)

    const finalPot =
      turn.actingSeat === null && !turn.handDecided
        ? refundUncalledBet(tx, tableId, players, table.pot)
        : table.pot
    tx.update(tableRef(tableId), {
      pot: finalPot,
      actingSeat: turn.actingSeat,
      closerSeat: turn.closerSeat,
    })
    logLedger(tx, tableId, {
      type: 'bet',
      uid,
      amount: 0,
      stackAfter: player.stack,
      potAfter: finalPot,
      by,
    })
  })
}

export async function recordFold(
  tableId: string,
  uid: string,
  by: string,
): Promise<void> {
  const playerIds = await loadPlayerIds(tableId)
  let autoAwardUid: string | null = null

  await runTransaction(db, async (tx) => {
    const { table, player } = await assertTurn(tx, tableId, uid, by)

    const freshSnaps = await Promise.all(playerIds.map((id) => tx.get(playerRef(tableId, id))))
    const players = freshSnaps.map((s) => s.data() as Player)

    tx.update(playerRef(tableId, uid), { folded: true })

    const simulated = players.map((p) => (p.uid === uid ? { ...p, folded: true } : p))
    const turn = resolveTurn(simulated, player.seat, table.closerSeat, false)

    if (turn.handDecided) {
      const remaining = simulated.find((p) => p.status === 'active' && !p.folded)
      autoAwardUid = remaining?.uid ?? null
    } else {
      const finalPot =
        turn.actingSeat === null
          ? refundUncalledBet(tx, tableId, simulated, table.pot)
          : table.pot
      tx.update(tableRef(tableId), {
        pot: finalPot,
        actingSeat: turn.actingSeat,
        closerSeat: turn.closerSeat,
      })
    }
  })

  if (autoAwardUid) {
    await awardPot(tableId, [autoAwardUid], by)
  }
}

export async function dealNextStreet(tableId: string): Promise<void> {
  const players = await loadPlayers(tableId)
  const contenders = players.filter((p) => p.status === 'active' && !p.folded)

  const toReset = contenders.filter((p) => p.committed !== 0)
  if (toReset.length > 0) {
    const batch = writeBatch(db)
    for (const p of toReset) {
      batch.update(playerRef(tableId, p.uid), { committed: 0 })
    }
    await batch.commit()
  }

  await runTransaction(db, async (tx) => {
    const tSnap = await tx.get(tableRef(tableId))
    if (!tSnap.exists()) throw new Error('Table not found')
    const table = tSnap.data() as Table
    if (!table.handInProgress) throw new Error('No hand in progress')
    if (table.actingSeat !== null) throw new Error('Betting is still in progress')

    const idx = STREET_ORDER.indexOf(table.street)
    if (idx >= STREET_ORDER.length - 1) throw new Error('Already on the river')
    const nextStreet = STREET_ORDER[idx + 1]

    const resetContenders = contenders.map((p) => ({ ...p, committed: 0 }))
    const actors = actorSeats(resetContenders)
    let actingSeat: number | null = null
    let closerSeat: number | null = null
    if (actors.length >= 2) {
      actingSeat = nextActiveSeat(actors, table.buttonSeat)
      closerSeat = seatBefore(actors, actingSeat)
    }

    tx.update(tableRef(tableId), {
      street: nextStreet,
      raiseCount: 0,
      actingSeat,
      closerSeat,
    })
  })
}

export async function recordBuyIn(
  tableId: string,
  uid: string,
  amount: number,
  by: string,
  type: 'buy_in' | 'rebuy' = 'buy_in',
): Promise<void> {
  if (amount <= 0) return
  const players = await loadPlayers(tableId)
  let autoAwardUid: string | null = null

  await runTransaction(db, async (tx) => {
    const [tSnap, pSnap] = await Promise.all([
      tx.get(tableRef(tableId)),
      tx.get(playerRef(tableId, uid)),
    ])
    if (!tSnap.exists() || !pSnap.exists()) throw new Error('Not found')
    const table = tSnap.data() as Table
    const player = pSnap.data() as Player

    const stackAfter = player.stack + amount
    const updates: Record<string, unknown> = {
      stack: stackAfter,
      totalBuyIn: player.totalBuyIn + amount,
    }
    if (player.status === 'busted') updates.status = 'active'

    // Rebuying mid-hand can't buy back into a hand already in progress —
    // they sit this one out and rejoin fresh next hand.
    if (table.handInProgress && !player.folded) {
      updates.folded = true
      const simulated = players.map((p) => (p.uid === uid ? { ...p, folded: true } : p))
      const remaining = simulated.filter((p) => p.status === 'active' && !p.folded)
      if (remaining.length === 1) autoAwardUid = remaining[0].uid
    }

    tx.update(playerRef(tableId, uid), updates)
    logLedger(tx, tableId, {
      type,
      uid,
      amount,
      stackAfter,
      potAfter: table.pot,
      by,
    })
  })

  if (autoAwardUid) {
    await awardPot(tableId, [autoAwardUid], by)
  }
}

export async function awardPot(
  tableId: string,
  winnerUids: string[],
  by: string,
): Promise<void> {
  if (winnerUids.length === 0) throw new Error('No winner selected')
  const players = await loadPlayers(tableId)
  const active = players.filter((p) => p.status === 'active')
  const winnerSet = new Set(winnerUids)

  const others = players.filter(
    (p) => !winnerSet.has(p.uid) && (p.committed !== 0 || p.folded),
  )
  if (others.length > 0) {
    const batch = writeBatch(db)
    for (const p of others) {
      const updates: Record<string, unknown> = { committed: 0, folded: false }
      if (p.stack === 0 && p.status === 'active') updates.status = 'busted'
      batch.update(playerRef(tableId, p.uid), updates)
    }
    await batch.commit()
  }

  await runTransaction(db, async (tx) => {
    const tSnap = await tx.get(tableRef(tableId))
    if (!tSnap.exists()) throw new Error('Table not found')
    const table = tSnap.data() as Table

    const winnerSnaps = await Promise.all(
      winnerUids.map((uid) => tx.get(playerRef(tableId, uid))),
    )
    const winners = winnerSnaps.map((snap) => {
      if (!snap.exists()) throw new Error('Player not found')
      return snap.data() as Player
    })

    // Split evenly; any remainder (pot not divisible by winner count) is
    // handed out one chip at a time starting from the seat right after
    // the button — the standard poker convention for odd chips.
    const base = Math.floor(table.pot / winners.length)
    let remainder = table.pot - base * winners.length
    const order = [...winners].sort((a, b) => {
      const seats = activeSeats(active)
      const distFromButton = (seat: number) => {
        const idx = seats.indexOf(seat)
        const btnIdx = seats.indexOf(table.buttonSeat)
        return ((idx - btnIdx + seats.length) % seats.length) || seats.length
      }
      return distFromButton(a.seat) - distFromButton(b.seat)
    })

    for (const winner of order) {
      const share = base + (remainder > 0 ? 1 : 0)
      if (remainder > 0) remainder--
      const stackAfter = winner.stack + share
      const winnerUpdates: Record<string, unknown> = { stack: stackAfter, committed: 0 }
      if (stackAfter === 0) winnerUpdates.status = 'busted'
      tx.update(playerRef(tableId, winner.uid), winnerUpdates)
      logLedger(tx, tableId, {
        type: 'award_pot',
        uid: winner.uid,
        amount: share,
        stackAfter,
        potAfter: 0,
        by,
      })
    }

    const seats = activeSeats(active)
    const nextButton = nextActiveSeat(seats, table.buttonSeat)

    tx.update(tableRef(tableId), {
      pot: 0,
      handInProgress: false,
      buttonSeat: nextButton,
      actingSeat: null,
      closerSeat: null,
      pendingAward: null,
      street: 'preflop',
    })
  })

  await checkGameOver(tableId)
}

export async function checkGameOver(tableId: string): Promise<void> {
  const players = await loadPlayers(tableId)
  // Busted is recoverable via rebuy — only an explicit drop-off ('left')
  // permanently removes someone from the game. Only end the game once
  // fewer than 2 players remain who could ever play another hand.
  const stillInGame = players.filter((p) => p.status !== 'left').length
  if (stillInGame <= 1) {
    await updateDoc(tableRef(tableId), { status: 'ended' })
  }
}

export async function leaveTable(
  tableId: string,
  uid: string,
  by: string,
): Promise<void> {
  if (uid !== by) throw new Error('You can only drop yourself off')

  const players = await loadPlayers(tableId)
  let gameEnded = false

  await runTransaction(db, async (tx) => {
    const [tSnap, pSnap] = await Promise.all([
      tx.get(tableRef(tableId)),
      tx.get(playerRef(tableId, uid)),
    ])
    if (!tSnap.exists() || !pSnap.exists()) throw new Error('Not found')
    const table = tSnap.data() as Table
    const player = pSnap.data() as Player
    if (table.handInProgress && player.status === 'active') {
      throw new Error('Finish the current hand first')
    }
    if (player.status === 'left') return

    tx.update(playerRef(tableId, uid), { status: 'left' })
    logLedger(tx, tableId, {
      type: 'cash_out',
      uid,
      amount: player.stack,
      stackAfter: player.stack,
      potAfter: table.pot,
      by,
    })

    // End the game immediately if this drop-off leaves at most one player
    // who could still ever play (busted is recoverable, 'left' isn't).
    const remainingInGame = players.filter(
      (p) => p.uid !== uid && p.status !== 'left',
    ).length
    if (remainingInGame <= 1) {
      tx.update(tableRef(tableId), { status: 'ended' })
      gameEnded = true
    }
  })

  if (gameEnded) return

  // If everyone who stayed had already voted to continue, the dropout
  // might have been the last holdout — start the next hand now.
  const active = players.filter((p) => p.uid !== uid && p.status === 'active')
  const tSnap = await getDoc(tableRef(tableId))
  const table = tSnap.exists() ? (tSnap.data() as Table) : null
  if (table) {
    const allVoted = active.length >= 2 && active.every((p) => table.continueVotes.includes(p.uid))
    if (allVoted) {
      await startHand(tableId, by)
    }
  }
}

function majorityNeeded(totalActivePlayers: number): number {
  return Math.floor(totalActivePlayers / 2) + 1
}

export async function proposeAward(
  tableId: string,
  winnerUids: string[],
  by: string,
): Promise<void> {
  if (winnerUids.length === 0) throw new Error('Select at least one winner')
  const players = await loadPlayers(tableId)
  const total = players.filter((p) => p.status === 'active').length
  const needed = majorityNeeded(total)

  const pendingAward: PendingAward = { winnerUids, proposedBy: by, confirmedBy: [by] }
  await updateDoc(tableRef(tableId), { pendingAward })

  if (pendingAward.confirmedBy.length >= needed) {
    await awardPot(tableId, winnerUids, by)
  }
}

export async function confirmAward(tableId: string, by: string): Promise<void> {
  const tSnap = await getDoc(tableRef(tableId))
  if (!tSnap.exists()) throw new Error('Table not found')
  const table = tSnap.data() as Table
  if (!table.pendingAward) throw new Error('No pending award to confirm')

  const confirmedBy = table.pendingAward.confirmedBy.includes(by)
    ? table.pendingAward.confirmedBy
    : [...table.pendingAward.confirmedBy, by]

  const players = await loadPlayers(tableId)
  const total = players.filter((p) => p.status === 'active').length
  const needed = majorityNeeded(total)

  if (confirmedBy.length >= needed) {
    await awardPot(tableId, table.pendingAward.winnerUids, by)
  } else {
    await updateDoc(tableRef(tableId), {
      'pendingAward.confirmedBy': confirmedBy,
    })
  }
}

export async function cancelAward(tableId: string): Promise<void> {
  await updateDoc(tableRef(tableId), { pendingAward: null })
}

// Host-only removal of a stuck or unwanted player. Mirrors leaveTable's
// ledger/game-over handling but isn't restricted to acting on yourself,
// and folds the target out of any hand they're currently contesting first.
export async function kickPlayer(
  tableId: string,
  targetUid: string,
  hostUid: string,
): Promise<void> {
  const playerIds = await loadPlayerIds(tableId)
  let autoAwardUid: string | null = null
  let gameEnded = false

  await runTransaction(db, async (tx) => {
    const tSnap = await tx.get(tableRef(tableId))
    if (!tSnap.exists()) throw new Error('Table not found')
    const table = tSnap.data() as Table
    if (table.createdBy !== hostUid) throw new Error('Only the host can kick players')

    const freshSnaps = await Promise.all(playerIds.map((id) => tx.get(playerRef(tableId, id))))
    const players = freshSnaps.map((s) => s.data() as Player)
    const player = players.find((p) => p.uid === targetUid)
    if (!player) throw new Error('Player not found')
    if (player.status === 'left') return

    const updates: Record<string, unknown> = { status: 'left' }

    if (table.handInProgress && player.status === 'active' && !player.folded) {
      updates.folded = true
      const simulated = players.map((p) =>
        p.uid === targetUid ? { ...p, folded: true } : p,
      )
      const turn = resolveTurn(simulated, player.seat, table.closerSeat, false)

      if (turn.handDecided) {
        const remaining = simulated.find((p) => p.status === 'active' && !p.folded)
        autoAwardUid = remaining?.uid ?? null
      } else {
        const finalPot =
          turn.actingSeat === null
            ? refundUncalledBet(tx, tableId, simulated, table.pot)
            : table.pot
        tx.update(tableRef(tableId), {
          pot: finalPot,
          actingSeat: turn.actingSeat,
          closerSeat: turn.closerSeat,
        })
      }
    }

    tx.update(playerRef(tableId, targetUid), updates)
    logLedger(tx, tableId, {
      type: 'cash_out',
      uid: targetUid,
      amount: player.stack,
      stackAfter: player.stack,
      potAfter: table.pot,
      by: hostUid,
    })

    const remainingInGame = players.filter(
      (p) => p.uid !== targetUid && p.status !== 'left',
    ).length
    if (remainingInGame <= 1) {
      tx.update(tableRef(tableId), { status: 'ended' })
      gameEnded = true
    }
  })

  if (gameEnded) return

  if (autoAwardUid) {
    await awardPot(tableId, [autoAwardUid], hostUid)
  }
}

// Restores the table and every player to the state captured right before
// the most recently completed hand started. Only available between hands
// (no hand in progress) and only undoes the single most recent hand —
// starting a new hand overwrites the snapshot.
export async function undoLastHand(tableId: string, hostUid: string): Promise<void> {
  await runTransaction(db, async (tx) => {
    const tSnap = await tx.get(tableRef(tableId))
    if (!tSnap.exists()) throw new Error('Table not found')
    const table = tSnap.data() as Table
    if (table.createdBy !== hostUid) throw new Error('Only the host can undo a hand')
    if (table.handInProgress) throw new Error('Finish the current hand first')
    const snapshot = table.lastHandSnapshot
    if (!snapshot) throw new Error('No hand to undo')

    for (const [uid, state] of Object.entries(snapshot.players)) {
      tx.update(playerRef(tableId, uid), { ...state })
    }

    logLedger(tx, tableId, {
      type: 'adjust',
      uid: hostUid,
      amount: 0,
      stackAfter: 0,
      potAfter: snapshot.pot,
      by: hostUid,
    })

    tx.update(tableRef(tableId), {
      pot: snapshot.pot,
      handNumber: snapshot.handNumber,
      buttonSeat: snapshot.buttonSeat,
      currentSmallBlind: snapshot.currentSmallBlind,
      currentBigBlind: snapshot.currentBigBlind,
      street: snapshot.street,
      handInProgress: false,
      actingSeat: null,
      closerSeat: null,
      raiseCount: 0,
      pendingAward: null,
      lastHandSnapshot: null,
    })
  })
}
