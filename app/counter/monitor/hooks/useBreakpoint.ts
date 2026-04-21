"use client"

/**
 * Breakpoint hook — mobile / tablet / desktop based on window width.
 * SSR-safe: returns "desktop" on the server until the first client-side
 * measurement lands.
 *
 * Thresholds chosen to align with Tailwind defaults and the operator
 * form factors we care about:
 *   - mobile  : < 768px  (phones, portrait)
 *   - tablet  : 768-1279 (iPad, landscape phones, small laptops)
 *   - desktop : ≥ 1280px (standard operator stations)
 */

import { useEffect, useState } from "react"

export type Breakpoint = "mobile" | "tablet" | "desktop"

function compute(width: number): Breakpoint {
  if (width < 768) return "mobile"
  if (width < 1280) return "tablet"
  return "desktop"
}

export function useBreakpoint(): Breakpoint {
  const [bp, setBp] = useState<Breakpoint>("desktop")
  useEffect(() => {
    const update = () => setBp(compute(window.innerWidth))
    update()
    window.addEventListener("resize", update, { passive: true })
    window.addEventListener("orientationchange", update, { passive: true })
    return () => {
      window.removeEventListener("resize", update)
      window.removeEventListener("orientationchange", update)
    }
  }, [])
  return bp
}
