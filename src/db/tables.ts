import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  serverTimestamp,
  setDoc,
  updateDoc,
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
  blindTimer: null,
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
    buttonSeat: 0,
    pot: 0,
    handNumber: 0,
  }

  await setDoc(doc(db, 'tables', code), table)
  await joinTable({ code, uid: opts.createdBy, name: opts.creatorName, seat: 0 })

  return code
}

export async function getTable(code: string): Promise<Table | null> {
  const snap = await getDoc(doc(db, 'tables', code))
  return snap.exists() ? (snap.data() as Table) : null
}

export async function joinTable(opts: {
  code: string
  uid: string
  name: string
  seat: number
}): Promise<void> {
  const player: Player = {
    uid: opts.uid,
    name: opts.name,
    seat: opts.seat,
    stack: 0,
    status: 'active',
    totalBuyIn: 0,
    committed: 0,
    connected: true,
    joinedAt: serverTimestamp(),
  }
  await setDoc(doc(db, 'tables', opts.code, 'players', opts.uid), player)
}

export function nextFreeSeat(players: Player[]): number {
  const taken = new Set(players.map((p) => p.seat))
  let seat = 0
  while (taken.has(seat)) seat++
  return seat
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
): Promise<void> {
  const updates: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(settings)) {
    updates[`settings.${key}`] = value
  }
  await updateDoc(doc(db, 'tables', code), updates)
}

export async function startGame(code: string): Promise<void> {
  await updateDoc(doc(db, 'tables', code), { status: 'active' })
}
