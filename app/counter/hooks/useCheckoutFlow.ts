"use client"

import { useRef, useState, type Dispatch, type SetStateAction } from "react"
import { useRouter } from "next/navigation"
import { apiFetch } from "@/lib/apiFetch"
import { getServerNow } from "@/lib/time/serverClock"
import type { FocusData } from "../types"

/**
 * useCheckoutFlow — owns checkout + interim-receipt + closed-room receipt flow
 * extracted verbatim from CounterPageV2, plus the swipe-to-checkout pointer
 * state that only drives handleCheckout.
 *
 * Dependencies injected via a single `deps` object so the page stays the one
 * place that wires state setters and fetchers.
 */

type Deps = {
  focusData: FocusData | null
  fetchRooms: () => Promise<void>
  exitFocus: () => void
  setBusy: Dispatch<SetStateAction<boolean>>
  setError: Dispatch<SetStateAction<string>>
}

type UseCheckoutFlowReturn = {
  // Interim modal
  interimModalOpen: boolean
  setInterimModalOpen: Dispatch<SetStateAction<boolean>>
  handleInterimReceipt: () => void
  createInterimReceipt: (mode: "elapsed" | "half_ticket") => Promise<void>

  // Final checkout
  handleCheckout: () => Promise<void>

  // Closed-room reprint navigation
  handleClosedRoomClick: (sessionId: string) => Promise<void>

  // Swipe-to-checkout state + pointer handlers
  swipeX: number
  onSwipeStart: (e: React.PointerEvent) => void
  onSwipeMove: (e: React.PointerEvent) => void
  onSwipeEnd: () => void
}

export function useCheckoutFlow(deps: Deps): UseCheckoutFlowReturn {
  const router = useRouter()

  const [interimModalOpen, setInterimModalOpen] = useState(false)
  const [swipeX, setSwipeX] = useState(0)
  const swipeRef = useRef<number | null>(null)

  async function handleCheckout() {
    const { focusData, fetchRooms, exitFocus, setBusy, setError } = deps
    if (!focusData) return
    // Pre-check: 미확정 참여자가 있으면 API 호출 전 차단
    const unresolved = focusData.participants.filter(p =>
      p.role === "hostess" && p.status === "active" &&
      (!p.category || !p.time_minutes)
    )
    if (unresolved.length > 0) {
      setError(`스태프 ${unresolved.length}명의 종목을 확정한 후 체크아웃하세요.`)
      return
    }

    // 2026-04-25: 연장 누락 감지. time_minutes 초과해서 일한 참여자 있으면
    //   체크아웃 전에 경고 → 연장 처리 유도. 5분 이상 초과만 경고
    //   (1~4분은 자연스러운 마감 시간 오차로 간주).
    // 2026-04-30 R-Counter-Clock: getServerNow() 로 client clock 보정.
    //   카운터 PC 시계 어긋남으로 잘못된 초과 경고 / 연장 누락 방지.
    const now = getServerNow()
    const overtime: { name: string; overMin: number; participantId: string }[] = []
    for (const p of focusData.participants) {
      if (p.role !== "hostess" || p.status !== "active") continue
      if (!p.entered_at || !p.time_minutes || p.time_minutes <= 0) continue
      const startMs = new Date(p.entered_at).getTime()
      if (!Number.isFinite(startMs)) continue
      const end = startMs + p.time_minutes * 60000
      const overMs = now - end
      if (overMs > 5 * 60000) {
        overtime.push({
          name: (p.external_name || p.name || "스태프").slice(0, 10),
          overMin: Math.ceil(overMs / 60000),
          participantId: p.id,
        })
      }
    }
    if (overtime.length > 0) {
      const lines = overtime
        .map(o => `  · ${o.name}: +${o.overMin}분 초과`)
        .join("\n")
      const proceed = window.confirm(
        "⚠️ 연장 처리 누락 경고\n\n" +
        `다음 스태프는 약속 시간을 초과했는데 연장 처리가 안 됐습니다:\n${lines}\n\n` +
        "초과분이 매출에 반영되지 않습니다.\n\n" +
        "  [확인] 그대로 체크아웃 (초과분 포기)\n" +
        "  [취소] 다시 확인 후 연장 처리 → 재시도",
      )
      if (!proceed) return
    }

    if (!confirm("체크아웃 하시겠습니까?")) return
    setBusy(true); setError("")
    try {
      const res = await apiFetch("/api/sessions/checkout", {
        method: "POST", body: JSON.stringify({ session_id: focusData.sessionId }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.message || "체크아웃 실패"); return }
      try {
        await apiFetch("/api/sessions/settlement", {
          method: "POST", body: JSON.stringify({ session_id: focusData.sessionId }),
        })
      } catch { /* settlement fail is non-blocking */ }
      // Generate final receipt snapshot (non-blocking)
      try {
        await apiFetch("/api/sessions/receipt", {
          method: "POST",
          body: JSON.stringify({ session_id: focusData.sessionId, receipt_type: "final" }),
        })
      } catch { /* final receipt fail is non-blocking */ }
      await fetchRooms()
      exitFocus()
    } catch { setError("요청 오류") }
    finally { setBusy(false) }
  }

  function handleInterimReceipt() {
    // Clear any stale error so the modal isn't obscured by leftover UI.
    deps.setError("")
    // Previous behavior silently no-op'd when focusData was null — that's
    // what produced the "계산 click does nothing, only /counter 200 in
    // Network" symptom: if focusData was momentarily stale (mid-poll) or
    // had been cleared by an outer click that bubbled from the button,
    // the early-return prevented the modal from ever opening.
    //
    // New behavior: ALWAYS open the interim-mode modal. If focusData is
    // still missing when the modal tries to render, the modal itself
    // surfaces an explicit "focus this room first" affordance via its
    // existing `!focusData → null` guard (which is also being relaxed
    // below so the operator sees a clear message instead of a blank
    // screen). Settlement/receipt POST itself still requires focusData
    // — that's gated later in createInterimReceipt which already has a
    // proper `if (!focusData) return` check.
    if (!deps.focusData) {
      // Surface a soft message instead of silently no-op'ing. Operator
      // can then tap the room header to re-focus and try again.
      deps.setError("방 정보가 없습니다. 방을 다시 선택한 후 다시 시도해주세요.")
      return
    }
    setInterimModalOpen(true)
  }

  async function createInterimReceipt(mode: "elapsed" | "half_ticket") {
    const { focusData, setBusy, setError } = deps
    if (!focusData) return
    setInterimModalOpen(false)
    setBusy(true); setError("")
    try {
      const res = await apiFetch("/api/sessions/receipt", {
        method: "POST",
        body: JSON.stringify({
          session_id: focusData.sessionId,
          receipt_type: "interim",
          calc_mode: mode,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        const detail = data.db_code ? ` (${data.db_code})` : ""
        setError((data.message || "중간계산서 생성 실패") + detail)
        return
      }
      if (data.snapshot_id) {
        router.push(`/receipt/${data.snapshot_id}`)
      }
    } catch { setError("요청 오류") }
    finally { setBusy(false) }
  }

  async function handleClosedRoomClick(sessionId: string) {
    const { setError } = deps
    try {
      const res = await apiFetch(`/api/sessions/receipt?session_id=${sessionId}`)
      if (res.ok) {
        const data = await res.json()
        const snapshots = data.snapshots ?? []
        // Find final receipt first, then any receipt
        const finalSnap = snapshots.find((s: { receipt_type: string }) => s.receipt_type === "final")
        const snap = finalSnap || snapshots[0]
        if (snap) {
          router.push(`/receipt/${snap.id}`)
          return
        }
      }
    } catch { /* fallback below */ }
    // No receipt found — show error
    setError("해당 세션의 계산서를 찾을 수 없습니다.")
  }

  function onSwipeStart(e: React.PointerEvent) { swipeRef.current = e.clientX }
  function onSwipeMove(e: React.PointerEvent) {
    if (swipeRef.current === null) return
    setSwipeX(Math.max(0, e.clientX - swipeRef.current))
  }
  function onSwipeEnd() {
    if (swipeX > 200) handleCheckout()
    swipeRef.current = null
    setSwipeX(0)
  }

  return {
    interimModalOpen, setInterimModalOpen,
    handleInterimReceipt, createInterimReceipt,
    handleCheckout,
    handleClosedRoomClick,
    swipeX, onSwipeStart, onSwipeMove, onSwipeEnd,
  }
}
