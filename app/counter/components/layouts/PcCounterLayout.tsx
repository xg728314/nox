"use client"

import type { ReactNode } from "react"

/**
 * PC layout shell for /counter.
 *
 * Simplified shell — single full-width content column, no right rail.
 * The previous 70/30 split (center + reserved right sidebar) was planned
 * for ad/widget area; that plan is dropped. Content now uses the full
 * viewport width so rooms can expand to 2–6 column grid layouts cleanly.
 *
 * Pure presentational wrapper. Contains zero state, zero handlers, zero API
 * calls — passes `children` through unchanged so the RoomCardV2 prop
 * contract (30+ props generated in CounterPageV2) is not disturbed.
 */
export default function PcCounterLayout({
  children,
}: {
  children: ReactNode
}) {
  return (
    <div className="w-full px-3 py-3 pb-24">
      {children}
    </div>
  )
}
