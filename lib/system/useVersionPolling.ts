/**
 * R-Ver Phase 3: 새 revision 감지용 polling hook.
 *
 * 동작:
 *   - 마운트 시 /api/system/version 1회 fetch (initial)
 *   - 5분마다 polling
 *   - visibilitychange (탭 다시 활성) 시 1회 fetch
 *   - 응답의 revision 이 initial 과 다르면 hasUpdate=true
 *
 * 호출자 (VersionBadge) 가 hasUpdate 를 보고 toast 알림 결정.
 */

"use client"

import { useEffect, useRef, useState } from "react"
import type { SystemVersionInfo } from "@/lib/system/version"

export type UseVersionPollingResult = {
  current: SystemVersionInfo | null
  initialRevision: string | null
  hasUpdate: boolean
  loading: boolean
  refetch: () => void
}

const POLL_INTERVAL_MS = 5 * 60 * 1000

export function useVersionPolling(): UseVersionPollingResult {
  const [current, setCurrent] = useState<SystemVersionInfo | null>(null)
  const [initialRevision, setInitialRevision] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const initialSetRef = useRef(false)

  async function fetchOnce() {
    try {
      const res = await fetch("/api/system/version", { cache: "no-store" })
      if (!res.ok) return
      const data = (await res.json()) as SystemVersionInfo
      setCurrent(data)
      if (!initialSetRef.current) {
        setInitialRevision(data.revision)
        initialSetRef.current = true
      }
    } catch { /* network — 다음 polling 까지 대기 */ }
    finally { setLoading(false) }
  }

  useEffect(() => {
    void fetchOnce()
    const intervalId = setInterval(() => { void fetchOnce() }, POLL_INTERVAL_MS)
    const onVisible = () => {
      if (document.visibilityState === "visible") void fetchOnce()
    }
    document.addEventListener("visibilitychange", onVisible)
    return () => {
      clearInterval(intervalId)
      document.removeEventListener("visibilitychange", onVisible)
    }
  }, [])

  const hasUpdate =
    current != null &&
    initialRevision != null &&
    current.revision !== "local" &&
    initialRevision !== "local" &&
    current.revision !== initialRevision

  return {
    current,
    initialRevision,
    hasUpdate,
    loading,
    refetch: () => void fetchOnce(),
  }
}
