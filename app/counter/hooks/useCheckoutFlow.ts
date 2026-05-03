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

    // 2026-05-02 R-LoadTest-Fix7: 짧은 출입 (kick 의심) 감지.
    //   부하 테스트로 발견된 운영 hazard — 호스티스가 12분 미만에 leave 했는데
    //   time_minutes 가 60/90 그대로 박혀있으면 손님이 과다 청구 받음.
    //   카운터 운영자가 미처 kick 처리(time_minutes=0) 못한 케이스 prompt.
    const earlyLeave: { name: string; elapsedMin: number; configuredMin: number; participantId: string }[] = []
    for (const p of focusData.participants) {
      if (p.role !== "hostess") continue
      if (!p.entered_at || !p.time_minutes || p.time_minutes <= 0) continue
      // price_amount > 0 이라야 의미 있음 (이미 0 이면 무료 처리됨)
      if ((p.price_amount ?? 0) <= 0) continue
      const startMs = new Date(p.entered_at).getTime()
      if (!Number.isFinite(startMs)) continue
      const elapsedMin = Math.floor((now - startMs) / 60000)
      // 12분 미만 + 설정 시간 30분+ 이면 의심
      if (elapsedMin < 12 && p.time_minutes >= 30) {
        earlyLeave.push({
          name: (p.external_name || p.name || "스태프").slice(0, 10),
          elapsedMin,
          configuredMin: p.time_minutes,
          participantId: p.id,
        })
      }
    }
    if (earlyLeave.length > 0) {
      const lines = earlyLeave
        .map(o => `  · ${o.name}: ${o.elapsedMin}분 머묾 (${o.configuredMin}분 정산)`)
        .join("\n")
      const proceed = window.confirm(
        "⚠️ 짧은 출입 감지 (Kick 누락 의심)\n\n" +
        `다음 스태프는 12분 미만 머물렀는데 정상 시간 정산입니다:\n${lines}\n\n` +
        "Kick(팅김) 처리 누락이면 손님이 과다 청구됩니다.\n\n" +
        "  [확인] 정상 시간으로 정산 (예: 손님이 동의한 경우)\n" +
        "  [취소] Kick 처리 → 다시 확인",
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
      // 2026-05-01 R-Counter-Speed: settlement + receipt + fetchRooms 모두
      //   체크아웃 직후 독립 작업. 직렬 (settlement → receipt → rooms) 1초+ →
      //   Promise.all 병렬 max(~400ms). settlement/receipt 는 non-blocking.
      const settlementP = apiFetch("/api/sessions/settlement", {
        method: "POST", body: JSON.stringify({ session_id: focusData.sessionId }),
      }).catch(() => null)
      const receiptP = apiFetch("/api/sessions/receipt", {
        method: "POST",
        body: JSON.stringify({ session_id: focusData.sessionId, receipt_type: "final" }),
      }).catch(() => null)
      const fetchRoomsP = fetchRooms().catch(() => null)
      await Promise.all([settlementP, receiptP, fetchRoomsP])
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
