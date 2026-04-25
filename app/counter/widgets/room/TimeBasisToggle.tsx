"use client"

/**
 * TimeBasisToggle — Phase A scaffold.
 * visibility: active_expanded.
 * 원본: RoomCardV2 L499-524. 시간 기준 토글 + 채팅 진입 + 연장 버튼.
 *
 * ⚠️ 2026-04-24: 채팅 버튼은 과거 `/chat?room=${room.id}` 로 바로 이동해
 *   global 리스트를 열고 room_uuid 쿼리만 붙였다. 이는 잘못된 경로:
 *     - chat key 는 chat_rooms.id (session_id 기반으로 서버가 생성).
 *     - `room_uuid` 는 chat 측 식별자가 아님.
 *     - 결과: 사용자가 global 채팅 목록만 보고 방 전용 채팅에 못 들어감.
 *   수정:
 *     1) room.session.id 가 있으면 `POST /api/chat/rooms {type:"room_session",
 *        session_id}` 호출 → 서버가 기존 재사용 또는 신규 생성.
 *     2) 응답 chat_room_id 로 `/chat/{id}` 네비게이션.
 *     3) 세션 없음 / POST 실패 시 `/chat` 리스트 fallback.
 */

import { useState } from "react"
import { apiFetch } from "@/lib/apiFetch"
import { useRoomContext } from "../RoomContext"
import CreditRegisterModal from "./CreditRegisterModal"

export default function TimeBasisToggle() {
  const {
    room, basis, busy, hostesses,
    extendOpen, setExtendOpen,
    creditModalOpen, setCreditModalOpen,
    grandTotal,
    onSetBasis, onNavigate,
  } = useRoomContext()

  const [chatBusy, setChatBusy] = useState(false)

  const canExtend = hostesses.filter(h => h.status === "active" && h.category && h.time_minutes > 0).length > 0

  async function openRoomChat() {
    if (chatBusy) return
    const sid = room.session?.id ?? null
    if (!sid) {
      // active session 없음 → room_session chat 생성 불가. 리스트로 fallback.
      onNavigate("/chat")
      return
    }
    setChatBusy(true)
    try {
      const res = await apiFetch("/api/chat/rooms", {
        method: "POST",
        body: JSON.stringify({ type: "room_session", session_id: sid }),
      })
      const d = (await res.json().catch(() => ({}))) as {
        chat_room_id?: string
        error?: string
        message?: string
      }
      if (!res.ok || !d.chat_room_id) {
        // 실패 시 사용자 막다른 느낌 회피 — /chat 리스트로 이동.
        //   상세 에러는 콘솔에만. (TimeBasisToggle 은 자체 error UI 없음.)
        // eslint-disable-next-line no-console
        console.warn(
          `[room chat] create failed: ${res.status} ${d.error ?? ""} ${d.message ?? ""}`,
        )
        onNavigate("/chat")
        return
      }
      onNavigate(`/chat/${d.chat_room_id}`)
    } catch {
      onNavigate("/chat")
    } finally {
      setChatBusy(false)
    }
  }

  return (
    <div className="flex items-center justify-between px-4 py-1.5 border-b border-white/10 text-xs">
      <div className="flex items-center gap-2">
        <span className="text-slate-500">시간</span>
        <div className="flex gap-1">
          <button onClick={() => onSetBasis(room.id, "room")} className={`px-2.5 py-0.5 rounded-md ${basis === "room" ? "bg-cyan-500/20 text-cyan-300" : "bg-white/5 text-slate-400"}`}>방</button>
          <button onClick={() => onSetBasis(room.id, "individual")} className={`px-2.5 py-0.5 rounded-md ${basis === "individual" ? "bg-cyan-500/20 text-cyan-300" : "bg-white/5 text-slate-400"}`}>개별</button>
        </div>
      </div>
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={openRoomChat}
          disabled={chatBusy}
          title={
            room.session?.id
              ? "룸 채팅 열기 (room_session)"
              : "진행 중 세션 없음 — 채팅 목록으로 이동"
          }
          className="px-2 py-1 rounded-lg bg-cyan-500/15 text-cyan-300 border border-cyan-500/25 hover:bg-cyan-500/25 disabled:opacity-50 disabled:cursor-wait"
        >
          💬
        </button>
        {/* 2026-04-25: 외상 버튼 — 클릭 시 CreditRegisterModal 열림.
            손님 DB 등록 + credits 레코드 생성을 한 번에 처리. */}
        <button
          type="button"
          onClick={() => setCreditModalOpen(true)}
          disabled={busy || !room.session?.id}
          title={
            room.session?.id
              ? "외상 등록 (손님 DB + 외상 기록 동시 저장)"
              : "진행 중 세션 없음 — 체크인 먼저 필요"
          }
          className="px-3 py-1 rounded-lg text-xs font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed bg-amber-500/15 text-amber-300 border border-amber-500/25 hover:bg-amber-500/25"
        >
          외상
        </button>
        <button
          onClick={() => setExtendOpen(v => !v)}
          disabled={busy || !canExtend}
          className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
            extendOpen
              ? "bg-cyan-500/30 text-cyan-200 border border-cyan-500/40"
              : "bg-cyan-500/15 text-cyan-300 border border-cyan-500/25 hover:bg-cyan-500/25"
          }`}
        >
          {extendOpen ? "연장 닫기" : "연장"}
        </button>
      </div>

      <CreditRegisterModal
        open={creditModalOpen}
        onClose={() => setCreditModalOpen(false)}
        roomUuid={room.id}
        sessionId={room.session?.id ?? null}
        managerMembershipId={room.session?.manager_membership_id ?? null}
        defaultAmount={grandTotal}
        initialCustomerName={room.session?.customer_name_snapshot ?? ""}
      />
    </div>
  )
}
