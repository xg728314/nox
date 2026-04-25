"use client"

import { useState } from "react"
import type { Room } from "../../types"
import { fmtWon, fmtTime } from "../../helpers"
import { apiFetch } from "@/lib/apiFetch"
import { captureException } from "@/lib/telemetry/captureException"

type Props = {
  room: Room
  onClickClosed: (sessionId: string) => void
  onReopened?: () => void
}

export default function ClosedRoomCardV2({ room, onClickClosed, onReopened }: Props) {
  const s = room.closed_session
  const [busy, setBusy] = useState(false)
  if (!s) return null

  async function handleReopen(e: React.MouseEvent) {
    e.stopPropagation()
    if (busy) return
    const sessionId = s?.id
    if (!sessionId) return
    const ok = window.confirm(
      "이 세션을 다시 열어서 작업을 이어서 하시겠습니까?\n" +
      "(체크아웃 실수, 연장 요청 등의 경우 사용)\n\n" +
      "정산 확정되었거나 기록 숨김된 세션은 재개 불가합니다.",
    )
    if (!ok) return
    setBusy(true)
    try {
      const res = await apiFetch("/api/sessions/reopen", {
        method: "POST",
        body: JSON.stringify({ session_id: sessionId }),
      })
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { message?: string }
        alert(d.message || "재개 처리 실패")
        return
      }
      if (onReopened) onReopened()
    } catch (err) {
      captureException(err, { tag: "session_reopen", extra: { sessionId } })
      alert("네트워크 오류. 다시 시도해주세요.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      onClick={() => onClickClosed(s.id)}
      className="relative flex flex-col items-center justify-center px-2 py-2 rounded-lg bg-white/[0.02] border border-white/[0.06] hover:bg-white/[0.06] hover:border-white/15 transition-all cursor-pointer group min-h-[56px]"
    >
      {/* 재개 버튼 — 우상단 */}
      <button
        onClick={handleReopen}
        disabled={busy}
        title="세션 재개 (체크아웃 취소)"
        className="absolute top-1 right-1 w-5 h-5 rounded-full bg-amber-500/20 border border-amber-500/30 text-amber-300 text-[11px] flex items-center justify-center hover:bg-amber-500/40 disabled:opacity-40"
      >
        {busy ? "…" : "↶"}
      </button>

      {/* Line 1: Room name + badge */}
      <div className="flex items-center gap-1 mb-0.5">
        <span className="text-[12px] font-bold text-slate-500">
          {room.room_name || room.room_no}
        </span>
        <span className="text-[8px] px-1 py-px rounded bg-slate-500/20 text-slate-500 font-semibold">
          완료
        </span>
      </div>

      {/* Line 2: Amount */}
      <span className="text-[11px] font-semibold text-slate-400">
        {fmtWon(s.gross_total)}
      </span>

      {/* Line 3: End time */}
      {s.ended_at && (
        <span className="text-[9px] text-slate-600 group-hover:text-cyan-400 transition-colors">
          {fmtTime(s.ended_at)}
        </span>
      )}
    </div>
  )
}
