"use client"

import type { ReactNode } from "react"

/**
 * Mobile-preview layout shell for /counter.
 *
 * Renders a single centered column at ~420px so developers working on a PC
 * can see the mobile layout immediately. No horizontal split, no right rail.
 *
 * Pure presentational wrapper. Note: Tailwind responsive utilities (`lg:`
 * etc.) inside child components are viewport-keyed, NOT container-keyed, so
 * this gives a CONTENT-width preview rather than a pixel-perfect device
 * simulation. For exact emulation, use Chrome DevTools' device toolbar in
 * addition to this toggle.
 */
export default function MobileCounterLayout({
  children,
}: {
  children: ReactNode
}) {
  return (
    <div className="max-w-[420px] mx-auto px-3 py-3 pb-24">
      {children}
    </div>
  )
}
