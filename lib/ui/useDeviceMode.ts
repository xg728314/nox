"use client"

/**
 * useDeviceMode — hard cutoff at 960px.
 *
 * Priority (earlier wins):
 *   1. URL query override  (?device=ops|mobile  or  ?force=ops|mobile)
 *   2. localStorage         ("nox.device_mode" = "ops" | "mobile")
 *   3. Viewport width       (>= 960 → ops, < 960 → mobile)
 *   4. SSR UA hint (first paint): Mobile UA string → "mobile", else "ops"
 *
 * This hook is DOM-only (no data fetching). Page-level routing (the
 * `/monitor` device router — Phase 6) does the server-side redirect
 * based on UA; this hook handles the client-side final decision.
 */

import { useEffect, useState } from "react"

export type DeviceMode = "ops" | "mobile"

const CUTOFF = 960
const STORAGE_KEY = "nox.device_mode"

function readQueryOverride(): DeviceMode | null {
  if (typeof window === "undefined") return null
  try {
    const p = new URLSearchParams(window.location.search)
    const v = (p.get("device") ?? p.get("force") ?? "").toLowerCase()
    return v === "ops" || v === "mobile" ? (v as DeviceMode) : null
  } catch {
    return null
  }
}

function readStorageOverride(): DeviceMode | null {
  try {
    const v = typeof window !== "undefined" ? window.localStorage.getItem(STORAGE_KEY) : null
    return v === "ops" || v === "mobile" ? v : null
  } catch { return null }
}

function readViewportMode(): DeviceMode {
  if (typeof window === "undefined") return "ops"
  return window.innerWidth >= CUTOFF ? "ops" : "mobile"
}

/** Client-side resolver. `ssrDefault` sets the first-paint value to
 *  avoid hydration flash when a server-side hint is available. */
export function useDeviceMode(ssrDefault: DeviceMode = "ops"): DeviceMode {
  const [mode, setMode] = useState<DeviceMode>(ssrDefault)

  useEffect(() => {
    const resolve = (): DeviceMode => {
      return readQueryOverride()
        ?? readStorageOverride()
        ?? readViewportMode()
    }
    setMode(resolve())
    // Re-evaluate on viewport resize only if no explicit override is set.
    const onResize = () => {
      if (readQueryOverride()) return
      if (readStorageOverride()) return
      setMode(readViewportMode())
    }
    window.addEventListener("resize", onResize)
    return () => window.removeEventListener("resize", onResize)
  }, [])

  return mode
}

/** Imperative setter that persists to localStorage. Used by tree banners
 *  ("모바일 뷰 권장 — 이동" 버튼 등). */
export function setDeviceModePreference(mode: DeviceMode): void {
  try { window.localStorage.setItem(STORAGE_KEY, mode) } catch {}
}

/** Clear the stored preference — the hook falls back to viewport width. */
export function clearDeviceModePreference(): void {
  try { window.localStorage.removeItem(STORAGE_KEY) } catch {}
}

export const DEVICE_MODE_CUTOFF_PX = CUTOFF
