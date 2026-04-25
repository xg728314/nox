"use client"

/**
 * R29: View mode hook — AUTO / PC / MOBILE 토글 + localStorage 영속.
 *   비즈니스 로직 0 — 순수 UI preference. 768px breakpoint 가정.
 */

import { useEffect, useState } from "react"
import { type ViewMode, VIEW_MODE_STORAGE_KEY } from "../types"

export type UseViewModeResult = {
  viewMode: ViewMode
  effectiveMode: "pc" | "mobile"
  applyViewMode: (m: ViewMode) => void
}

export function useViewMode(): UseViewModeResult {
  const [viewMode, setViewMode] = useState<ViewMode>("auto")
  const [autoIsMobile, setAutoIsMobile] = useState<boolean>(false)

  useEffect(() => {
    if (typeof window === "undefined") return
    try {
      const saved = localStorage.getItem(VIEW_MODE_STORAGE_KEY)
      if (saved === "auto" || saved === "pc" || saved === "mobile") {
        setViewMode(saved as ViewMode)
      }
    } catch { /* ignore */ }
    const mq = window.matchMedia("(max-width: 768px)")
    setAutoIsMobile(mq.matches)
    const onMQ = (e: MediaQueryListEvent) => setAutoIsMobile(e.matches)
    if (typeof mq.addEventListener === "function") {
      mq.addEventListener("change", onMQ)
      return () => mq.removeEventListener("change", onMQ)
    } else {
      // Safari <14 fallback
      const legacy = mq as MediaQueryList & {
        addListener?: (cb: (e: MediaQueryListEvent) => void) => void
        removeListener?: (cb: (e: MediaQueryListEvent) => void) => void
      }
      legacy.addListener?.(onMQ)
      return () => legacy.removeListener?.(onMQ)
    }
  }, [])

  const effectiveMode: "pc" | "mobile" =
    viewMode === "auto" ? (autoIsMobile ? "mobile" : "pc") : viewMode

  function applyViewMode(m: ViewMode): void {
    setViewMode(m)
    try { localStorage.setItem(VIEW_MODE_STORAGE_KEY, m) } catch { /* ignore */ }
  }

  return { viewMode, effectiveMode, applyViewMode }
}
