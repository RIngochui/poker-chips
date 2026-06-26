export type TableStatus = 'lobby' | 'active' | 'ended'

export type Street = 'preflop' | 'flop' | 'turn' | 'river'

export type PlayerStatus = 'active' | 'sitting_out' | 'busted' | 'left'

export type LedgerType =
  | 'buy_in'
  | 'rebuy'
  | 'cash_out'
  | 'blind'
  | 'bet'
  | 'award_pot'
  | 'adjust'

export interface BlindIncrease {
  amount: number // added to the small blind each step; big blind rises 2x this
  everyHands: number // step every N completed hands
}

export interface TableSettings {
  smallBlind: number
  bigBlind: number
  currency: 'CAD'
  chipToDollar: number
  defaultBuyIn: number
  blindIncrease: BlindIncrease | null // null = off (default)
  raiseLimit: number | null // null = No-Limit; otherwise max raises per hand
  handLimit: number | null // null = unlimited; otherwise prompt to continue every N hands
}

export interface PendingAward {
  winnerUids: string[]
  proposedBy: string
  confirmedBy: string[]
}

export interface HandSnapshotPlayer {
  stack: number
  totalBuyIn: number
  committed: number
  folded: boolean
  status: PlayerStatus
}

export interface HandSnapshot {
  players: Record<string, HandSnapshotPlayer>
  pot: number
  handNumber: number
  buttonSeat: number
  currentSmallBlind: number
  currentBigBlind: number
  street: Street
}

export interface Table {
  code: string
  name: string
  status: TableStatus
  createdBy: string
  createdAt: unknown
  settings: TableSettings
  currentSmallBlind: number
  currentBigBlind: number
  buttonSeat: number
  pot: number
  handNumber: number
  handInProgress: boolean
  actingSeat: number | null
  raiseCount: number
  pendingAward: PendingAward | null
  street: Street
  closerSeat: number | null
  continueVotes: string[]
  lastHandSnapshot: HandSnapshot | null
}

export interface Player {
  uid: string
  name: string
  seat: number
  stack: number
  status: PlayerStatus
  totalBuyIn: number
  committed: number
  connected: boolean
  joinedAt: unknown
  folded: boolean
  ready: boolean
}

export interface LedgerEntry {
  type: LedgerType
  uid: string
  amount: number
  stackAfter: number
  potAfter: number
  by: string
  at: unknown
}
