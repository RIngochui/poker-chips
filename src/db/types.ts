export type TableStatus = 'lobby' | 'active' | 'ended'

export type PlayerStatus = 'active' | 'sitting_out' | 'busted' | 'left'

export type LedgerType =
  | 'buy_in'
  | 'rebuy'
  | 'cash_out'
  | 'blind'
  | 'bet'
  | 'award_pot'
  | 'adjust'

export interface BlindLevel {
  sb: number
  bb: number
  minutes: number
}

export interface BlindTimer {
  levels: BlindLevel[]
  startedAt: number
  levelIndex: number
}

export interface TableSettings {
  smallBlind: number
  bigBlind: number
  currency: 'CAD'
  chipToDollar: number
  defaultBuyIn: number
  blindTimer: BlindTimer | null
}

export interface Table {
  code: string
  name: string
  status: TableStatus
  createdBy: string
  createdAt: unknown
  settings: TableSettings
  buttonSeat: number
  pot: number
  handNumber: number
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
