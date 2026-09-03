"use client"
/**
 * MergeHostessSheet — 동명이인 hostess 병합.
 *
 * R-hostess-merge (2026-09-04): 실수로 만들어진 duplicate 통합.
 *
 * flow:
 *   1. 대상 hostess (this) 의 이름 + 매장 → 같은 매장 · 같은 이름의 다른 hostess 목록 조회
 *   2. 각 후보에 오늘 세션 수 · 총 매출 등 안내
 *   3. 후보 선택 → confirm (irreversible 안내) → POST /api/hostesses/merge
 *   4. 성공 시 invalidate + close
 *
 * 주의: 이 병합은 되돌릴 수 없음. UI 에 명시.
 */
import { useEffect, useMemo, useState } from "react"
import { Sheet } from "./Sheet"
import { useToast, haptic } from "./Toast"
import { invalidateApi } from "../_hooks/useApi"
import { apiFetch } from "@/lib/apiFetch"
import { cn } from "../_lib/cn"

/** 같은 방 참여자 후보 (caller 가 dedup/필터 · MergeHostessSheet 는 표시만) */
export type MergeCandidate = {
  membership_id: string
  hostess_name: string
  manager_name?: string | null
  /** 참고 정보 · UI 표시 */
  hint?: string
}

export function MergeHostessSheet({
  open,
  onClose,
  fromMembershipId,
  fromName,
  storeUuid,
  fromParticipantId,
  candidates,
}: {
  open: boolean
  onClose: () => void
  fromMembershipId: string
  fromName: string
  storeUuid: string
  fromParticipantId?: string   // 참고 · UI 표시용
  /** R-scope-same-room (2026-09-04): 후보는 caller (LiveRoomCard) 가 좁혀서 넘김 —
   *  같은 방 참여자 중 같은 이름 · from 아닌 것. 매장 전체 노출 X. */
  candidates: MergeCandidate[]
}) {
  const toast = useToast()
  const [pickedTo, setPickedTo] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirmed, setConfirmed] = useState(false)  // 명시적 confirm 체크

  useEffect(() => {
    if (open) { setPickedTo(null); setConfirmed(false) }
  }, [open])

  // 후보는 이미 caller 가 좁힘 · 필터 재실행 안 함
  const _candidates = candidates
  void useMemo(() => storeUuid, [storeUuid])  // storeUuid unused warning 회피

  const pickedName = pickedTo ? _candidates.find((c) => c.membership_id === pickedTo)?.hostess_name : null

  async function merge() {
    if (busy || !pickedTo || !confirmed) return
    setBusy(true)
    haptic([10, 30, 10])
    try {
      const res = await apiFetch("/api/hostesses/merge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          from_membership_id: fromMembershipId,
          to_membership_id: pickedTo,
        }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j?.message ?? j?.error ?? `HTTP ${res.status}`)
      toast(
        `병합 완료 · 세션 ${j.moved_participants}건 · 이적 ${j.moved_transfers}건 이관`,
        "success",
      )
      invalidateApi("/api/rooms")
      invalidateApi("/api/building/rooms")
      invalidateApi("/api/building/hostesses")
      invalidateApi("/api/manager/hostesses")
      invalidateApi("/api/manager/incoming-staff")
      onClose()
    } catch (e) {
      toast(`병합 실패: ${(e as Error).message}`, "error")
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet open={open} onClose={onClose}>
      <div className="px-5 pb-4 pt-2">
        <div className="mb-3 rounded-2xl bg-amber-50 border border-amber-200 px-4 py-3">
          <div className="text-[10px] font-extrabold text-amber-700 uppercase tracking-widest">
            아가씨 병합 · 되돌릴 수 없음
          </div>
          <div className="mt-1 text-[13px] font-extrabold text-amber-800">
            {fromName}
          </div>
          <div className="mt-1 text-[10px] font-bold text-amber-700/80 leading-relaxed">
            같은 방 안의 같은 이름 (동명이인) 만 후보.
            <br />세션 · 이적 · 채팅 이력 통합 → 이 아가씨는 사라짐.
            <br />⚠ 서로 다른 사람이면 절대 병합 X · 확인 필수.
          </div>
        </div>

        {_candidates.length === 0 && (
          <div className="rounded-2xl border border-dashed border-[#D8D2C8] bg-[#FAF5EC]/60 px-4 py-8 text-center">
            <div className="text-[12px] font-bold text-[#7A746A]">이 방에 「{fromName}」 동명이인 없음</div>
            <div className="mt-1 text-[10px] text-[#7A746A]/70 leading-relaxed">
              같은 방 안의 같은 이름 참여자만 병합 후보.
              <br />매장 전체 병합은 안전 상 지원 X.
            </div>
          </div>
        )}

        <div className="space-y-2 mb-3 max-h-[40vh] overflow-y-auto">
          {_candidates.map((c) => {
            const isPicked = pickedTo === c.membership_id
            return (
              <button
                key={c.membership_id}
                type="button"
                disabled={busy}
                onClick={() => { setPickedTo(c.membership_id); setConfirmed(false) }}
                className={cn(
                  "w-full text-left rounded-xl border-2 px-3 py-2.5 transition-all",
                  isPicked
                    ? "border-amber-500 bg-amber-100"
                    : "border-[#D8D2C8] bg-white active:bg-[#FAF5EC]",
                  busy && "opacity-40 cursor-wait",
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-extrabold text-[#2D2B26] truncate">
                      {c.hostess_name}
                      <span className="ml-1.5 text-[9px] font-bold text-[#7A746A]">
                        · mid {c.membership_id.slice(0, 8)}
                      </span>
                    </div>
                    <div className="text-[10px] font-semibold text-[#7A746A] mt-0.5 truncate">
                      {c.hint ?? (c.manager_name ? `담당 ${c.manager_name}` : "담당 미배정")}
                    </div>
                  </div>
                  <div className={cn(
                    "shrink-0 rounded-full w-5 h-5 border-2 flex items-center justify-center",
                    isPicked ? "border-amber-500 bg-amber-500 text-white" : "border-[#D8D2C8] bg-white",
                  )}>
                    {isPicked && <span className="text-[11px] font-black">✓</span>}
                  </div>
                </div>
              </button>
            )
          })}
        </div>

        {pickedTo && (
          <div className="mb-3 rounded-2xl border-2 border-red-300 bg-red-50 px-4 py-3">
            <div className="text-[11px] font-bold text-red-800 leading-relaxed">
              「{fromName}」 (from) → 「{pickedName}」 (to) 로 병합.
              <br />⚠ 이 병합은 되돌릴 수 없음.
              <br />⚠ 두 사람이 서로 다른 사람이면 절대 진행 X.
            </div>
            <button
              type="button"
              onClick={() => setConfirmed((v) => !v)}
              className="mt-2 flex items-center gap-2 text-[11px] font-black text-red-800"
            >
              <span className={cn(
                "w-4 h-4 rounded border-2 flex items-center justify-center",
                confirmed ? "border-red-500 bg-red-500 text-white" : "border-red-400 bg-white",
              )}>
                {confirmed && <span className="text-[10px] font-black">✓</span>}
              </span>
              같은 사람임을 확인함 · 병합 진행
            </button>
          </div>
        )}

        <div className="grid grid-cols-[auto_1fr] gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-xl border-2 border-[#D8D2C8] bg-white px-6 py-3 text-[13px] font-extrabold text-[#7A746A] disabled:opacity-40"
          >
            취소
          </button>
          <button
            type="button"
            disabled={busy || !pickedTo || !confirmed}
            onClick={merge}
            className={cn(
              "rounded-xl py-3 text-[13px] font-extrabold text-white transition-all",
              busy || !pickedTo || !confirmed
                ? "bg-[#D8D2C8] opacity-70"
                : "bg-gradient-to-br from-red-600 to-red-700 active:scale-[0.98]",
            )}
          >
            {busy ? "병합 중..." : "🔀 병합"}
          </button>
        </div>
      </div>
    </Sheet>
  )
}
