"use client"

/**
 * StateBadge — compact pill displaying a unified WorkerState.
 */

import { STATUS_STYLES, type WorkerState } from "../statusStyles"

type Props = {
  state: WorkerState
  /** Override label (rare — defaults to STATUS_STYLES[state].label). */
  label?: string
  size?: "xs" | "sm"
  withIcon?: boolean
  className?: string
}

export default function StateBadge({ state, label, size = "xs", withIcon = true, className = "" }: Props) {
  const s = STATUS_STYLES[state]
  const sizeCls = size === "sm" ? "text-[11px] px-2 py-0.5" : "text-[10px] px-1.5 py-0.5"
  return (
    <span className={`inline-flex items-center gap-1 rounded-md border font-semibold ${s.chip} ${sizeCls} ${className}`}>
      {withIcon && <span className="leading-none">{s.icon}</span>}
      <span>{label ?? s.label}</span>
    </span>
  )
}
