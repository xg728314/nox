"use client"

/**
 * AsOfBadge — explicit "as of HH:mm:ss · stale Ns" indicator.
 *
 * Visualize is read-only and lag-prone. Every page MUST display this
 * badge so operators do not mistake stale state for live state.
 */

import { useEffect, useState } from "react"

type Props = {
  /** ISO8601 string from the API response (`as_of`). */
  asOf: string | null | undefined
  /** Threshold in seconds beyond which the badge turns amber. Default 60. */
  staleAfterSec?: number
  /** Compact mode (badge-only, no "stored sankey" prefix). */
  compact?: boolean
}

function formatTime(date: Date): string {
  const pad = (n: number) => n.toString().padStart(2, "0")
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

export default function AsOfBadge({ asOf, staleAfterSec = 60, compact = false }: Props) {
  const [now, setNow] = useState<number>(() => Date.now())

  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(t)
  }, [])

  if (!asOf) {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded bg-slate-500/10 text-slate-400">
        as of —
      </span>
    )
  }

  const asOfMs = new Date(asOf).getTime()
  const ageSec = Math.max(0, Math.floor((now - asOfMs) / 1000))
  const stale = ageSec >= staleAfterSec
  const label = formatTime(new Date(asOfMs))

  const tone = stale
    ? "bg-amber-500/15 text-amber-300"
    : "bg-emerald-500/10 text-emerald-300"

  return (
    <span className={`inline-flex items-center gap-1.5 text-[11px] px-2 py-0.5 rounded ${tone}`}>
      {!compact && <span className="text-slate-400">stored ·</span>}
      <span>as of {label}</span>
      <span className="text-slate-400">· {ageSec}s</span>
    </span>
  )
}
