import { useState } from 'react'
import { computeNetResults, computeSettlements, formatSettlementSummary } from '../lib/payouts'
import type { Player, Table } from '../db/types'

function Results({ table, players }: { table: Table; players: Player[] }) {
  const [copied, setCopied] = useState(false)
  const nets = computeNetResults(players, table.settings.chipToDollar)
    .sort((a, b) => b.netDollars - a.netDollars)
  const settlements = computeSettlements(nets)
  const summary = formatSettlementSummary(table.name, nets, settlements, table.settings.currency)

  async function handleCopy() {
    await navigator.clipboard.writeText(summary)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 px-4 py-10">
      <div className="text-center">
        <p className="text-sm text-gray-500">Table {table.code}</p>
        <h1 className="text-3xl font-semibold text-gray-900">Final Results</h1>
      </div>

      <div className="rounded-md border border-gray-200 bg-white">
        <ul className="divide-y divide-gray-200">
          {nets.map((n) => (
            <li key={n.uid} className="flex items-center justify-between px-4 py-3">
              <span className="font-medium text-gray-900">{n.name}</span>
              <span
                className={`font-semibold ${
                  n.netDollars > 0
                    ? 'text-emerald-600'
                    : n.netDollars < 0
                      ? 'text-red-600'
                      : 'text-gray-500'
                }`}
              >
                {n.netDollars >= 0 ? '+' : ''}
                {n.netDollars.toFixed(2)} {table.settings.currency}
              </span>
            </li>
          ))}
        </ul>
      </div>

      <div className="rounded-md border border-gray-200 bg-white p-4">
        <h2 className="mb-2 text-lg font-semibold text-gray-900">Settle up</h2>
        {settlements.length === 0 ? (
          <p className="text-sm text-gray-500">Everyone is square — no payments needed.</p>
        ) : (
          <ul className="space-y-1 text-sm text-gray-700">
            {settlements.map((s, i) => (
              <li key={i}>
                <span className="font-medium">{s.fromName}</span> pays{' '}
                <span className="font-medium">{s.toName}</span>{' '}
                {s.amountDollars.toFixed(2)} {table.settings.currency}
              </li>
            ))}
          </ul>
        )}
      </div>

      <button
        type="button"
        onClick={handleCopy}
        className="w-full rounded-md bg-indigo-600 px-4 py-3 font-semibold text-white hover:bg-indigo-700"
      >
        {copied ? 'Copied!' : 'Copy summary'}
      </button>
    </div>
  )
}

export default Results
