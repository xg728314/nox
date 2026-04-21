"use client"

/**
 * useRetryParticipantAction — shared retry handler.
 *
 * Calls POST /api/session-participant-actions/[action_id]/retry and
 * surfaces status + last error to the UI. After a successful retry
 * callers MUST refetch the section that owns the action list — this
 * hook does NOT mutate any local cache, because apply_status truth
 * lives server-side (MonitorRoomParticipant.latest_apply_*).
 *
 * Single consumer today: ActionPopover's failed-state retry button.
 * Deliberately extracted into a hook so future surfaces (action log
 * panel, notification tray, etc.) don't duplicate the fetch/error
 * handling inline.
 */

import { useCallback, useState } from "react"
import { apiFetch } from "@/lib/apiFetch"

export type RetryState = "idle" | "working" | "ok" | "error"

export type UseRetryParticipantActionResult = {
  state: RetryState
  message: string
  /**
   * Fire a retry for the given action id. Returns true when the server
   * responded 200/201 AND the onAfterRetry callback (if provided) has
   * resolved. Any non-2xx sets state='error' with message; callers
   * should NOT treat this as a successful apply.
   */
  retry: (action_id: string) => Promise<boolean>
  reset: () => void
}

export function useRetryParticipantAction(opts: {
  /**
   * Called after a non-error response. Typical use: refresh the monitor
   * data source so the badge re-renders from server truth. Must be
   * awaitable so the hook's state transitions reflect the true UI-
   * observable moment the badge changes.
   */
  onAfterRetry?: () => void | Promise<void>
}): UseRetryParticipantActionResult {
  const [state, setState] = useState<RetryState>("idle")
  const [message, setMessage] = useState<string>("")

  const retry = useCallback(async (action_id: string): Promise<boolean> => {
    if (!action_id) {
      setState("error")
      setMessage("action_id 가 없습니다.")
      return false
    }
    setState("working")
    setMessage("")
    try {
      const r = await apiFetch(
        `/api/session-participant-actions/${encodeURIComponent(action_id)}/retry`,
        { method: "POST", body: JSON.stringify({}) },
      )
      const body = (await r.json().catch(() => ({}))) as {
        ok?: boolean
        error?: string
        message?: string
        failure_code?: string
        failure_message?: string
        apply_status?: "pending" | "success" | "failed"
      }
      if (!r.ok || body.ok === false) {
        setState("error")
        setMessage(
          body.failure_message ??
          body.message ??
          body.error ??
          `재시도 실패 (${r.status})`,
        )
        // Even on logical failure the server has written the failed
        // apply row — refresh so the badge reflects that truth.
        if (opts.onAfterRetry) await opts.onAfterRetry()
        return false
      }
      setState("ok")
      setMessage(
        body.apply_status === "success" ? "재시도 완료 — 반영됨." :
        body.apply_status === "pending" ? "재시도 접수됨 — 서버에서 처리 중." :
        "재시도 완료.",
      )
      if (opts.onAfterRetry) await opts.onAfterRetry()
      return true
    } catch (e) {
      setState("error")
      setMessage(e instanceof Error ? e.message : "네트워크 오류")
      return false
    }
  }, [opts])

  const reset = useCallback(() => {
    setState("idle")
    setMessage("")
  }, [])

  return { state, message, retry, reset }
}
