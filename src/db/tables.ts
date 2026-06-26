import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
  type Unsubscribe,
} from 'firebase/firestore'
import { db } from './firebase'
import type { Player, Table, TableSettings } from './types'

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

function randomCode(length = 4): string {
  let code = ''
  for (let i = 0; i < length; i++) {
    code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]
  }
  return code
}

export const defaultSettings: TableSettings = {
  smallBlind: 1,
  bigBlind: 2,
  currency: 'CAD',
  chipToDollar: 1,
  defaultBuyIn: 200,
  blindIncrease: null,
  raiseLimit: null,
  handLimit: 10,
}

export function validateSettings(s: TableSettings): string | null {
  if (!(s.smallBlind > 0)) return 'Small blind must be greater than 0'
  if (!(s.bigBlind > s.smallBlind)) return 'Big blind must be greater than small blind'
  if (!(s.chipToDollar > 0) || !Number.isFinite(s.chipToDollar)) {
    return 'Chip to dollar rate must be a valid positive amount'
  }
  if (!(s.defaultBuyIn > 0)) return 'Default buy-in must be greater than 0'
  if (s.handLimit !== null && !(s.handLimit > 0)) {
    return 'Hand limit must be greater than 0'
  }
  if (s.raiseLimit !== null && !(s.raiseLimit > 0)) {
    return 'Max raises per hand must be greater than 0'
  }
  if (s.blindIncrease !== null) {
    if (!(s.blindIncrease.amount > 0)) {
      return 'Blind increase amount must be greater than 0'
    }
    if (!(s.blindIncrease.everyHands > 0)) {
      return 'Hands between blind increases must be greater than 0'
    }
    if (s.handLimit !== null && !(s.blindIncrease.everyHands < s.handLimit)) {
      return 'Hands between blind increases must be less than the hand limit'
    }
  }
  return null
}

export async function createTable(opts: {
  name: string
  createdBy: string
  creatorName: string
}): Promise<string> {
  let code = randomCode()
  // Extremely unlikely to collide, but guard anyway.
  for (let attempt = 0; attempt < 5; attempt++) {
    const existing = await getDoc(doc(db, 'tables', code))
    if (!existing.exists()) break
    code = randomCode()
  }

  const table: Table = {
    code,
    name: opts.name,
    status: 'lobby',
    createdBy: opts.createdBy,
    createdAt: serverTimestamp(),
    settings: { ...defaultSettings },
    currentSmallBlind: defaultSettings.smallBlind,
    currentBigBlind: defaultSettings.bigBlind,
    buttonSeat: 0,
    pot: 0,
    handNumber: 0,
    handInProgress: false,
    actingSeat: null,
    raiseCount: 0,
    pendingAward: null,
    street: 'preflop',
    closerSeat: null,
    continueVotes: [],
    lastHandSnapshot: null,
  }

  await setDoc(doc(db, 'tables', code), table)
  await joinTable({ code, uid: opts.createdBy, name: opts.creatorName })

  return code
}

export async function getTable(code: string): Promise<Table | null> {
  const snap = await getDoc(doc(db, 'tables', code))
  return snap.exists() ? (snap.data() as Table) : null
}

// Seat numbers must be unique. Picking "the next free seat" by reading the
// player list and writing a plain doc is a classic check-then-act race —
// two people joining at the same moment can both compute the same free
// seat before either's join has landed, producing two players who share a
// seat (and therefore identical button/blind/turn badges). Each candidate
// seat is claimed atomically via a transaction on a dedicated seatClaims
// doc: only one of two simultaneous claims for the same seat can win, so
// the loser retries the next seat instead.
export async function joinTable(opts: {
  code: string
  uid: string
  name: string
}): Promise<void> {
  const playerDocRef = doc(db, 'tables', opts.code, 'players', opts.uid)
  if ((await getDoc(playerDocRef)).exists()) return // already joined

  const playersSnap = await getDocs(collection(db, 'tables', opts.code, 'players'))
  const maxSeat = playersSnap.docs.reduce(
    (max, d) => Math.max(max, (d.data() as Player).seat),
    -1,
  )

  for (let seat = maxSeat + 1; seat <= maxSeat + 50; seat++) {
    const claimRef = doc(db, 'tables', opts.code, 'seatClaims', String(seat))
    try {
      await runTransaction(db, async (tx) => {
        const claimSnap = await tx.get(claimRef)
        if (claimSnap.exists()) throw new Error('seat-taken')

        const player: Player = {
          uid: opts.uid,
          name: opts.name,
          seat,
          stack: 0,
          status: 'active',
          totalBuyIn: 0,
          committed: 0,
          connected: true,
          joinedAt: serverTimestamp(),
          folded: false,
          ready: false,
        }
        tx.set(claimRef, { uid: opts.uid })
        tx.set(playerDocRef, player)
      })
      return
    } catch (err) {
      if ((err as Error).message !== 'seat-taken') throw err
    }
  }
  throw new Error('Table is full')
}

export async function setPlayerReady(
  code: string,
  uid: string,
  ready: boolean,
): Promise<void> {
  await updateDoc(doc(db, 'tables', code, 'players', uid), { ready })
}

export function subscribeToTable(
  code: string,
  callback: (table: Table | null) => void,
): Unsubscribe {
  return onSnapshot(doc(db, 'tables', code), (snap) => {
    callback(snap.exists() ? (snap.data() as Table) : null)
  })
}

export function subscribeToPlayers(
  code: string,
  callback: (players: Player[]) => void,
): Unsubscribe {
  return onSnapshot(collection(db, 'tables', code, 'players'), (snap) => {
    callback(snap.docs.map((d) => d.data() as Player))
  })
}

export async function updateTableSettings(
  code: string,
  settings: Partial<TableSettings>,
  by: string,
): Promise<void> {
  const table = await getTable(code)
  if (!table) throw new Error('Table not found')
  if (table.createdBy !== by) throw new Error('Only the host can change settings')

  const merged: TableSettings = { ...table.settings, ...settings }
  const error = validateSettings(merged)
  if (error) throw new Error(error)

  const updates: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(settings)) {
    updates[`settings.${key}`] = value
  }
  await updateDoc(doc(db, 'tables', code), updates)
}

export async function startGame(code: string, by: string): Promise<void> {
  const table = await getTable(code)
  if (!table) throw new Error('Table not found')

  const playersSnap = await getDocs(collection(db, 'tables', code, 'players'))
  const players = playersSnap.docs.map((d) => d.data() as Player)

  const batch = writeBatch(db)
  for (const p of players) {
    const buyIn = table.settings.defaultBuyIn
    batch.update(doc(db, 'tables', code, 'players', p.uid), {
      stack: p.stack + buyIn,
      totalBuyIn: p.totalBuyIn + buyIn,
    })
    const ledgerRef = doc(collection(db, 'tables', code, 'ledger'))
    batch.set(ledgerRef, {
      type: 'buy_in',
      uid: p.uid,
      amount: buyIn,
      stackAfter: p.stack + buyIn,
      potAfter: table.pot,
      by,
      at: serverTimestamp(),
    })
  }
  batch.update(doc(db, 'tables', code), {
    status: 'active',
    currentSmallBlind: table.settings.smallBlind,
    currentBigBlind: table.settings.bigBlind,
  })

  await batch.commit()
}
