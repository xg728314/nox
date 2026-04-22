"use client"

import { useEffect } from "react"
import { perfLog, perfNow } from "./perfLog"

/**
 * usePagePerf — emit page mount + nav timing metrics once per mount.
 *
 * Emits:
 *   - page:<name>:mount                   (t_ms: perfNow rounded)
 *   - page:<name>:nav.ttfb                (responseStart)
 *   - page:<name>:nav.dom.contentloaded   (domContentLoadedEventEnd, if >0)
 *   - page:<name>:nav.load                (loadEventEnd, if >0)
 *   - page:<name>:nav.load.after          (one-time listener when load=0)
 */
export function usePagePerf(name: string): void {
  useEffect(() => {
    perfLog(`page:${name}:mount`, { t_ms: Math.round(perfNow()) })

    if (typeof window === "undefined") return
    if (typeof performance === "undefined" || typeof performance.getEntriesByType !== "function") return

    let loadListener: (() => void) | null = null
    try {
      const entries = performance.getEntriesByType("navigation")
      const nav = entries && entries.length > 0 ? (entries[0] as PerformanceNavigationTiming) : null
      if (nav) {
        perfLog(`page:${name}:nav.ttfb`, { t_ms: Math.round(nav.responseStart) })
        if (nav.domContentLoadedEventEnd > 0) {
          perfLog(`page:${name}:nav.dom.contentloaded`, { t_ms: Math.round(nav.domContentLoadedEventEnd) })
        }
        if (nav.loadEventEnd > 0) {
          perfLog(`page:${name}:nav.load`, { t_ms: Math.round(nav.loadEventEnd) })
        } else {
          loadListener = () => {
            try {
              const after = performance.getEntriesByType("navigation")
              const navAfter = after && after.length > 0 ? (after[0] as PerformanceNavigationTiming) : null
              if (navAfter) {
                perfLog(`page:${name}:nav.load.after`, { t_ms: Math.round(navAfter.loadEventEnd) })
              }
            } catch { /* ignore */ }
          }
          window.addEventListener("load", loadListener, { once: true })
        }
      }
    } catch { /* ignore */ }

    return () => {
      if (loadListener) {
        try { window.removeEventListener("load", loadListener) } catch { /* ignore */ }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name])
}
