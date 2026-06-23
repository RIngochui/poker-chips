import type { Player } from '../db/types'

export interface PlayerNet {
  uid: string
  name: string
  totalBuyInChips: number
  finalStackChips: number
  netDollars: number
}

export function computeNetResults(players: Player[], chipToDollar: number): PlayerNet[] {
  return players.map((p) => ({
    uid: p.uid,
    name: p.name,
    totalBuyInChips: p.totalBuyIn,
    finalStackChips: p.stack,
    netDollars: Math.round((p.stack - p.totalBuyIn) * chipToDollar * 100) / 100,
  }))
}

export interface Settlement {
  fromName: string
  toName: string
  amountDollars: number
}

// Greedy debt settlement: match the largest creditor against the largest
// debtor repeatedly. Minimizes the number of payments, not optimal in all
// cases but good enough for a home game.
export function computeSettlements(nets: PlayerNet[]): Settlement[] {
  const creditors = nets
    .filter((n) => n.netDollars > 0.005)
    .map((n) => ({ name: n.name, remaining: n.netDollars }))
    .sort((a, b) => b.remaining - a.remaining)
  const debtors = nets
    .filter((n) => n.netDollars < -0.005)
    .map((n) => ({ name: n.name, remaining: -n.netDollars }))
    .sort((a, b) => b.remaining - a.remaining)

  const settlements: Settlement[] = []
  let i = 0
  let j = 0
  while (i < debtors.length && j < creditors.length) {
    const debtor = debtors[i]
    const creditor = creditors[j]
    const amount = Math.min(debtor.remaining, creditor.remaining)

    if (amount > 0.005) {
      settlements.push({
        fromName: debtor.name,
        toName: creditor.name,
        amountDollars: Math.round(amount * 100) / 100,
      })
    }

    debtor.remaining -= amount
    creditor.remaining -= amount
    if (debtor.remaining <= 0.005) i++
    if (creditor.remaining <= 0.005) j++
  }

  return settlements
}

export function formatSettlementSummary(
  tableName: string,
  nets: PlayerNet[],
  settlements: Settlement[],
  currency: string,
): string {
  const lines = [`${tableName} — final results`, '']
  for (const n of nets) {
    const sign = n.netDollars >= 0 ? '+' : ''
    lines.push(`${n.name}: ${sign}${n.netDollars.toFixed(2)} ${currency}`)
  }
  lines.push('')
  if (settlements.length === 0) {
    lines.push('Everyone is square — no payments needed.')
  } else {
    lines.push('Settle up:')
    for (const s of settlements) {
      lines.push(`${s.fromName} pays ${s.toName} ${s.amountDollars.toFixed(2)} ${currency}`)
    }
  }
  return lines.join('\n')
}
